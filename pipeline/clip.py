"""One clip (file or YouTube URL) -> §9.1 record, produced as a stream of §9.3 stage events.

    python -m pipeline.clip PATH_OR_URL [--place TEXT] [--fresh]
"""
import hashlib
import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from datetime import datetime

from . import CACHE, fake, gemini, geo, ingest, physics

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


_LOCK = threading.Lock()  # clips are analyzed in parallel threads; the small JSON stores are shared


def clip_id_for(key):
    ids_file = CACHE / "ids.json"
    with _LOCK:
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


def _older_by_s(posted_at, other_posted_at):
    """Seconds by which the other clip's post is older, or None when either time is unknown."""
    try:
        return (datetime.fromisoformat(posted_at) - datetime.fromisoformat(other_posted_at)).total_seconds()
    except (TypeError, ValueError):
        return None


def incident_of(clip_id):
    """The incident a known clip belongs to (written by incidents.py), or None."""
    f = CACHE / "clip_incident.json"
    return (json.loads(f.read_text()) if f.exists() else {}).get(clip_id)


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

            stage = "physics"
            yield emit(_stage("physics", "start"))
            t0 = time.time()
            phys = physics.measure(path, prep["wav"] if prep else None, timeline)
            if not prep and phys["delta_s"] is not None:
                try:  # no file: one finer Hydrogen pass around the blast; its failure only costs precision
                    finer = gemini.retime(block, phys["blast_ts"])
                    if finer:
                        phys["flash_ts"], phys["blast_ts"] = round(finer[0], 2), round(finer[1], 2)
                        phys["delta_s"] = round(max(0.0, finer[1] - finer[0]), 2)
                except Exception:
                    pass
            ms["physics"] = int((time.time() - t0) * 1000)
            yield emit(_stage("physics", "done", ms["physics"],
                              "no flash + blast pair" if phys["delta_s"] is None else
                              f"flash {mmss(phys['flash_ts'])}, boom +{phys['delta_s']:.2f} s → {physics.SOUND_M_S * phys['delta_s']:.0f} m"))

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

        t0 = time.time()
        not_real = 1 - scores["real_strike"]
        match = fake.seen_match(prep["sha256"], prep["phash"]) if prep else None
        checks = fake.run_checks(seen, scores, phys, bool(prep), match,
                                 _older_by_s(posted_at, match["posted_at"]) if match else None)
        verdict, label, confidence = fake.verdict(checks, not_real, scores["fake_kind"])
        verdict_ms = int((time.time() - t0) * 1000)

        stage = "locate"
        location, ms["locate"] = None, None
        if verdict == "fake":
            yield emit(_stage("locate", "skipped", None, "rejected clips are not located"))
        elif scores["military_object"] >= 0.5:  # §13: never locate military objects
            yield emit(_stage("locate", "skipped", None, "location withheld: military object visible"))
        else:
            yield emit(_stage("locate", "start"))
            decide_input = [{**block, "resolution": "low"}] if prep else seen.get("observations", "")
            location, ms["locate"] = _timed(geo.locate, seen, claimed_place, decide_input)
            yield emit(_stage("locate", "done", ms["locate"],
                              f"{location['level']}: ±{location['radius_m']} m, {location['candidates']} candidates"))

        stage = "verdict"
        yield emit(_stage("verdict", "start"))
        ms["verdict"] = verdict_ms
        yield emit(_stage("verdict", "done", verdict_ms, f"{verdict}: {label or 'needs a human'} ({confidence})"))

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
            "fake": {"verdict": verdict, "label": label, "confidence": confidence, "checks": checks},
            "location": location,
            "weapon": None if verdict == "fake" else {
                "options": {k: round(scores["weapon"].get(k, 0.0), 2) for k in gemini.WEAPONS},
                "evidence": [f"{mmss(e['clip_ts'])} {e['label']}" for e in cues[:4]]},
            "incident_id": incident_of(match["clip_id"]) if match else None,
            "stages_ms": {k: ms.get(k) for k in STAGES},
        }
        if prep:
            with _LOCK:
                fake.remember(prep["sha256"], prep["phash"], record["clip_id"], posted_at)
        raw = {"seen": seen, "scores": scores, "phys": phys, "phash": prep["phash"] if prep else [],
               "path": str(path) if path else None}
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


def cached(key):
    """The cache entry (events, record, raw) for a sha256 / url hash."""
    return json.loads((CACHE / "clips" / f"{key}.json").read_text())


def cached_by_clip_id(clip_id):
    ids_file = CACHE / "ids.json"
    key = next((k for k, v in (json.loads(ids_file.read_text()) if ids_file.exists() else {}).items() if v == clip_id), None)
    f = CACHE / "clips" / f"{key}.json"
    return json.loads(f.read_text()) if key and f.exists() else None


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
