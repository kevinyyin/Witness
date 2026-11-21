"""Geolocation funnel (§8): claimed place -> city -> Hydrogen landmarks -> OSM name search -> candidates -> radius.

Never reads data/answer_keys/. Never called for a clip with military_object >= 0.5 (§13).
"""
import json
import math
import re
from difflib import SequenceMatcher
from functools import lru_cache

from . import DATA, gemini

# city: (lat, lon, radius_m, name variants). Radius roughly covers the built-up area.
CITIES = {
    "Kharkiv": (49.9935, 36.2304, 12000, ["kharkiv", "kharkov", "харк", "харьк"]),
    "Kyiv": (50.4501, 30.5234, 15000, ["kyiv", "kiev", "київ", "києв", "киев"]),
    "Odesa": (46.4825, 30.7233, 10000, ["odesa", "odessa", "одес"]),
    "Dnipro": (48.4647, 35.0462, 12000, ["dnipro", "dnepr", "дніпр", "днепр"]),
    "Zaporizhzhia": (47.8388, 35.1396, 12000, ["zaporizhzhia", "zaporizhia", "zaporozh", "запор"]),
    "Lviv": (49.8397, 24.0297, 9000, ["lviv", "lvov", "львів", "львов"]),
    "Kherson": (46.6354, 32.6169, 8000, ["kherson", "херсон"]),
    "Mykolaiv": (46.9750, 31.9946, 9000, ["mykolaiv", "nikolaev", "миколаїв", "миколаєв", "николаев"]),
    "Sumy": (50.9077, 34.7981, 7000, ["sumy", "суми", "сумы", "сумах"]),
    "Chernihiv": (51.4982, 31.2893, 7000, ["chernihiv", "chernigov", "черніг", "черниг"]),
    "Kryvyi Rih": (47.9105, 33.3918, 15000, ["kryvyi rih", "krivoy rog", "кривий ріг", "кривого рогу", "кривому розі", "кривой рог"]),
    "Poltava": (49.5883, 34.5514, 7000, ["poltava", "полтав"]),
}
CLEAR_LEAD = 0.2  # Decisions score gap that lets one candidate win outright
SIGHT_M = 300     # a landmark seen in the clip puts the camera within about this distance of it
UNKNOWN = {"lat": 48.38, "lon": 31.17, "radius_m": 700000, "level": "unknown", "method": "none", "evidence": [], "candidates": 0}


def dist_m(a, b):
    p = math.pi / 180
    h = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 12742000 * math.asin(math.sqrt(h))


def bearing_deg(a, b):
    p = math.pi / 180
    y = math.sin((b[1] - a[1]) * p) * math.cos(b[0] * p)
    x = math.cos(a[0] * p) * math.sin(b[0] * p) - math.sin(a[0] * p) * math.cos(b[0] * p) * math.cos((b[1] - a[1]) * p)
    return round(math.degrees(math.atan2(y, x)) % 360)


def find_city(text):
    low = (text or "").lower()
    return next((c for c, v in CITIES.items() if any(n in low for n in v[3])), None)


def _norm(s):
    return re.sub(r"[^\w ]", "", (s or "").lower()).strip()


@lru_cache
def _landmarks(city):
    f = DATA / "osm" / f"{city}_landmarks.json"
    return json.loads(f.read_text(encoding="utf-8"))["elements"] if f.exists() else []


def search(city, name):
    """OSM places in the city whose name matches. Each hit: (lat, lon, osm name, description for scoring)."""
    q = _norm(name)
    if len(q) < 4:
        return []
    hits = []
    for e in _landmarks(city):
        tags = e.get("tags", {})
        for k in ("name", "name:en", "name:uk", "name:ru"):
            n = _norm(tags.get(k))
            if n and (q in n or SequenceMatcher(None, q, n).ratio() >= 0.85):
                c = e.get("center", e)
                kind = tags.get("amenity") or tags.get("tourism") or tags.get("shop") or tags.get("leisure") or tags.get("railway") or ""
                desc = "; ".join(x for x in (tags.get("name"), tags.get("name:en"), kind.replace("_", " "), tags.get("addr:street")) if x)
                hits.append((c["lat"], c["lon"], tags.get("name", name), desc))
                break
    return hits


def locate(seen, claimed_place, decide_input):
    """§9.1 `location` for a clip. decide_input = what the Decisions API scores (video block list or text)."""
    city = find_city(claimed_place)
    method = "claimed_place"
    if not city:
        city, method = find_city(seen.get("city_guess")), "city named in clip"
    if not city:
        return dict(UNKNOWN)
    lat, lon, radius, _ = CITIES[city]
    city_only = {"lat": lat, "lon": lon, "radius_m": radius, "level": "city", "method": method,
                 "evidence": [f"{method}: {city}"], "candidates": 0}

    leads = []
    for lm in seen.get("landmarks") or []:
        hits = search(city, lm.get("name")) or search(city, lm.get("name_en"))
        if hits:
            leads.append((lm, hits))
    if not leads:
        return city_only
    leads.sort(key=lambda l: len(l[1]))  # the name with the fewest map matches is the most specific lead
    cands = leads[0][1]
    others = [h for _, hs in leads[1:] for h in hs]
    cands = [c for c in cands if any(dist_m(c, o) <= 1000 for o in others)] or cands  # landmarks seen together lie together
    n = len(cands)
    cands = cands[:10]
    try:
        weights = gemini.same_place(decide_input, [f"{c[3]} ({city})" for c in cands])
    except Exception:
        weights = [0.5] * len(cands)  # the funnel still works without the extra scoring
    ranked = sorted(zip(cands, weights), key=lambda cw: -cw[1])
    if len(ranked) == 1 or ranked[0][1] - ranked[1][1] >= CLEAR_LEAD:
        kept = ranked[:1]  # one candidate clearly fits the footage best
    else:
        kept = [cw for cw in ranked if cw[1] >= 0.5] or ranked
    total = sum(w for _, w in kept) or 1.0
    centre = (sum(c[0] * w for c, w in kept) / total, sum(c[1] * w for c, w in kept) / total)
    r = int(max(dist_m(centre, c) for c, _ in kept) + SIGHT_M)
    if r > radius:
        return city_only | {"candidates": n}
    ts = lambda s: f"{int(s) // 60}:{int(s) % 60:02d}"
    return {"lat": round(centre[0], 5), "lon": round(centre[1], 5), "radius_m": r,
            "level": "point" if r <= 300 else "district" if r <= 5000 else "city", "method": "landmarks+osm",
            "evidence": [f"{lm.get('name') or lm.get('name_en')} {ts(lm.get('clip_ts') or 0)}" for lm, _ in leads[:4]],
            "candidates": n}


if __name__ == "__main__":
    assert find_city("Удар по Харкову") == "Kharkiv" and find_city("somewhere") is None
    assert 7000 < dist_m((50, 36), (50, 36.1)) < 7300 and bearing_deg((50, 36), (51, 36)) == 0
    assert locate({"landmarks": [], "city_guess": ""}, None, "x")["level"] == "unknown"
    assert locate({"landmarks": [], "city_guess": ""}, "Kharkiv", "x")["level"] == "city"
    print("geo selftest OK")
