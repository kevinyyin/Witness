"""One clip (file or YouTube URL) -> §9.1 record, produced as a stream of §9.3 stage events.

    python -m pipeline.clip PATH_OR_URL [--place TEXT] [--fresh]
"""
import hashlib
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from . import CACHE, gemini, ingest

STAGES = ["fetch", "watch", "physics", "score", "locate", "verdict"]


def platform_of(url):
    if not url:
        return "upload"
    for needle, name in (("youtu", "youtube"), ("t.me/", "telegram"), ("twitter.com", "x"), ("x.com/", "x"),
                         ("wikimedia.org", "commons")):
        if needle in url:
            return name
    return "upload"


def embed_of(url, platform):
    if platform == "youtube":
        m = re.search(r"(?:v=|youtu\.be/|embed/|shorts/)([\w-]{11})", url)
        return f"https://www.youtube.com/embed/{m.group(1)}" if m else None
    if platform == "telegram":
        return url.split("?")[0] + "?embed=1"
    if platform == "x":
        return url
    return None


def clip_id_for(key):
    ids_file = CACHE / "ids.json"
    ids = json.loads(ids_file.read_text()) if ids_file.exists() else {}
    if key not in ids:
        ids[key] = f"c_{len(ids) + 1:04d}"
        ids_file.write_text(json.dumps(ids))
    return ids[key]


def mmss(ts):
    return f"{int(ts) // 60}:{int(ts) % 60:02d}"


def clean_timeline(raw, duration_s):
    """Model output is untrusted: keep only well-formed events inside the clip."""
    out = []
    for e in raw or []:
        try:
            ts, conf = float(e["clip_ts"]), float(e["confidence"])
        except (KeyError, TypeError, ValueError):
            continue
        if e.get("type") in gemini.EVENT_TYPES and 0 <= ts <= duration_s + 1:
            out.append({"clip_ts": round(ts, 2), "type": e["type"], "label": str(e.get("label", ""))[:80],
                        "confidence": round(min(max(conf, 0.0), 1.0), 2)})
    return sorted(out, key=lambda e: e["clip_ts"])


def _stage(stage, status, ms=None, summary=None):
    return "stage", {"stage": stage, "status": status, "ms": ms, "summary": summary}


def _timed(fn, *args):
    t0 = time.time()
    return fn(*args), int((time.time() - t0) * 1000)


def analyze(path=None, url=None, claimed_place=None, posted_at=None, source_url=None, fresh=False):
    """Yields ("stage", {...}) events, then one ("result", record) or ("error", {...})."""
    events, stage = [], "fetch"

    def emit(ev):
        events.append(ev)
        return ev

    try:
        yield emit(_stage("fetch", "start"))
        t0 = time.time()
        prep = ingest.prepare(path) if path else None
        key = prep["sha256"] if prep else hashlib.sha1(url.encode()).hexdigest()
        cache_file = CACHE / "clips" / f"{key}.json"
        if cache_file.exists() and not fresh:
            cached = json.loads(cache_file.read_text())
            yield from (tuple(e) for e in cached["events"][1:])
            return
        block = gemini.upload(prep["upload"]) if prep else {"type": "video", "uri": url}
        ms = {"fetch": int((time.time() - t0) * 1000)}
        yield emit(_stage("fetch", "done", ms["fetch"], f"{prep['duration_s']:.0f} s clip" if prep else "YouTube link, not downloaded"))

        stage = "watch"
        yield emit(_stage("watch", "start"))
        with ThreadPoolExecutor() as pool:
            f_watch = pool.submit(_timed, gemini.watch, block, claimed_place)
            # with a file, the Decisions API scores the video itself, in parallel with Hydrogen
            f_score = pool.submit(_timed, gemini.score, [{**block, "resolution": "low"}]) if prep else None
            seen, ms["watch"] = f_watch.result()
            duration_s = prep["duration_s"] if prep else round(float(seen.get("duration_s") or 0), 2)
            timeline = clean_timeline(seen.get("timeline"), duration_s)
            kinds = ", ".join(dict.fromkeys(e["type"] for e in timeline)) or "none"
            yield emit(_stage("watch", "done", ms["watch"], f"{len(timeline)} events: {kinds}"))

            stage = "score"
            yield emit(_stage("score", "start"))
            if f_score:
                scores, ms["score"] = f_score.result()
            else:
                # the Decisions API takes no YouTube URLs (docs/VERIFIED.md): it scores Hydrogen's written observations
                text = json.dumps({"description": seen.get("observations", ""), "events": timeline,
                                   "game_or_film_interface_on_screen": bool(seen.get("hud_present"))})
                scores, ms["score"] = _timed(gemini.score, text)
        yield emit(_stage("score", "done", ms["score"],
                          f"war-related {scores['war_related']:.2f} · real strike {scores['real_strike']:.2f}"))

        link = source_url or url
        platform = platform_of(link)
        cues = [e for e in timeline if e["type"] in ("engine_buzz", "jet", "burst", "blast")]
        record = {
            "clip_id": clip_id_for(key),
            "source_url": link,
            "platform": platform,
            "embed_url": embed_of(link, platform) if link else None,
            "sha256": prep["sha256"] if prep else None,
            "duration_s": duration_s,
            "posted_at": posted_at,
            "claimed_place": claimed_place,
            "timeline": timeline,
            "triage": {
                "war_related": round(scores["war_related"], 2),
                "event_type": {k: round(scores["event_type"].get(k, 0.0), 2) for k in ("strike", "aftermath", "other")},
                "graphic_level": min(3, max(0, round(scores["graphic_level"]))),
                "civilian_objects": round(scores["civilian_objects"], 2),
                "uxo": round(scores["uxo"], 2),
                "military_object": round(scores["military_object"], 2),
            },
            "weapon": {"options": {k: round(scores["weapon"].get(k, 0.0), 2) for k in gemini.WEAPONS},
                       "evidence": [f"{mmss(e['clip_ts'])} {e['label']}" for e in cues[:4]]},
            "stages_ms": ms,
        }
        raw = {"seen": seen, "scores": scores, "phash": prep["phash"] if prep else [], "path": str(path) if path else None}
        yield emit(("result", record))
        cache_file.write_text(json.dumps({"events": events, "record": record, "raw": raw}, ensure_ascii=False))
    except Exception as e:  # one bad clip must never take the server or a bulk run down
        yield _stage(stage, "error", None, type(e).__name__)
        yield "error", {"stage": stage, "message": str(e)[:300]}


def analyze_clip(**kw):
    """Runs analyze() to the end. Returns the record, or raises on an error event."""
    for kind, data in analyze(**kw):
        if kind == "error":
            raise RuntimeError(f"{data['stage']}: {data['message']}")
        if kind == "result":
            return data


def cached(record_or_key):
    """The cache entry (events, record, raw) for a sha256 / url hash."""
    return json.loads((CACHE / "clips" / f"{record_or_key}.json").read_text())


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    target = args[0]
    place = sys.argv[sys.argv.index("--place") + 1] if "--place" in sys.argv else None
    kw = {"url": target} if target.startswith("http") else {"path": target}
    for kind, data in analyze(claimed_place=place, fresh="--fresh" in sys.argv, **kw):
        if kind == "stage":
            print(f"[{data['stage']:8s}] {data['status']:7s} {data['ms'] or '':>6} {data['summary'] or ''}", file=sys.stderr)
        else:
            print(json.dumps(data, ensure_ascii=False, indent=1))
