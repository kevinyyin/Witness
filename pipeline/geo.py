"""Geolocation funnel (§8): claimed place -> city -> Hydrogen landmarks -> OSM name search -> candidates -> radius.

Never reads data/answer_keys/. Never called for a clip with military_object >= 0.5 (§13).
"""
import json
import math
import re
import threading
import time
import urllib.parse
import urllib.request
from difflib import SequenceMatcher
from functools import lru_cache

from . import CACHE, DATA, gemini

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
GUESS_M = 3000    # radius for a single Hydrogen read with nothing to compare it to
AGREE_M = 5000   # reads within this distance of each other count as agreeing
READ_K, READ_BASE_M = 2, 1000  # radius from three reads = K x spread + base: 15 of 17 dev clips fall inside it
_GEOCODE_LOCK = threading.Lock()
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


def search_claim(city, text):
    """OSM places in the city that the post text names outright (a full name of 8+ characters inside the text)."""
    q = _norm(text)
    hits = []
    for e in _landmarks(city):
        tags = e.get("tags", {})
        for k in ("name", "name:en", "name:uk", "name:ru"):
            n = _norm(tags.get(k))
            if len(n) >= 8 and n in q:
                c = e.get("center", e)
                kind = tags.get("amenity") or tags.get("tourism") or tags.get("shop") or tags.get("leisure") or ""
                hits.append((c["lat"], c["lon"], tags.get("name", n),
                             "; ".join(x for x in (tags.get("name"), tags.get("name:en"), kind.replace("_", " "), tags.get("addr:street")) if x)))
                break
    return hits


def geocode(name):
    """Any town by name -> (lat, lon, radius_m), via OpenStreetMap's Nominatim. Cached; None when not found."""
    name = (name or "").strip()
    if len(name) < 3:
        return None
    store = CACHE / "geocode.json"
    with _GEOCODE_LOCK:
        known = json.loads(store.read_text()) if store.exists() else {}
        if name not in known:
            url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
                {"q": name, "format": "json", "limit": 1, "featureType": "settlement"})  # towns, not rivers or streets
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "osm-place-lookup/0.1"})
                hit = json.loads(urllib.request.urlopen(req, timeout=8).read())
                time.sleep(1)  # Nominatim allows one request per second
            except Exception:
                return None  # offline or refused: not cached, the funnel falls back to "unknown"
            if hit:
                s, n, w, e = map(float, hit[0]["boundingbox"])
                r = dist_m((s, w), (n, e)) / 2
                known[name] = [float(hit[0]["lat"]), float(hit[0]["lon"]), int(min(20000, max(3000, r)))]
            else:
                known[name] = None
            store.write_text(json.dumps(known, ensure_ascii=False))
        return tuple(known[name]) if known[name] else None


def _medoid(reads):
    """From up to three independent reads: (lat, lon, name, spread_m, n) or None. Spread = farthest read from the middle one."""
    pts = []
    for r in reads or []:
        try:
            lat, lon = float(r["lat"]), float(r["lon"])
        except (TypeError, KeyError, ValueError):
            continue
        if -90 <= lat <= 90 and -180 <= lon <= 180 and not (abs(lat) < 0.01 and abs(lon) < 0.01):
            pts.append((lat, lon, str(r.get("name") or "")[:80]))
    if not pts:
        return None
    mid = min(pts, key=lambda p: sum(dist_m(p, q) for q in pts))
    return mid[0], mid[1], mid[2], max(dist_m(mid, q) for q in pts), len(pts)


def locate(seen, claimed_place, decide_input, reads=None):
    """§9.1 `location` for a clip. decide_input = what the Decisions API scores (video block list or text).

    1. Town: the one Hydrogen read from the post or the footage, looked up by name; else the built-in city table.
    2. Three independent Hydrogen reads of the place: the middle one is the estimate, and how far the three
       disagree sets the radius (READ_K x spread + READ_BASE_M; tuned on dev clips).
    3. Landmarks read in the footage, and any place the post names, are looked up in OSM. If the Decisions API
       backs one of them against the footage and it agrees with the reads, the estimate narrows to that landmark.
    """
    town = (seen.get("city_guess") or "").strip()
    place, method = geocode(town), "town named in post or clip"
    city = town
    if not place and find_city(claimed_place):
        city, method = find_city(claimed_place), "claimed_place"
        place = CITIES[city][:3]
    mid = _medoid(reads)
    if place and mid and dist_m(mid[:2], place[:2]) > 1.5 * place[2]:
        # The reads and the looked-up town disagree. Two or more reads that agree with each other win: the lookup
        # can return the wrong "Dnipro" (dev: 468 km off). A lone or scattered read loses to the town.
        if mid[4] >= 2 and mid[3] <= AGREE_M:
            place = None
        else:
            mid = None
    if not place and not (mid and mid[4] >= 2):
        return dict(UNKNOWN)
    read_r = int(READ_K * mid[3] + READ_BASE_M) if mid and mid[4] >= 2 else GUESS_M
    if place:
        lat, lon, radius = place
        city_only = {"lat": lat, "lon": lon, "radius_m": radius, "level": "city", "method": method,
                     "evidence": [f"{method}: {city}"], "candidates": 0}
    table_city = find_city(city) or find_city(claimed_place)  # landmark files exist per table city

    leads = []
    if table_city:
        named = search_claim(table_city, claimed_place)
        if named:  # the post names a place on the map: a lead like any landmark, still scored against the footage
            leads.append(({"name": f"post text: {named[0][2]}", "clip_ts": 0}, named))
        for lm in seen.get("landmarks") or []:
            hits = search(table_city, lm.get("name")) or search(table_city, lm.get("name_en"))
            if hits:
                leads.append((lm, hits))
    n = mid[4] if mid else 0
    ts = lambda s: f"{int(s) // 60}:{int(s) % 60:02d}"
    if leads:
        leads.sort(key=lambda l: len(l[1]))  # the name with the fewest map matches is the most specific lead
        cands = leads[0][1]
        others = [h for _, hs in leads[1:] for h in hs]
        cands = ([c for c in cands if any(dist_m(c, o) <= 1000 for o in others)] or cands)[:10]  # landmarks seen together lie together
        n += len(cands)
        ranked = sorted(zip(cands, _backed(decide_input, cands, city)), key=lambda cw: -cw[1])
        clear = ranked[0][1] >= 0.5 and (len(ranked) == 1 or ranked[0][1] - ranked[1][1] >= CLEAR_LEAD)
        agrees = mid is None or dist_m(ranked[0][0], mid[:2]) <= read_r + 500
        if clear and agrees:
            top = ranked[0][0]
            return {"lat": round(top[0], 5), "lon": round(top[1], 5), "radius_m": SIGHT_M, "level": "point", "method": "landmarks+osm",
                    "evidence": [f"{lm.get('name') or lm.get('name_en')} {ts(lm.get('clip_ts') or 0)}" for lm, _ in leads[:4]], "candidates": n}
    if mid:
        if place and read_r > place[2]:
            return city_only | {"candidates": n}
        return {"lat": round(mid[0], 5), "lon": round(mid[1], 5), "radius_m": read_r,
                "level": "district" if read_r <= 5000 else "city", "method": "model reads",
                "evidence": [f"{mid[4]} Hydrogen reads within {mid[3]:.0f} m of each other: {mid[2]}"], "candidates": n}
    return (city_only | {"candidates": n}) if place else dict(UNKNOWN)


def _backed(decide_input, cands, city=""):
    """Decisions scores for candidates; 0.5 each if the call fails (the funnel still works without it)."""
    try:
        return gemini.same_place(decide_input, [f"{c[3]} ({city})" if city else c[3] for c in cands])
    except Exception:
        return [0.5] * len(cands)


if __name__ == "__main__":
    assert find_city("Удар по Харкову") == "Kharkiv" and find_city("somewhere") is None
    assert 7000 < dist_m((50, 36), (50, 36.1)) < 7300 and bearing_deg((50, 36), (51, 36)) == 0
    assert locate({"landmarks": [], "city_guess": ""}, None, "x")["level"] == "unknown"
    three = [{"name": "a", "lat": 50.0, "lon": 36.0}, {"name": "b", "lat": 50.001, "lon": 36.0}, {"name": "c", "lat": 0, "lon": 0}, None]
    assert _medoid(three)[4] == 2 and 100 < _medoid(three)[3] < 120 and _medoid([]) is None
    got = locate({"landmarks": [], "city_guess": ""}, None, "x", three)
    assert got["method"] == "model reads" and 1200 < got["radius_m"] < 1250, got
    assert locate({"landmarks": [], "city_guess": ""}, "Kharkiv", "x")["level"] == "city"
    assert search_claim("Kharkiv", "nothing named here, Kharkiv") == []
    print("geo selftest OK")
