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


FLAG_TYPES = ["residential", "protected_site", "dense_population", "night_strike", "indiscriminate_weapon",
              "second_strike", "uxo", "military_object"]
NOTE_TYPES = {"time_conflict", "location_conflict", "weak_camera", "single_source", "recycled_or_edited", "graphic"}
INCIDENT_EVENTS = {"siren", "engine_buzz", "jet", "impact", "boom_heard", "burst", "fire", "rescue", "gunfire", "speech"}
ANCHOR_KINDS = {"point", "building", "impact", "camera", "cameras", "clock"}
VERDICT_WORDS = ("war crime", "illegal", "guilty", "perpetrator")


def _dist_m(a, b):
    import math
    p = math.pi / 180
    h = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 12742000 * math.asin(math.sqrt(h))


def check_incident(inc, sample):
    """§9.2: same keys as the sample at every level, enums, time and ring guarantees, safety rules."""
    problems = key_diff(shape(inc), shape(sample))
    src = {s["id"]: s for s in inc["sources"]}
    if inc["is_sample"] is not False:
        problems.append("is_sample must be false")
    if inc["impact"]["method"] not in ("evidence_rings", "landmarks", "claimed_place"):
        problems.append("impact.method")
    if sorted(f["type"] for f in inc["flags"]) != sorted(FLAG_TYPES):  # the §9.2 example and enum list differ in order
        problems.append("flags: exactly the eight types")
    for f in inc["flags"]:
        if f["status"] not in ("raised", "checked_none"):
            problems.append(f"flag status: {f['status']}")
        if f["type"] == "military_object" and f["status"] == "raised":
            problems.append("military_object is raised: this incident must not be written to web/public/ (§13)")
    for item in inc["flags"] + inc["review_notes"] + inc["timeline"]:
        a = item.get("anchor")
        if a is not None and a.get("kind") not in ANCHOR_KINDS:
            problems.append(f"anchor kind: {a}")
        s = src.get(item.get("source"))
        if item.get("source") is not None and s is None:
            problems.append(f"unknown source {item['source']!r}")
        if s and s["aligned"] and item.get("t") is not None and item.get("clip_ts") is not None and item in inc["timeline"]:
            if abs(item["t"] - (item["clip_ts"] + s["offset_s"])) > 0.05:
                problems.append(f"t != clip_ts + offset_s for {item}")
    for n in inc["review_notes"]:
        if n["type"] not in NOTE_TYPES:
            problems.append(f"note type: {n['type']}")
    for e in inc["timeline"]:
        if e["type"] not in INCIDENT_EVENTS:
            problems.append(f"timeline type: {e['type']}")
    impacts = [e for e in inc["timeline"] if e["type"] == "impact"]
    if not impacts or impacts[0]["t"] != 0:
        problems.append("timeline needs an impact event at t = 0")
    elif src[impacts[0]["source"]]["player"] not in ("youtube", "file"):
        problems.append("the clip with the impact event must be 'youtube' or 'file'")
    conflicts = {n["source"] for n in inc["review_notes"] if n["type"] == "location_conflict"}
    for s in inc["sources"]:
        if s["player"] not in ("youtube", "file", "embed") or s["authenticity"] not in VERDICTS or s["platform"] not in PLATFORMS:
            problems.append(f"source {s['id']}: bad player / authenticity / platform")
        if (s["player"] == "file") != (s["media_url"] is not None):
            problems.append(f"source {s['id']}: media_url is set exactly when player is 'file'")
        if s["authenticity"] == "fake" and (s["camera"] is not None or not s["reject_reason"]):
            problems.append(f"source {s['id']}: a rejected clip has camera null and a reject_reason")
        if s["camera"] and s["boom_distance_m"] is not None and s["id"] not in conflicts:
            d = _dist_m((s["camera"]["lat"], s["camera"]["lon"]), (inc["impact"]["lat"], inc["impact"]["lon"]))
            if abs(d - s["boom_distance_m"]) > s["camera"]["radius_m"] + inc["impact"]["radius_m"]:
                problems.append(f"source {s['id']}: camera distance does not match boom_distance_m and no location_conflict note")
    v = inc["verification"]
    if v["n_sources"] != sum(s["authenticity"] != "fake" for s in inc["sources"]) or v["n_rejected"] != len(inc["sources"]) - v["n_sources"]:
        problems.append("verification counts do not match sources")
    if v["corroboration"] not in ("high", "medium", "low"):
        problems.append("verification.corroboration")
    text = json.dumps(inc, ensure_ascii=False).lower()
    problems += [f"verdict language: '{w}'" for w in VERDICT_WORDS if w in text]
    assert not problems, "\n".join(problems)


def check_index(index):
    """§9.3 incidents/index.json."""
    want = {"is_sample": None, "city": None, "n_clips": None, "n_rejected": None, "incidents": {
        k: None for k in ("id", "title", "lat", "lon", "radius_m", "n_sources", "corroboration", "impact_local")}}
    problems = key_diff(shape(index), want)
    if index.get("is_sample") is not False:
        problems.append("is_sample must be false")
    problems += [f"incident {i.get('id')}: id must be a string" for i in index.get("incidents", []) if not isinstance(i.get("id"), str)]
    assert not problems, "\n".join(problems)


def check_results(res):
    """§9.3 eval/results.json."""
    want = {"split": None, "frozen_at": None, "n_clips": None,
            "rows": {k: None for k in ("claim", "metric", "witness", "baseline", "unit", "baseline_name", "n")},
            "ablation": {k: None for k in ("metric", "unit", "full_video", "frames_5", "transcript", "n")},
            "worst_misses": {k: None for k in ("clip_id", "thumb", "expected", "got", "why")}}
    problems = key_diff(shape(res), want)
    if res.get("split") not in ("dev", "test"):
        problems.append("split must be dev or test")
    if (res.get("split") == "test") != (res.get("frozen_at") is not None):
        problems.append("frozen_at is set exactly on test runs")
    text = json.dumps(res, ensure_ascii=False).lower()
    problems += [f"verdict language: '{w}'" for w in VERDICT_WORDS if w in text]
    assert not problems, "\n".join(problems)


def check_stream(text):
    """A raw /api/analyze response body (§9.3): stage events in order, then exactly one result or error."""
    blocks = [b for b in text.strip().split("\n\n") if b.strip()]
    events = []
    for b in blocks:
        lines = b.split("\n")
        assert len(lines) == 2 and lines[0].startswith("event: ") and lines[1].startswith("data: "), f"bad event block: {b[:80]!r}"
        events.append((lines[0][7:], json.loads(lines[1][6:])))
    assert [k for k, _ in events].count("result") + [k for k, _ in events].count("error") == 1, "need exactly one result or error"
    assert events[-1][0] in ("result", "error"), "the stream must end with result or error"
    order = []
    for kind, d in events[:-1]:
        assert kind == "stage" and set(d) == {"stage", "status", "ms", "summary"}, f"bad stage event: {d}"
        assert d["status"] in ("start", "done", "skipped", "error"), d
        if d["stage"] not in order:
            order.append(d["stage"])
    assert order == STAGES[: len(order)], f"stages out of order: {order}"
    if events[-1][0] == "result":
        assert order == STAGES, f"missing stages: {order}"
        check_clip(events[-1][1])
    return events


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
    elif "--stream" in sys.argv:
        for f in sys.argv[sys.argv.index("--stream") + 1:]:
            ev = check_stream(open(f, encoding="utf-8").read())
            print(f"{f}: OK, {len(ev)} events, verdict {ev[-1][1].get('fake', {}).get('verdict', ev[-1][0])}")
    elif "--results" in sys.argv:
        check_results(json.load(open(sys.argv[sys.argv.index("--results") + 1], encoding="utf-8")))
        print("results OK")
    elif "--index" in sys.argv:
        check_index(json.load(open(sys.argv[sys.argv.index("--index") + 1], encoding="utf-8")))
        print("index OK")
    elif "--clip" not in sys.argv and len(sys.argv) > 1:
        from . import PUBLIC
        sample = json.loads((PUBLIC / "sample_incident.json").read_text(encoding="utf-8"))
        for f in sys.argv[1:]:
            check_incident(json.load(open(f, encoding="utf-8")), sample)
            print(f"{f}: incident OK")
    elif "--clip" in sys.argv:
        check_clip(json.load(open(sys.argv[sys.argv.index("--clip") + 1])), partial="--partial" in sys.argv)
        print("clip record OK")
