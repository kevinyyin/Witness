"""§11 eval harness.

    python eval/run_eval.py --split dev|test

Writes eval/results.json and its copy web/public/eval/results.json (§9.3).
The split is eval/split.csv and is final. The test split runs once, after the AI freeze.
This is the only code besides the K3 kill test that reads the answer keys.
"""
import base64
import csv
import os
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
    """Published location per eval clip id (answer keys; eval only)."""
    by_date = {}
    for r in csv.DictReader(open(DATA / "hero_candidates_Kharkiv.csv", encoding="utf-8-sig")):
        if r["first_event_latlon"].strip():
            lat, lon = r["first_event_latlon"].split(",")
            by_date[r["date"]] = (float(lat), float(lon))
    out = {c["id"]: by_date[c["date"]] for c in bulk.manifest_clips() if c["date"] in by_date}
    by_link = {bulk._link(r["link"]): (float(r["lat"]), float(r["lon"]))
               for r in csv.DictReader(open(DATA / "impact_videos_all.csv", encoding="utf-8-sig")) if r["lat"] and r["lon"]}
    out.update({c["id"]: by_link[bulk._link(c["url"])] for c in bulk.telegram_clips() if bulk._link(c["url"]) in by_link})
    return out


def extras(c):
    """Baseline and ablation calls for one clip (cached)."""
    f = CACHE / "eval" / f"{c['id']}.json"
    if f.exists():
        return json.loads(f.read_text())
    if not c["path"]:  # a YouTube link: no file, so no frames or transcript arm; the direct question still works by URL
        try:
            return {"direct": gemini.ask_directly({"type": "video", "uri": c["url"]}, c["claimed_place"]), "frames_5": None, "transcript": None}
        except Exception as e:
            print(f"  ! {c['id']}: {type(e).__name__}: {str(e)[:100]}", file=sys.stderr)
            return {"direct": None, "frames_5": None, "transcript": None}
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


def previous(c):
    """The same direct question put to the previous-generation model (cached)."""
    f = CACHE / "eval_prev" / f"{c['id']}.json"
    if f.exists():
        return json.loads(f.read_text())
    try:
        block = gemini.upload(ingest.prepare(c["path"])["upload"]) if c["path"] else {"type": "video", "uri": c["url"]}
        out = gemini.ask_directly(block, c["claimed_place"], model=gemini.PREVIOUS)
    except Exception as e:
        print(f"  ! {c['id']} ({gemini.PREVIOUS}): {type(e).__name__}: {str(e)[:100]}", file=sys.stderr)
        out = None
    f.parent.mkdir(exist_ok=True)
    f.write_text(json.dumps(out))
    return out


CLAUDE = "claude-opus-5-5"
CLAUDE_NAME = "Claude Opus 5.5 on 5 frames + caption (no video, no sound)"


def claude(c):
    """Another lab's model on the same clip (cached). The Claude API takes images, not video, so it gets the five
    frames and the post text. A refusal or an error counts as no answer; no fallback model is used, since the row
    is meant to measure this model."""
    f = CACHE / "eval_claude" / f"{c['id']}.json"
    if f.exists():
        return json.loads(f.read_text())
    if not c["path"]:
        return None  # a YouTube link: there is no file to cut frames from
    import anthropic
    frames = [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                           "data": base64.standard_b64encode(p.read_bytes()).decode("utf-8")}}
              for p in ingest.prepare(c["path"])["frames"]]
    prompt = ("These are five frames from one video, in order. Answer directly. real_strike: is this authentic footage of a "
              "real armed attack or its aftermath (not a video game, film, fireworks, demolition or unrelated footage)? "
              "lat, lon: your best estimate of where it was filmed, in decimal degrees."
              + (f' The post that carried it said: "{c["claimed_place"]}".' if c["claimed_place"] else ""))
    out = None
    try:
        ws = os.environ.get("ANTHROPIC_WORKSPACE_ID")  # needed when the key is not scoped to one workspace
        resp = anthropic.Anthropic(default_headers={"anthropic-workspace-id": ws} if ws else None).messages.create(
            model=CLAUDE, max_tokens=16000,
            messages=[{"role": "user", "content": frames + [{"type": "text", "text": prompt}]}],
            output_config={"format": {"type": "json_schema", "schema": {
                "type": "object",
                "properties": {"real_strike": {"type": "boolean"}, "lat": {"type": "number"}, "lon": {"type": "number"}},
                "required": ["real_strike", "lat", "lon"], "additionalProperties": False}}},
        )
        if resp.stop_reason == "refusal":
            print(f"  ! {c['id']} ({CLAUDE}): refused", file=sys.stderr)
        else:
            out = json.loads(next(b.text for b in resp.content if b.type == "text"))
    except anthropic.APIError as e:
        print(f"  ! {c['id']} ({CLAUDE}): {type(e).__name__}: {str(e)[:100]}", file=sys.stderr)
        return None  # an API error is not cached, so a fixed key gets a fresh try
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
    clips = [c for c in bulk.manifest_clips() + bulk.telegram_clips() if splits.get(c["id"]) == split and c["id"] not in bulk.skipped()]
    clips += [c for c in bulk.break_it_clips() if c["split"] == split]  # YouTube links: analyzed by URL, no file
    recs = bulk.run(clips)
    with ThreadPoolExecutor(4) as pool:
        extra = dict(zip((c["id"] for c in clips), pool.map(extras, clips)))
        prev = dict(zip((c["id"] for c in clips), pool.map(previous, clips)))
        other = dict(zip((c["id"] for c in clips), pool.map(claude, clips)))
    truth = truths()
    rows, misses = [], []

    # --- fakes caught: positive = "fake" -------------------------------------------------------------------------
    scored = [c for c in clips if recs[c["id"]]]

    def pr(pred_fake, among=None):
        among = scored if among is None else among
        tp = sum(pred_fake(c) and c["label"] != "real" for c in among)
        fp = sum(pred_fake(c) and c["label"] == "real" for c in among)
        fn = sum(not pred_fake(c) and c["label"] != "real" for c in among)
        return pct(tp, tp + fp), pct(tp, tp + fn)

    wp, wr = pr(lambda c: recs[c["id"]]["fake"]["verdict"] == "fake")
    bp, br = pr(lambda c: bool(extra[c["id"]]["direct"]) and extra[c["id"]]["direct"]["real_strike"] is False)
    pp, prr = pr(lambda c: bool(prev[c["id"]]) and prev[c["id"]]["real_strike"] is False)
    for metric, w, b, p_ in (("precision", wp, bp, pp), ("recall", wr, br, prr)):
        rows.append({"claim": "Fakes caught", "metric": metric, "witness": w, "baseline": b, "unit": "%",
                     "baseline_name": "Single Hydrogen call, no physics or audio checks", "n": len(scored)})
        rows.append({"claim": "Fakes caught", "metric": metric, "witness": w, "baseline": p_, "unit": "%",
                     "baseline_name": f"{gemini.PREVIOUS} asked directly (previous generation)", "n": len(scored)})
    # Claude can only be shown clips we hold as files (frames), so both sides of its rows use that subset.
    seen_by_claude = [c for c in scored if c["path"]]
    cp, cr = pr(lambda c: bool(other[c["id"]]) and other[c["id"]]["real_strike"] is False, seen_by_claude)
    wcp, wcr = pr(lambda c: recs[c["id"]]["fake"]["verdict"] == "fake", seen_by_claude)
    for metric, w, b in (("precision", wcp, cp), ("recall", wcr, cr)) if any(other.values()) else ():
        rows.append({"claim": "Fakes caught", "metric": f"{metric} (file clips only)", "witness": w, "baseline": b, "unit": "%",
                     "baseline_name": CLAUDE_NAME, "n": len(seen_by_claude)})
    for c in scored:
        fake = recs[c["id"]]["fake"]
        if (fake["verdict"] == "fake") != (c["label"] != "real") and fake["verdict"] != "unsure":
            failed = [k["detail"] for k in fake["checks"] if k["result"] == "fail"]
            misses.append((fake["confidence"], c, "real strike" if c["label"] == "real" else c["label"].replace("_", " "),
                           f"rejected: {fake['label']}" if fake["verdict"] == "fake" else "accepted as real strike footage",
                           failed[0] if failed else next(k["detail"] for k in fake["checks"] if k["name"] == "render_hud")))

    # --- geolocation (with post text) ------------------------------------------------------------------------------
    located = [(c, recs[c["id"]]["location"], truth[c["id"]]) for c in scored
               if c["label"] == "real" and c["id"] in truth and recs[c["id"]]["location"]]
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
        for old, old_name in (
                ([geo.dist_m((prev[c["id"]]["lat"], prev[c["id"]]["lon"]), t) / 1000 for c, _, t in located if prev[c["id"]]],
                 f"{gemini.PREVIOUS} asked directly (previous generation)"),
                ([geo.dist_m((other[c["id"]]["lat"], other[c["id"]]["lon"]), t) / 1000 for c, _, t in located if other[c["id"]]],
                 CLAUDE_NAME)):
            if not old:
                continue
            rows += [
                {"claim": "Geolocation works", "metric": "within 1 km", "witness": pct(sum(e <= 1 for e in err), n),
                 "baseline": pct(sum(e <= 1 for e in old), len(old)), "unit": "%", "baseline_name": old_name, "n": n},
                {"claim": "Geolocation works", "metric": "within 5 km", "witness": pct(sum(e <= 5 for e in err), n),
                 "baseline": pct(sum(e <= 5 for e in old), len(old)), "unit": "%", "baseline_name": old_name, "n": n},
                {"claim": "Geolocation works", "metric": "median error", "witness": round(statistics.median(err), 1),
                 "baseline": round(statistics.median(old), 1), "unit": "km", "baseline_name": old_name, "n": n},
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
            if hc["hidden"]:
                continue
            hero_clips.append({"id": hc["url"], "path": hc["path"], "url": hc["url"], "posted_at": hc["posted_at"],
                               "claimed_place": h["city"], "city": h["city"], "date": h["date"]})
            true_inc[hc["url"]] = h["id"]
    hrecs = bulk.run(hero_clips)
    by_day = {}
    for hc in hero_clips:
        # a real pile only has the post's own date; the hero's true date is used when the post time is unknown
        by_day.setdefault((hc["city"], (hc["posted_at"] or hc["date"])[:10]), []).append(hc["id"])
    predicted = bulk.group([{"id": hc["id"], "record": hrecs[hc["id"]], "city": hc["city"]} for hc in hero_clips])
    for g in predicted:
        print("  group:", sorted(f"{true_inc[i]}:{i.split('/')[-1]}" for i in g), file=sys.stderr)
    print("  not grouped (failed or rejected):", [i for i in true_inc if not any(i in g for g in predicted)], file=sys.stderr)
    rows.append({"claim": "Grouping", "metric": "hero clips grouped correctly",
                 "witness": grouping_accuracy(predicted, true_inc),
                 "baseline": grouping_accuracy(list(by_day.values()), true_inc), "unit": "%",
                 "baseline_name": "Group by claimed city + date", "n": len(hero_clips)})

    # --- ablation: the same "real strike?" question on full video, 5 frames, transcript ------------------------------
    filed = [c for c in scored if c["path"]]  # the three input arms need the file itself

    def acc(score_of):
        return pct(sum((s := score_of(c)) is not None and (s >= 0.5) == (c["label"] == "real") for c in filed), len(filed))

    ablation = {"metric": "fake accuracy (real strike or not)", "unit": "%",
                "full_video": acc(lambda c: cached(recs[c["id"]]["sha256"])["raw"]["scores"]["real_strike"]),
                "frames_5": acc(lambda c: extra[c["id"]]["frames_5"]), "transcript": acc(lambda c: extra[c["id"]]["transcript"]),
                "n": len(filed)}

    # --- worst misses: largest errors first; thumbnails from Commons clips only ---------------------------------------
    worst = []
    (PUBLIC / "eval").mkdir(exist_ok=True)
    for old in (PUBLIC / "eval").glob("miss_*.jpg"):
        old.unlink()  # never leave a thumbnail from an earlier run behind
    for n, (_, c, expected, got, why) in enumerate(sorted(misses, key=lambda m: -m[0])[:3], 1):
        thumb = None
        # §9.3: thumbnails come from Commons clips only (CC BY), never from social clips
        if c["path"] and "commons.wikimedia.org" in (c["url"] or "") and recs[c["id"]]["triage"]["graphic_level"] < 2:
            shutil.copy(ingest.prepare(c["path"])["frames"][2], PUBLIC / "eval" / f"miss_{n}.jpg")
            thumb = f"eval/miss_{n}.jpg"
        worst.append({"clip_id": c["id"], "thumb": thumb, "expected": expected, "got": got, "why": why[:200]})

    res = {"split": split, "frozen_at": datetime.now(timezone.utc).isoformat(timespec="seconds") if split == "test" else None,
           "n_clips": len(clips), "rows": rows, "ablation": ablation, "worst_misses": worst}
    contract.check_results(res)
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    shutil.copy(OUT, PUBLIC / "eval" / "results.json")
    for r in rows:
        print(f"{r['claim']:22s} {r['metric']:32s} witness {r['witness']!s:>5} {r['unit']:2s}  baseline {r['baseline']!s:>5}  n={r['n']}  [{str(r['baseline_name'])[:34]}]")
    print("ablation", ablation)
    print("worst misses", [(w["clip_id"], w["got"]) for w in worst])


if __name__ == "__main__":
    assert grouping_accuracy([["a", "b"], ["c"]], {"a": 1, "b": 1, "c": 2}) == 100
    assert grouping_accuracy([["a", "b", "c"]], {"a": 1, "b": 1, "c": 2}) == 67
    assert grouping_accuracy([["a"], ["b"], ["c"]], {"a": 1, "b": 1, "c": 2}) == 67
    main(sys.argv[sys.argv.index("--split") + 1])
