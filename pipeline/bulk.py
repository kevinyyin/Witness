"""Bulk run + grouping (§8, PLAN_PIPELINE.md §C.9).

    python -m pipeline.bulk [--limit N]

Runs every local clip that is neither a hero clip nor a test-split eval clip, groups the results and
rewrites incidents/index.json. Test-split clips are left alone so the test set runs once, after the freeze.
"""
import csv
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from . import DATA, ROOT, geo
from .clip import analyze

GROUP_RADIUS_M = 2000
GROUP_WINDOW_S = 6 * 3600


def manifest_clips():
    """Commons clips from data/manifest.csv that are on disk. local_path is a Windows path: match by file stem."""
    on_disk = {p.stem: p for p in (DATA / "videos").rglob("*") if p.is_file()}
    out = []
    for r in csv.DictReader(open(DATA / "manifest.csv", encoding="utf-8-sig")):
        stem = r["local_path"].replace("\\", "/").split("/")[-1].rsplit(".", 1)[0]
        if stem in on_disk:
            p = on_disk[stem]
            label = "real" if r["kind"] == "strike" else {"thunderstorm": "not_war"}.get(p.parent.name, p.parent.name)
            out.append({"id": r["clip_id"], "path": p, "url": r["page"], "posted_at": None, "claimed_place": r["title"],
                        "label": label, "date": r["date"]})
    return out


def telegram_clips():
    """Downloaded Telegram clips that are not hero clips."""
    hero = {r["local_file"] for r in csv.DictReader(open(ROOT / "data_meta" / "heroes.csv", encoding="utf-8-sig"))}
    posted = {}
    for line in open(DATA / "custody" / "manifest.jsonl", encoding="utf-8"):
        d = json.loads(line)
        posted[d.get("local_path")] = d.get("posted_at")
    captions = {r["url"]: r["caption"] for r in csv.DictReader(open(DATA / "telegram_clips.csv", encoding="utf-8-sig"))}
    out = []
    for p in sorted((DATA / "telegram").glob("*/*.mp4")):
        rel = str(p.relative_to(DATA))
        if rel in hero:
            continue
        channel, post = p.stem.rsplit("_", 1)
        url = f"https://t.me/{channel}/{post}"
        out.append({"id": p.stem, "path": p, "url": url, "posted_at": posted[rel] + "+00:00" if posted.get(rel) else None,
                    "claimed_place": (captions.get(url) or "")[:300] or None, "label": None, "date": (posted.get(rel) or "")[:10]})
    return out


def split_of():
    f = ROOT / "eval" / "split.csv"
    return {r["clip_id"]: r["split"] for r in csv.DictReader(open(f, encoding="utf-8"))} if f.exists() else {}


def run(clips, workers=4):
    """Analyze clips in parallel. Returns {clip id: record or None}."""
    def one(c):
        rec = None
        for kind, data in analyze(path=c["path"], claimed_place=c["claimed_place"], posted_at=c["posted_at"], source_url=c["url"]):
            if kind == "error":
                print(f"  ! {c['id']}: {data['stage']}: {data['message'][:120]}", file=sys.stderr)
            elif kind == "result":
                rec = data
        return c["id"], rec

    with ThreadPoolExecutor(workers) as pool:
        return dict(pool.map(one, clips))


def group(items):
    """items: [{"id", "record", "city"}]. Returns groups (lists of ids) of non-rejected clips.

    Strong link: locations overlap (both within GROUP_RADIUS_M) and posts within 6 h, or the same video (pHash).
    Weak link: a clip without a usable location joins the group of the located clip from the same city that was
    posted closest in time, within 6 h.
    """
    items = [i for i in items if i["record"] and i["record"]["fake"]["verdict"] != "fake"]
    parent = {i["id"]: i["id"] for i in items}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def when(i):
        try:
            return datetime.fromisoformat(i["record"]["posted_at"])
        except (TypeError, ValueError):
            return None

    def gap(a, b):
        return abs((when(a) - when(b)).total_seconds()) if when(a) and when(b) else None

    def precise(i):
        loc = i["record"]["location"]
        return loc if loc and loc["radius_m"] <= GROUP_RADIUS_M else None

    by_clip_id = {i["record"]["clip_id"]: i["id"] for i in items}
    for a in items:
        dup = a["record"]["fake"]["checks"][3]["detail"]
        if dup.startswith("same video as") and dup.split()[3].rstrip(",") in by_clip_id:
            parent[find(a["id"])] = find(by_clip_id[dup.split()[3].rstrip(",")])
        for b in items:
            la, lb = precise(a), precise(b)
            if a["id"] < b["id"] and la and lb and (gap(a, b) is None or gap(a, b) <= GROUP_WINDOW_S):
                if geo.dist_m((la["lat"], la["lon"]), (lb["lat"], lb["lon"])) <= la["radius_m"] + lb["radius_m"]:
                    parent[find(a["id"])] = find(b["id"])
    located = [i for i in items if precise(i)]
    for a in items:
        if not precise(a):
            near = [(gap(a, b), b["id"]) for b in located if b["city"] == a["city"] and gap(a, b) is not None and gap(a, b) <= GROUP_WINDOW_S]
            if near:
                parent[find(a["id"])] = find(min(near)[1])
    groups = {}
    for i in items:
        groups.setdefault(find(i["id"]), []).append(i["id"])
    return sorted(groups.values(), key=len, reverse=True)


if __name__ == "__main__":
    split = split_of()
    todo = [c for c in manifest_clips() if split.get(c["id"]) == "dev"] + telegram_clips()
    if "--limit" in sys.argv:
        todo = todo[: int(sys.argv[sys.argv.index("--limit") + 1])]
    print(f"bulk: {len(todo)} clips")
    recs = run(todo)
    items = [{"id": c["id"], "record": recs[c["id"]], "city": geo.find_city(c["claimed_place"])} for c in todo]
    ok = [i for i in items if i["record"]]
    groups = group(items)
    print(f"analyzed {len(ok)}/{len(todo)} · rejected {sum(i['record']['fake']['verdict'] == 'fake' for i in ok)} · "
          f"unsure {sum(i['record']['fake']['verdict'] == 'unsure' for i in ok)} · "
          f"located to ≤ {GROUP_RADIUS_M} m: {sum(bool(i['record']['location'] and i['record']['location']['radius_m'] <= GROUP_RADIUS_M) for i in ok)}")
    print(f"{len(groups)} groups; with 2+ clips: {[g for g in groups if len(g) > 1][:8]}")
    from .incidents import write_index
    idx = write_index()
    print(f"index.json: {len(idx['incidents'])} incidents, {idx['n_clips']} clips, {idx['n_rejected']} rejected")
