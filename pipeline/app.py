"""FastAPI server (§9.3). Run: uvicorn pipeline.app:app --host 127.0.0.1 --port 8000"""
import json
import re
import sys
import time

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from . import CACHE, DATA
from .clip import analyze, cached_by_clip_id

YT_HOST = re.compile(r"^(?:https?://)?(?:[\w-]+\.)?(?:youtube\.com|youtu\.be)/", re.I)
YT_ID = re.compile(r"(?:[?&]v=|youtu\.be/|/shorts/|/embed/|/live/)([\w-]{11})(?![\w-])")
# what a judge reads when a stage fails; the raw exception goes to the server log
PLAIN = {
    "fetch": "Could not read that file as a video. Drop a video file (mp4, mov, webm) or paste a YouTube link.",
    "watch": "Gemini could not watch this video. It may be private, age-restricted, removed or blocked. Try another one.",
}
TRUTHS = {"real_strike", "video_game", "movie", "fireworks_demolition", "other"}
MEDIA_TYPES = {".mp4", ".webm", ".mov", ".mkv", ".m4v", ".jpg", ".jpeg", ".png"}
BOARD = CACHE / "scoreboard.json"
UPLOADS = CACHE / "uploads"

api = APIRouter()


def youtube_url(text):
    """Any YouTube link shape (no scheme, m., music., list= before v=, shorts, youtu.be) -> the one form verified
    with Gemini, or None. Nothing but YouTube is ever passed on."""
    m = YT_ID.search(text)
    return f"https://www.youtube.com/watch?v={m[1]}" if m and YT_HOST.match(text) else None


def _plain(events):
    for kind, data in events:
        if kind == "error":
            print(f"analyze error [{data['stage']}]: {data['message']}", file=sys.stderr, flush=True)
            data = {**data, "message": PLAIN.get(data["stage"], "This step failed. Press Analyze again.")}
        yield kind, data


@api.get("/health")
def health():
    # youtube_url_input is the K1 result: Hydrogen accepts YouTube links (PLAN_PIPELINE.md gap 13)
    return {"ok": True, "youtube_url_input": True}


@api.post("/analyze")
async def analyze_route(request: Request):
    if request.headers.get("content-type", "").startswith("application/json"):
        body = await request.json()
        url, place = str(body.get("url") or "").strip(), body.get("claimed_place") or None
        if youtube_url(url):  # only YouTube links are passed on; nothing else is ever fetched
            events = _plain(analyze(url=youtube_url(url), claimed_place=place))
        else:
            events = iter([("error", {"stage": "fetch", "message": "Paste a YouTube link, or drop a video file."})])
    else:
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "filename"):
            raise HTTPException(422, "multipart field 'file' is required")
        UPLOADS.mkdir(exist_ok=True)
        safe_name = re.sub(r"[^\w.-]", "_", upload.filename or "clip")[-80:]
        dest = UPLOADS / f"{int(time.time())}_{safe_name}"
        with open(dest, "wb") as out:
            while chunk := await upload.read(1 << 20):
                out.write(chunk)
        events = _plain(analyze(path=dest, claimed_place=form.get("claimed_place") or None))

    def sse():
        for kind, data in events:
            yield f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _board():
    return json.loads(BOARD.read_text()) if BOARD.exists() else {"tries": 0, "right": 0, "history": []}


@api.get("/judge")
def judge_get():
    return _board()


@api.post("/judge")
async def judge_post(request: Request):
    body = await request.json()
    clip_id, truth = body.get("clip_id"), body.get("truth")
    if truth not in TRUTHS:
        raise HTTPException(422, f"truth must be one of {sorted(TRUTHS)}")
    entry = cached_by_clip_id(clip_id)
    if not entry:
        raise HTTPException(404, "unknown clip_id")
    fake = entry["record"]["fake"]
    # §9.3: right when (truth is real_strike) equals (verdict is real); unsure is never right
    right = fake["verdict"] != "unsure" and (truth == "real_strike") == (fake["verdict"] == "real")
    board = _board()
    board["history"].append({"clip_id": clip_id, "verdict": fake["verdict"], "label": fake["label"], "truth": truth, "right": right})
    board["tries"], board["right"] = len(board["history"]), sum(h["right"] for h in board["history"])
    BOARD.write_text(json.dumps(board))
    return board


@api.get("/media/{file:path}")
def media(file: str):
    root = DATA.resolve()
    p = (root / file).resolve()
    if not p.is_relative_to(root) or p.suffix.lower() not in MEDIA_TYPES or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p)


app = FastAPI(title="Witness pipeline")
app.include_router(api, prefix="/api")
app.include_router(api)  # the web's Vite proxy may strip /api (PLAN_PIPELINE.md gap 15)
