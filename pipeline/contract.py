"""§9 contract checks. Nothing is written to web/public/ unless it passes here.

    python -m pipeline.contract --selftest
    python -m pipeline.contract --clip FILE.json
"""
import json
import sys

VERDICTS = {"real", "fake", "unsure"}
PLATFORMS = {"youtube", "telegram", "x", "commons", "upload"}
EVENT_TYPES = {"siren", "flash", "blast", "burst", "engine_buzz", "jet", "gunfire", "fire", "rescue", "speech"}
FAKE_LABELS = {"real_strike", "video_game", "movie", "fireworks", "demolition", "not_war", "recycled"}
CHECK_NAMES = ["flash_to_boom", "repeated_sample", "render_hud", "seen_before"]
CHECK_RESULTS = {"pass", "fail", "n/a"}
LEVELS = {"point", "district", "city", "unknown"}
STAGES = ["fetch", "watch", "physics", "score", "locate", "verdict"]
FREE_FORM = {"osm_tags", "anchor"}  # keys whose inner shape legitimately varies

# The §9.1 example, verbatim: the key template for every clip record.
CLIP_EXAMPLE = {
    "clip_id": "c_0187", "source_url": "https://youtube.com/watch?v=x", "platform": "youtube",
    "embed_url": "https://www.youtube.com/embed/x", "sha256": "x", "duration_s": 48.2, "posted_at": None,
    "claimed_place": "Kharkiv",
    "timeline": [{"clip_ts": 6.6, "type": "engine_buzz", "label": "moped-like engine buzz", "confidence": 0.8}],
    "triage": {"war_related": 0.97, "event_type": {"strike": 0.81, "aftermath": 0.12, "other": 0.07},
               "graphic_level": 1, "civilian_objects": 0.88, "uxo": 0.04, "military_object": 0.03},
    "fake": {"verdict": "real", "label": "real_strike", "confidence": 0.91,
             "checks": [{"name": "flash_to_boom", "result": "pass", "detail": "x", "clip_ts": 14.2}]},
    "location": {"lat": 49.99, "lon": 36.33, "radius_m": 1800, "level": "district", "method": "landmarks+osm",
                 "evidence": ["church dome 0:03"], "candidates": 7},
    "weapon": {"options": {"shahed_drone": 0.71, "cruise_missile": 0.14, "ballistic_missile": 0.06, "glide_bomb": 0.0,
                           "rocket_cluster": 0.0, "tube_artillery": 0.0, "fpv_drone": 0.0, "unknown": 0.09},
               "evidence": ["0:04-0:11 engine buzz"]},
    "incident_id": "0412",
    "stages_ms": {"fetch": 2100, "watch": 9800, "physics": 700, "score": 230, "locate": 6400, "verdict": 5},
}


def shape(x):
    """Key structure of a JSON value. Scalars and null -> None; a list -> the merged shape of its items."""
    if isinstance(x, dict):
        return {k: (None if k in FREE_FORM else shape(v)) for k, v in x.items()}
    if isinstance(x, list):
        merged = None
        for item in x:
            s = shape(item)
            if merged is None:
                merged = s
            elif isinstance(merged, dict) and isinstance(s, dict):
                merged = {k: merged.get(k) or s.get(k) for k in {*merged, *s}}
        return merged
    return None


def key_diff(got, want, path=""):
    """Differences between two shapes. A None on either side (null or scalar) matches anything."""
    if not isinstance(got, dict) or not isinstance(want, dict):
        return []
    out = [f"{path}: missing key '{k}'" for k in want.keys() - got.keys()]
    out += [f"{path}: extra key '{k}'" for k in got.keys() - want.keys()]
    for k in got.keys() & want.keys():
        out += key_diff(got[k], want[k], f"{path}.{k}" if path else k)
    return out


def check_clip(rec, partial=False):
    """Raises AssertionError with every problem found. partial=True skips keys that P2 adds."""
    want = shape(CLIP_EXAMPLE)
    if partial:
        for k in ("fake", "location", "incident_id"):
            want.pop(k)
        want["stages_ms"] = None
    problems = key_diff(shape(rec), want)
    if rec.get("platform") not in PLATFORMS:
        problems.append(f"platform: {rec.get('platform')!r}")
    for e in rec.get("timeline", []):
        if e["type"] not in EVENT_TYPES or not 0 <= e["confidence"] <= 1:
            problems.append(f"timeline event: {e}")
    if rec.get("triage", {}).get("graphic_level") not in (0, 1, 2, 3):
        problems.append("triage.graphic_level not 0-3")
    fake = rec.get("fake")
    if fake:
        if fake["verdict"] not in VERDICTS:
            problems.append(f"fake.verdict: {fake['verdict']!r}")
        if [c["name"] for c in fake["checks"]] != CHECK_NAMES:
            problems.append("fake.checks: must be the four named checks in order")
        if any(c["result"] not in CHECK_RESULTS for c in fake["checks"]):
            problems.append("fake.checks: bad result value")
        want_label = {"real": {"real_strike"}, "unsure": {None}, "fake": FAKE_LABELS - {"real_strike"}}[fake["verdict"]]
        if fake["label"] not in want_label:
            problems.append(f"fake.label {fake['label']!r} does not fit verdict {fake['verdict']!r}")
        if fake["verdict"] == "fake" and (rec["location"] is not None or rec["weapon"] is not None):
            problems.append("rejected clips must have location and weapon null")
    if rec.get("location") and rec["location"]["level"] not in LEVELS:
        problems.append("location.level")
    if rec.get("location") and rec.get("triage", {}).get("military_object", 0) >= 0.5:
        problems.append("location must be null when military_object >= 0.5 (§13)")
    assert not problems, "\n".join(problems)


def _selftest():
    assert key_diff(shape({"a": 1, "b": [{"c": 1}]}), shape({"a": None, "b": [{"c": 2}, {"c": 3}]})) == []
    assert key_diff(shape({"a": 1}), shape({"a": 1, "b": 2})) == [": missing key 'b'"]
    assert key_diff(shape({"a": {"x": 1, "y": 2}}), shape({"a": {"x": 1}})) == ["a: extra key 'y'"]
    assert key_diff(shape({"a": None}), shape({"a": {"x": 1}})) == []  # null is allowed where a dict may be
    check_clip(CLIP_EXAMPLE | {"fake": CLIP_EXAMPLE["fake"] | {"checks": [
        {"name": n, "result": "pass", "detail": "x", "clip_ts": None} for n in CHECK_NAMES]}})
    try:
        check_clip(CLIP_EXAMPLE)  # the example lists one check only: must be caught
    except AssertionError:
        pass
    else:
        raise SystemExit("selftest: a record with one check passed")
    print("contract selftest OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    elif "--clip" in sys.argv:
        check_clip(json.load(open(sys.argv[sys.argv.index("--clip") + 1])), partial="--partial" in sys.argv)
        print("clip record OK")
