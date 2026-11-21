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


def _link(url):
    return url.split("?")[0].strip().rstrip("/").lower()


def telegram_clips():
    """Downloaded Telegram clips that are not hero clips. claimed_place = the post's own caption."""
    hero = {r["local_file"] for r in csv.DictReader(open(ROOT / "data_meta" / "heroes.csv", encoding="utf-8-sig"))}
    captions = {_link(r["link"]): r["caption"] for r in csv.DictReader(open(DATA / "impact_videos_all.csv", encoding="utf-8-sig"))}
    out = []
    for p in sorted((DATA / "telegram").glob("*/*.mp4")):
        if str(p.relative_to(DATA)) in hero:
            continue
        channel, post = p.stem.rsplit("_", 1)
        url = f"https://t.me/{channel}/{post}"
        out.append({"id": p.stem, "path": p, "url": url, "posted_at": None,
                    "claimed_place": (captions.get(_link(url)) or "").strip()[:400] or None, "label": "real", "date": ""})
    return out


def break_it_clips():
    """YouTube links from data_meta/break_it.csv (label and split come with them). Analyzed by URL, no download."""
    f = ROOT / "data_meta" / "break_it.csv"
    if not f.exists():
        return []
    label = {"real_strike": "real", "fireworks_demolition": "fireworks"}
    return [{"id": "yt_" + r["url"].split("v=")[-1][:11], "path": None, "url": r["url"], "posted_at": None, "claimed_place": None,
             "label": label.get(r["label"], r["label"]), "date": "", "split": r["split"]}
            for r in csv.DictReader(open(f, encoding="utf-8-sig"))]


def skipped():
    """Clip ids a human screened out (data_meta/screen.csv)."""
    f = ROOT / "data_meta" / "screen.csv"
    return {r["clip_id"] for r in csv.DictReader(open(f, encoding="utf-8-sig")) if r.get("screen", "").strip().lower() == "skip"} if f.exists() else set()


def split_of():
    f = ROOT / "eval" / "split.csv"
    return {r["clip_id"]: r["split"] for r in csv.DictReader(open(f, encoding="utf-8"))} if f.exists() else {}


def run(clips, workers=8):
    """Analyze clips in parallel. Returns {clip id: record or None}."""
    def one(c):
        rec = None
        src = {"path": c["path"], "source_url": c["url"]} if c["path"] else {"url": c["url"]}
        for kind, data in analyze(claimed_place=c["claimed_place"], posted_at=c["posted_at"], **src):
            if kind == "error":
                print(f"  ! {c['id']}: {data['stage']}: {data['message'][:120]}", file=sys.stderr)
            elif kind == "result":
                rec = data
        return c["id"], rec

    with ThreadPoolExecutor(workers) as pool:
        return dict(pool.map(one, clips))


def group(items):
    """items: [{"id", "record", "city"}]. Returns groups (lists of ids) of non-rejected clips.

    1. Coarse: same city, posted within 6 h of another clip in the group (or post time unknown).
    2. Inside a coarse group, clips located to within GROUP_RADIUS_M cluster by overlapping radius;
       the same video (pHash) always stays together.
    3. If a coarse group holds two or more such clusters it is split, and each clip without a usable
       location follows the located clip posted closest in time.
    """
    items = [i for i in items if i["record"] and i["record"]["fake"]["verdict"] != "fake"]

    def unions(members, linked):
        parent = {m["id"]: m["id"] for m in members}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for a in members:
            for b in members:
                if a["id"] < b["id"] and linked(a, b):
                    parent[find(a["id"])] = find(b["id"])
        out = {}
        for m in members:
            out.setdefault(find(m["id"]), []).append(m)
        return list(out.values())

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

    def same_video(a, b):
        ids = {a["record"]["clip_id"], b["record"]["clip_id"]}
        return any(x["record"]["fake"]["checks"][3]["detail"].startswith("same video as")
                   and x["record"]["fake"]["checks"][3]["detail"].split()[3].rstrip(",") in ids for x in (a, b))

    def overlap(a, b):
        la, lb = precise(a), precise(b)
        return bool(la and lb) and geo.dist_m((la["lat"], la["lon"]), (lb["lat"], lb["lon"])) <= la["radius_m"] + lb["radius_m"]

    groups = []
    coarse = unions(items, lambda a, b: same_video(a, b) or (a["city"] and a["city"] == b["city"] and (gap(a, b) is None or gap(a, b) <= GROUP_WINDOW_S)))
    for members in coarse:
        clusters = unions([m for m in members if precise(m)], lambda a, b: overlap(a, b) or same_video(a, b))
        if len(clusters) < 2:
            groups.append([m["id"] for m in members])
            continue
        for m in members:
            if not precise(m):
                best = min(clusters, key=lambda c: min((gap(m, x) if gap(m, x) is not None else float("inf")) for x in c))
                best.append(m)
        groups += [[m["id"] for m in c] for c in clusters]
    return sorted(groups, key=len, reverse=True)


if __name__ == "__main__":
    split = split_of()
    todo = [c for c in manifest_clips() + telegram_clips() if split.get(c["id"]) != "test" and c["id"] not in skipped()]
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
