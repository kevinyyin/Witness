"""K1 (throwaway, gate only): are news-level strike clips answered or refused?
Usage: set -a; source .env; set +a
       python pipeline/killtests/k1_safety.py CLIP [CLIP ...] [--yt YOUTUBE_URL]
Calls follow docs/VERIFIED.md. Product code never imports this file.
"""
import sys
import time

from google import genai

hydrogen = genai.Client()
decisions = genai.Client(http_options={"api_version": "v1beta"})

PROMPT = (
    "List what happens in this video as JSON: "
    '[{"clip_ts": seconds, "type": "siren|flash|blast|burst|engine_buzz|jet|gunfire|fire|rescue|speech", '
    '"label": "short text"}]. Then list visible landmarks.'
)
QUESTIONS = {
    "war_related": {"type": "noul", "instructions": "Does this video show an armed attack or its aftermath?"},
    "real_footage": {
        "type": "noul",
        "instructions": "Is this real camera footage of a real event?",
        "criteria": {
            "true_description": "Filmed by a real camera at a real event.",
            "false_description": "Video game, film, staged, computer-generated, or edited footage.",
        },
    },
    "graphic_level": {
        "type": "score",
        "instructions": "How graphic is this video?",
        "criteria": [
            "Nothing disturbing.",
            "Damage only: smoke, fire, rubble.",
            "Injuries or blood visible.",
            "Severe: bodies or severe injuries.",
        ],
    },
}


def upload(path):
    f = hydrogen.files.upload(file=path)
    while not f.state or f.state.name != "ACTIVE":
        if f.state and f.state.name == "FAILED":
            raise RuntimeError("file processing failed")
        time.sleep(2)
        f = hydrogen.files.get(name=f.name)
    return {"type": "video", "uri": f.uri, "mime_type": f.mime_type}


def attempt(name, fn):
    t0 = time.time()
    try:
        out = fn()
        print(f"  {name}: ANSWERED in {time.time() - t0:.1f}s  {str(out)[:160]!r}")
        return True
    except Exception as e:  # a safety block is an HTTP 400 with error.code
        print(f"  {name}: FAILED in {time.time() - t0:.1f}s  {type(e).__name__}: {str(e)[:300]}")
        return False


def main(argv):
    yt = argv[argv.index("--yt") + 1] if "--yt" in argv else None
    clips = [a for a in argv if not a.startswith("--") and a != yt]
    ok_h = ok_d = 0
    for path in clips:
        print(path)
        block = upload(path)
        ok_h += attempt("hydrogen", lambda: hydrogen.interactions.create(
            model="gemini-4-hydrogen", input=[block, {"type": "text", "text": PROMPT}]).output_text)
        ok_d += attempt("decisions", lambda: {k: (getattr(a, "noul", None), getattr(a, "score", None))
            for k, a in decisions.decisions.create(
                model="gemini-decision-1", input=[{**block, "resolution": "low"}], questions=QUESTIONS).answers.items()})
    print(f"\nanswered: hydrogen {ok_h}/{len(clips)}, decisions {ok_d}/{len(clips)}")
    if yt:
        print(yt)
        url_block = {"type": "video", "uri": yt}
        h = attempt("hydrogen youtube url", lambda: hydrogen.interactions.create(
            model="gemini-4-hydrogen", input=[url_block, {"type": "text", "text": PROMPT}]).output_text)
        attempt("decisions youtube url (docs say unsupported)", lambda: decisions.decisions.create(
            model="gemini-decision-1", input=[url_block], questions=QUESTIONS).answers)
        print(f"youtube_url_input (hydrogen): {str(h).lower()}")


if __name__ == "__main__":
    main(sys.argv[1:])
