"""K3-mini (throwaway, gate only): Hydrogen landmarks -> OSM name search -> distance to the known location.
Pass = at least 2 of 5 clips within 5 km.
Usage: set -a; source .env; set +a
       python pipeline/killtests/k3_geo.py LANDMARKS.json CLIP:LAT:LON [CLIP:LAT:LON ...]
"""
import json
import math
import re
import sys
from difflib import SequenceMatcher

from k1_safety import hydrogen, upload

SCHEMA = {
    "type": "object",
    "properties": {
        "city_guess": {"type": "string"},
        "landmarks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name exactly as written on signs or as commonly known; empty if unnamed."},
                    "name_en": {"type": "string"},
                    "kind": {"type": "string", "description": "church, mall, metro station, tower, hospital, school, shop, park, other"},
                    "clip_ts": {"type": "number"},
                },
                "required": ["name", "name_en", "kind", "clip_ts"],
            },
        },
    },
    "required": ["city_guess", "landmarks"],
}
PROMPT = (
    "You help investigators find where a video was filmed. List every landmark that could be found on a map: "
    "named buildings, shops, signs with readable text, churches, metro stations, towers, stadiums. "
    "Copy sign text exactly, in its original script. Do not guess names you cannot see or hear."
)


def norm(s):
    return re.sub(r"[^\w ]", "", s.lower()).strip()


def km(a, b):
    p = math.pi / 180
    h = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def search(osm, name):
    q = norm(name)
    if len(q) < 4:
        return []
    hits = []
    for e in osm:
        tags = e.get("tags", {})
        for k in ("name", "name:en", "name:uk", "name:ru"):
            n = norm(tags.get(k, ""))
            if n and (q in n or SequenceMatcher(None, q, n).ratio() >= 0.85):
                c = e.get("center", e)
                hits.append((c["lat"], c["lon"], tags.get("name", "")))
                break
    return hits


def main(argv):
    osm = json.load(open(argv[0], encoding="utf-8"))["elements"]
    within = 0
    for arg in argv[1:]:
        path, lat, lon = arg.rsplit(":", 2)
        truth = (float(lat), float(lon))
        out = hydrogen.interactions.create(
            model="gemini-4-hydrogen",
            input=[upload(path), {"type": "text", "text": PROMPT}],
            response_format={"type": "text", "mime_type": "application/json", "schema": SCHEMA},
        ).output_text
        data = json.loads(out)
        best = None  # the landmark with the fewest map matches is the most specific lead
        for lm in data["landmarks"]:
            hits = search(osm, lm["name"]) or search(osm, lm["name_en"])
            if hits and (best is None or len(hits) < len(best[1])):
                best = (lm, hits)
        names = [lm["name"] or lm["name_en"] or lm["kind"] for lm in data["landmarks"]][:6]
        print(f"{path.split('/')[-1]}: city_guess={data['city_guess']!r} landmarks={names}")
        if best is None:
            print("   no OSM match")
            continue
        lm, hits = best
        est = (sum(h[0] for h in hits) / len(hits), sum(h[1] for h in hits) / len(hits))
        d = km(est, truth)
        nearest = min(km((h[0], h[1]), truth) for h in hits)
        within += d <= 5
        print(f"   lead {lm['name'] or lm['name_en']!r} -> {len(hits)} candidates, centroid {d:.2f} km from truth, nearest candidate {nearest:.2f} km")
    print(f"\nwithin 5 km: {within}/{len(argv) - 1}  ->  {'PASS' if within >= 2 else 'FAIL'} (need 2)")


if __name__ == "__main__":
    assert norm("Собор, Св.") == "собор св" and 0 < km((50, 36), (50, 36.1)) < 8
    main(sys.argv[1:])
