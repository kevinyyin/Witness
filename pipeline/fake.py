"""The fake verdict: four named checks, then an explicit rule over them (PLAN_PIPELINE.md §C.2-3).

Thresholds are starting values, tuned on dev clips only until the 3:30 freeze.
"""
import json

from . import CACHE
from .physics import SOUND_M_S

NOT_REAL_FAIL = 0.6
NOT_REAL_UNSURE = 0.35
REPEAT_FAIL = 0.95
RECYCLED_GAP_S = 48 * 3600


def mmss(ts):
    return f"{int(ts) // 60}:{int(ts) % 60:02d}"


def _hamming(a, b):
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def seen_match(sha, phash):
    """An earlier clip with a different file but the same pictures (>= 3 of 5 frames within 8 bits), or None."""
    store = CACHE / "phash.json"
    for other_sha, o in (json.loads(store.read_text()) if store.exists() else {}).items():
        if other_sha != sha and sum(_hamming(a, b) <= 8 for a, b in zip(phash, o["phash"])) >= 3:
            return o
    return None


def remember(sha, phash, clip_id, posted_at):
    store = CACHE / "phash.json"
    data = json.loads(store.read_text()) if store.exists() else {}
    data.setdefault(sha, {"phash": phash, "clip_id": clip_id, "posted_at": posted_at})
    store.write_text(json.dumps(data))


def run_checks(seen, scores, phys, has_file, match, older_by_s):
    """Always the four checks, in the §9.1 order."""
    not_real = 1 - scores["real_strike"]
    apparent = float(seen.get("apparent_blast_distance_m") or 0)
    prefix = "" if phys["refined"] else "model-timed: "

    if phys["delta_s"] is None:
        c1 = ("n/a", "no flash + blast pair in the clip", None)
    else:
        d = SOUND_M_S * phys["delta_s"]
        too_fast = apparent >= 300 and (phys["delta_s"] < 0.15 or d < apparent / 3)
        c1 = ("fail", f"{prefix}Boom arrives {phys['delta_s']:.2f} s after the flash ({d:.0f} m of sound travel) though the blast looks ~{apparent:.0f} m away",
              phys["flash_ts"]) if too_fast else ("pass", f"{prefix}Δ {phys['delta_s']:.2f} s → {d / 1000:.2f} km", phys["flash_ts"])

    corr, t1, t2 = phys["repeat"]
    if not has_file or len(phys["blast_times"]) < 2:
        c2 = ("n/a", "needs the file and at least two blasts", None)
    elif corr >= REPEAT_FAIL:
        c2 = ("fail", f"blasts at {mmss(t1)} and {mmss(t2)} are sample-identical (correlation {corr:.2f})", t1)
    else:
        c2 = ("pass", f"no identical blasts (highest correlation {corr:.2f})", None)

    kind = max(scores["fake_kind"], key=scores["fake_kind"].get).replace("_", " ")
    hud = f", on-screen interface {mmss(seen['hud_start_s'])}–{mmss(seen['hud_end_s'])}" if seen.get("hud_present") else ", no HUD"
    hud_ts = float(seen["hud_start_s"]) if seen.get("hud_present") else None
    if not_real >= NOT_REAL_FAIL:
        c3 = ("fail", f"looks like {kind} (not-real score {not_real:.2f}){hud}", hud_ts)
    else:
        c3 = ("pass", f"looks like real camera footage (not-real score {not_real:.2f}){hud}", hud_ts)

    if not has_file:
        c4 = ("n/a", "needs the file", None)
    elif match and older_by_s is not None and older_by_s >= RECYCLED_GAP_S:
        c4 = ("fail", f"same pictures as {match['clip_id']}, posted {older_by_s / 86400:.0f} days earlier", None)
    elif match:
        c4 = ("pass", f"same video as {match['clip_id']}, not an older upload", None)
    else:
        c4 = ("pass", "no pHash match", None)

    return [{"name": n, "result": r, "detail": d, "clip_ts": ts}
            for n, (r, d, ts) in zip(("flash_to_boom", "repeated_sample", "render_hud", "seen_before"), (c1, c2, c3, c4))]


def verdict(checks, not_real, fake_kind):
    """(verdict, label, confidence) from the four checks. The only place a clip is called fake."""
    failed = [c["name"] for c in checks if c["result"] == "fail"]
    if failed:
        label = "recycled" if failed == ["seen_before"] else max(fake_kind, key=fake_kind.get)
        hard = any(n != "render_hud" for n in failed)  # a physics or pHash failure is strong evidence on its own
        return "fake", label, round(max(not_real, 0.9 if hard else 0.0), 2)
    if not_real >= NOT_REAL_UNSURE:
        return "unsure", None, 0.5
    return "real", "real_strike", round(1 - not_real, 2)


if __name__ == "__main__":
    def _run(real_strike, delta=None, apparent=0, repeat=0.0, blasts=(), match=None, older=None, has_file=True):
        seen = {"apparent_blast_distance_m": apparent, "hud_present": False}
        scores = {"real_strike": real_strike, "fake_kind": {"video_game": 0.7, "movie": 0.2, "fireworks": 0.05, "demolition": 0.03, "not_war": 0.02}}
        phys = {"delta_s": delta, "flash_ts": 1.0, "refined": has_file, "blast_times": list(blasts), "repeat": (repeat, 1.0, 2.0)}
        checks = run_checks(seen, scores, phys, has_file, match, older)
        assert [c["name"] for c in checks] == ["flash_to_boom", "repeated_sample", "render_hud", "seen_before"]
        return verdict(checks, 1 - real_strike, scores["fake_kind"])[:2]

    assert _run(0.95, delta=3.1, apparent=1000) == ("real", "real_strike")
    assert _run(0.95, delta=0.0, apparent=800) == ("fake", "video_game")  # boom arrives with a distant flash
    assert _run(0.95, delta=0.1, apparent=40) == ("real", "real_strike")  # a close blast is allowed to be instant
    assert _run(0.95, repeat=0.99, blasts=(1.0, 2.0)) == ("fake", "video_game")
    assert _run(0.2) == ("fake", "video_game")
    assert _run(0.55) == ("unsure", None)
    assert _run(0.95, match={"clip_id": "c_0001"}, older=30 * 86400) == ("fake", "recycled")
    assert _run(0.95, match={"clip_id": "c_0001"}, older=3600) == ("real", "real_strike")
    assert _run(0.95, delta=0.0, apparent=800, has_file=False) == ("fake", "video_game")
    print("fake selftest OK")
