"""§11 eval harness.

    python eval/run_eval.py --split dev|test

Writes eval/results.json and its copy web/public/eval/results.json (§9.3).
The split is eval/split.csv and is final. The test split runs once, after the AI freeze.
This is the only code besides the K3 kill test that reads the answer keys.
"""
import base64
import csv
import json
import shutil
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pipeline import CACHE, DATA, PUBLIC, ROOT, bulk, contract, gemini, geo, ingest  # noqa: E402
from pipeline.clip import cached  # noqa: E402
from pipeline.incidents import heroes  # noqa: E402

OUT = ROOT / "eval" / "results.json"


def truths():
    """Published location per strike date (answer key; eval only)."""
    out = {}
    for r in csv.DictReader(open(DATA / "hero_candidates_Kharkiv.csv", encoding="utf-8-sig")):
        if r["first_event_latlon"].strip():
            lat, lon = r["first_event_latlon"].split(",")
            out[r["date"]] = (float(lat), float(lon))
    return out


def extras(c):
    """Baseline and ablation calls for one clip (cached)."""
    f = CACHE / "eval" / f"{c['id']}.json"
    if f.exists():
        return json.loads(f.read_text())
    prep = ingest.prepare(c["path"])
    block = gemini.upload(prep["upload"])

    def attempt(fn, *a):
        try:
            return fn(*a)
        except Exception as e:  # an empty transcript or a blocked input counts as no answer
            print(f"  ! {c['id']}: {type(e).__name__}: {str(e)[:100]}", file=sys.stderr)
            return None

    frames = [{"type": "image", "data": base64.b64encode(p.read_bytes()).decode(), "mime_type": "image/jpeg"} for p in prep["frames"]]
    out = {
        "direct": attempt(gemini.ask_directly, block, c["claimed_place"]),
        "frames_5": attempt(gemini.real_strike_score, frames),
        "transcript": attempt(gemini.real_strike_score, [{**block, "processing": {"type": "static", "content_layers": ["transcript"]}}]),
    }
    f.parent.mkdir(exist_ok=True)
    f.write_text(json.dumps(out))
    return out


def pct(hits, n):
    return round(100 * hits / n) if n else None


def grouping_accuracy(groups, truth):
    """Share of clips that sit in the main group of their true incident."""
    main = {inc: max(range(len(groups)), key=lambda g: sum(truth[i] == inc for i in groups[g])) for inc in set(truth.values())} if groups else {}
    right = 0
    for gi, g in enumerate(groups):
        incs = [truth[i] for i in g]
        major = max(set(incs), key=incs.count)
        right += sum(t == major and main[major] == gi for t in incs)
    return pct(right, len(truth))


def main(split):
    if split == "test" and OUT.exists() and json.loads(OUT.read_text())["split"] == "test":
        sys.exit("The test set has already been run once (eval/results.json has split: test). Not running it again.")
    splits = bulk.split_of()
    clips = [c for c in bulk.manifest_clips() if splits.get(c["id"]) == split]
    recs = bulk.run(clips)
    with ThreadPoolExecutor(4) as pool:
        extra = dict(zip((c["id"] for c in clips), pool.map(extras, clips)))
    truth = truths()
    rows, misses = [], []

    # --- fakes caught: positive = "fake" -------------------------------------------------------------------------
    scored = [c for c in clips if recs[c["id"]]]

    def pr(pred_fake):
        tp = sum(pred_fake(c) and c["label"] != "real" for c in scored)
        fp = sum(pred_fake(c) and c["label"] == "real" for c in scored)
        fn = sum(not pred_fake(c) and c["label"] != "real" for c in scored)
        return pct(tp, tp + fp), pct(tp, tp + fn)

    wp, wr = pr(lambda c: recs[c["id"]]["fake"]["verdict"] == "fake")
    bp, br = pr(lambda c: bool(extra[c["id"]]["direct"]) and extra[c["id"]]["direct"]["real_strike"] is False)
    for metric, w, b in (("precision", wp, bp), ("recall", wr, br)):
        rows.append({"claim": "Fakes caught", "metric": metric, "witness": w, "baseline": b, "unit": "%",
                     "baseline_name": "Single Hydrogen call, no physics or audio checks", "n": len(scored)})
    for c in scored:
        fake = recs[c["id"]]["fake"]
        if (fake["verdict"] == "fake") != (c["label"] != "real") and fake["verdict"] != "unsure":
            failed = [k["detail"] for k in fake["checks"] if k["result"] == "fail"]
            misses.append((fake["confidence"], c, "real strike" if c["label"] == "real" else c["label"].replace("_", " "),
                           f"rejected: {fake['label']}" if fake["verdict"] == "fake" else "accepted as real strike footage",
                           failed[0] if failed else f"no check failed; not-real score {1 - cached(recs[c['id']]['sha256'])['raw']['scores']['real_strike']:.2f}"))

    # --- geolocation (with post text) ------------------------------------------------------------------------------
    located = [(c, recs[c["id"]]["location"], truth[c["date"]]) for c in scored
               if c["label"] == "real" and c["date"] in truth and recs[c["id"]]["location"]]
    if located:
        err = [geo.dist_m((loc["lat"], loc["lon"]), t) / 1000 for _, loc, t in located]
        base = [geo.dist_m((extra[c["id"]]["direct"]["lat"], extra[c["id"]]["direct"]["lon"]), t) / 1000
                for c, _, t in located if extra[c["id"]]["direct"]]
        name, n = "Gemini asked directly", len(located)
        rows += [
            {"claim": "Geolocation works", "metric": "within 1 km", "witness": pct(sum(e <= 1 for e in err), n),
             "baseline": pct(sum(e <= 1 for e in base), len(base)), "unit": "%", "baseline_name": name, "n": n},
            {"claim": "Geolocation works", "metric": "within 5 km", "witness": pct(sum(e <= 5 for e in err), n),
             "baseline": pct(sum(e <= 5 for e in base), len(base)), "unit": "%", "baseline_name": name, "n": n},
            {"claim": "Geolocation works", "metric": "median error", "witness": round(statistics.median(err), 1),
             "baseline": round(statistics.median(base), 1) if base else None, "unit": "km", "baseline_name": name, "n": n},
            {"claim": "Uncertainty is honest", "metric": "true location inside the radius",
             "witness": pct(sum(e * 1000 <= loc["radius_m"] for e, (_, loc, _) in zip(err, located)), n),
             "baseline": None, "unit": "%", "baseline_name": "none (target ≥ 70%)", "n": n},
        ]
        for e, (c, loc, _) in zip(err, located):
            if e * 1000 > loc["radius_m"]:
                misses.append((min(e / 10, 1.0), c, f"real strike, {loc['evidence'][0] if loc['evidence'] else 'Kharkiv'}"[:60],
                               f"{e:.1f} km from the published location (radius ±{loc['radius_m']} m)",
                               f"{loc['method']}: {', '.join(loc['evidence'][:2])}; {loc['candidates']} map candidates"))

    # --- grouping (hero clips; §10: the only row they are scored in) ------------------------------------------------
    hero_clips, true_inc = [], {}
    for h in heroes():
        for hc in h["clips"]:
            hero_clips.append({"id": hc["url"], "path": hc["path"], "url": hc["url"], "posted_at": hc["posted_at"],
                               "claimed_place": h["city"], "city": h["city"], "date": h["date"]})
            true_inc[hc["url"]] = h["id"]
    hrecs = bulk.run(hero_clips)
    by_day = {}
    for hc in hero_clips:
        by_day.setdefault((hc["city"], hc["date"]), []).append(hc["id"])
    rows.append({"claim": "Grouping", "metric": "hero clips grouped correctly",
                 "witness": grouping_accuracy(bulk.group([{"id": hc["id"], "record": hrecs[hc["id"]], "city": hc["city"]} for hc in hero_clips]), true_inc),
                 "baseline": grouping_accuracy(list(by_day.values()), true_inc), "unit": "%",
                 "baseline_name": "Group by claimed city + date", "n": len(hero_clips)})

    # --- ablation: the same "real strike?" question on full video, 5 frames, transcript ------------------------------
    def acc(score_of):
        return pct(sum((s := score_of(c)) is not None and (s >= 0.5) == (c["label"] == "real") for c in scored), len(scored))

    ablation = {"metric": "fake accuracy (real strike or not)", "unit": "%",
                "full_video": acc(lambda c: cached(recs[c["id"]]["sha256"])["raw"]["scores"]["real_strike"]),
                "frames_5": acc(lambda c: extra[c["id"]]["frames_5"]), "transcript": acc(lambda c: extra[c["id"]]["transcript"]),
                "n": len(scored)}

    # --- worst misses: largest errors first; thumbnails from Commons clips only ---------------------------------------
    worst = []
    (PUBLIC / "eval").mkdir(exist_ok=True)
    for n, (_, c, expected, got, why) in enumerate(sorted(misses, key=lambda m: -m[0])[:3], 1):
        thumb = None
        if recs[c["id"]]["triage"]["graphic_level"] < 2:
            shutil.copy(ingest.prepare(c["path"])["frames"][2], PUBLIC / "eval" / f"miss_{n}.jpg")
            thumb = f"eval/miss_{n}.jpg"
        worst.append({"clip_id": c["id"], "thumb": thumb, "expected": expected, "got": got, "why": why[:200]})

    res = {"split": split, "frozen_at": datetime.now(timezone.utc).isoformat(timespec="seconds") if split == "test" else None,
           "n_clips": len(clips), "rows": rows, "ablation": ablation, "worst_misses": worst}
    contract.check_results(res)
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    shutil.copy(OUT, PUBLIC / "eval" / "results.json")
    for r in rows:
        print(f"{r['claim']:22s} {r['metric']:32s} witness {r['witness']!s:>5} {r['unit']:2s}  baseline {r['baseline']!s:>5}  n={r['n']}")
    print("ablation", ablation)
    print("worst misses", [(w["clip_id"], w["got"]) for w in worst])


if __name__ == "__main__":
    assert grouping_accuracy([["a", "b"], ["c"]], {"a": 1, "b": 1, "c": 2}) == 100
    assert grouping_accuracy([["a", "b", "c"]], {"a": 1, "b": 1, "c": 2}) == 67
    assert grouping_accuracy([["a"], ["b"], ["c"]], {"a": 1, "b": 1, "c": 2}) == 67
    main(sys.argv[sys.argv.index("--split") + 1])
