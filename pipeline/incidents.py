"""Hero incidents -> §9.2 JSON in web/public/incidents/, key-checked against the sample before writing.

    python -m pipeline.incidents --list
    python -m pipeline.incidents --hero 0001|all [--carbon]

Design: PLAN_PIPELINE.md §C.4, C.7, C.8, C.10. The answer key is copied into `answer_key` and never used to locate.
"""
import csv
import json
import math
import os
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from . import CACHE, DATA, PUBLIC, ROOT, contract, geo
from .clip import analyze, cached, mmss
from .physics import SOUND_M_S

KYIV = ZoneInfo("Europe/Kyiv")
# Telegram/X clips play as seekable local files: the organizers allowed it (§13 Q3, confirmed by the user Nov 21, 12:07).
# WITNESS_SOCIAL_FILES=0 switches back to official embeds.
SOCIAL_FILES = os.environ.get("WITNESS_SOCIAL_FILES", "1") == "1"
FLAG_LABELS = {
    "residential": "Residential building", "protected_site": "Hospital / school / worship / shelter nearby",
    "dense_population": "Densely populated", "night_strike": "Night strike",
    "indiscriminate_weapon": "Indiscriminate-weapon indicator", "second_strike": "Second strike on responders",
    "uxo": "Unexploded ordnance visible", "military_object": "Military object visible",
}
PROTECTED = {"hospital", "clinic", "school", "kindergarten", "place_of_worship", "shelter", "university", "college",
             "church", "cathedral", "chapel", "mosque", "synagogue"}
HOMES = {"apartments": "apartment block", "residential": "residential building", "house": "house",
         "detached": "house", "dormitory": "dormitory"}


def heroes():
    """The hero list from data_meta/heroes.csv (§4.3). Its answer-key columns only ever reach `answer_key`."""
    posted = {}
    for line in open(DATA / "custody" / "manifest.jsonl", encoding="utf-8"):
        d = json.loads(line)
        if d.get("posted_at") and d.get("source_url"):
            posted[d["source_url"]] = d["posted_at"]
    out = {}
    for r in csv.DictReader(open(ROOT / "data_meta" / "heroes.csv", encoding="utf-8-sig")):
        h = out.setdefault(r["hero_id"], {
            "id": r["hero_id"], "date": r["date"], "city": r["city"], "osm_file": DATA / r["osm_file"], "clips": [],
            "answer_key": {"source": r["answer_key_source"], "lat": float(r["answer_key_lat"]), "lon": float(r["answer_key_lon"]),
                           "url": r["answer_key_url"]}})
        if not r["local_file"].strip() or not (DATA / r["local_file"]).is_file():
            continue  # listed but not downloaded (or not in this copy of the data folder): nothing to analyze
        h["clips"].append({"path": DATA / r["local_file"], "url": r["clip_url"],
                           # Telegram post times are UTC
                           "posted_at": posted[r["clip_url"]] + "+00:00" if r["clip_url"] in posted else None})
    return list(out.values())


def _xy(origin, p):
    """Local metres east/north of origin (fine at city scale)."""
    return ((p[1] - origin[1]) * 111320 * math.cos(math.radians(origin[0])), (p[0] - origin[0]) * 110540)


def ring_fit(rings, start):
    """Least-squares point whose distance to each camera matches its flash-to-boom distance. Returns (lat, lon, rms_m)."""
    origin = start
    cams = [(_xy(origin, c), d) for c, d in rings]
    x = y = 0.0
    for _ in range(300):
        gx = gy = 0.0
        for (cx, cy), d in cams:
            r = math.hypot(x - cx, y - cy) or 1e-6
            gx += (r - d) * (x - cx) / r
            gy += (r - d) * (y - cy) / r
        x, y = x - 0.5 * gx / len(cams), y - 0.5 * gy / len(cams)
    rms = math.sqrt(sum((math.hypot(x - cx, y - cy) - d) ** 2 for (cx, cy), d in cams) / len(cams))
    return origin[0] + y / 110540, origin[1] + x / (111320 * math.cos(math.radians(origin[0]))), rms


def _centre(el):
    g = el["geometry"]
    return sum(p["lat"] for p in g) / len(g), sum(p["lon"] for p in g) / len(g)


def _player(rec, path):
    if rec["platform"] == "youtube":
        return "youtube", None
    if rec["platform"] in ("commons", "upload") or SOCIAL_FILES:
        return "file", "/api/media/" + str(path.resolve().relative_to(DATA.resolve()))
    return "embed", None


def _item(kind, label, confidence, t, anchor, source=None, clip_ts=None, basis=(), t_end=None):
    return {"type": kind, "label": label, "confidence": confidence, "t": t, "t_end": t_end, "anchor": anchor,
            "source": source, "clip_ts": clip_ts, "basis": list(basis)}


def assemble(hero):
    # 1. every clip through the clip pipeline (cached), four at a time
    def run(clip):
        rec = None
        for kind, data in analyze(path=clip["path"], claimed_place=hero["city"], posted_at=clip["posted_at"], source_url=clip["url"]):
            if kind == "error":
                print(f"  ! {clip['path'].name}: {data['stage']}: {data['message']}", file=sys.stderr)
            elif kind == "result":
                rec = data
        return rec

    with ThreadPoolExecutor(4) as pool:
        recs = list(pool.map(run, hero["clips"]))
    S, seen_sha = [], set()
    for clip, rec in zip(hero["clips"], recs):
        if rec is None or rec["sha256"] in seen_sha:  # failed, or the very same file posted twice
            continue
        seen_sha.add(rec["sha256"])
        raw = cached(rec["sha256"])["raw"]
        S.append({"id": chr(ord("A") + len(S)), "rec": rec, "raw": raw, "clip": clip, "phys": raw["phys"],
                  "fake": rec["fake"]["verdict"] == "fake", "camera": None, "boom": None, "offset": None, "aligned": False})
    live = [s for s in S if not s["fake"]]
    assert live, "no usable clip in this hero"

    # 2. cameras from each clip's own location
    for s in live:
        loc = s["rec"]["location"]
        if loc and loc["level"] in ("point", "district") and loc["radius_m"] <= 1000:
            s["camera"] = {"lat": loc["lat"], "lon": loc["lon"], "heading_deg": 0, "fov_deg": 60, "radius_m": loc["radius_m"],
                           "confidence": round(min(0.9, max(0.1, 1 - loc["radius_m"] / 1000)), 2)}

    # 3. clips with a flash: t = 0 is their flash; flash-to-boom gives the evidence ring
    for s in live:
        ph = s["phys"]
        if ph["delta_s"] is not None:
            s["offset"], s["aligned"] = round(-ph["flash_ts"], 2), True
            if ph["refined"] and ph["delta_s"] >= 0.05:
                s["boom"] = round(SOUND_M_S * ph["delta_s"])

    # 4. impact: evidence rings -> the best-located clip (landmarks) -> claimed place
    located = [s["rec"]["location"] for s in live if s["rec"]["location"]]
    loc = min(located, key=lambda l: l["radius_m"]) if located else geo.locate({"landmarks": []}, hero["city"], "")
    rings = [((s["camera"]["lat"], s["camera"]["lon"]), s["boom"]) for s in live if s["camera"] and s["boom"]]
    if len(rings) >= 2:
        lat, lon, rms = ring_fit(rings, (loc["lat"], loc["lon"]))
        cam_r = sum(s["camera"]["radius_m"] for s in live if s["camera"] and s["boom"]) / len(rings)
        impact = {"lat": round(lat, 5), "lon": round(lon, 5), "radius_m": int(max(40, rms + cam_r)), "method": "evidence_rings",
                  "confidence": round(max(0.3, 0.85 - rms / 1000), 2)}
    elif loc["level"] in ("point", "district"):
        impact = {"lat": loc["lat"], "lon": loc["lon"], "radius_m": loc["radius_m"], "method": "landmarks",
                  "confidence": 0.6 if loc["radius_m"] <= 300 else 0.45 if loc["radius_m"] <= 1000 else 0.3}
    else:
        impact = {"lat": loc["lat"], "lon": loc["lon"], "radius_m": loc["radius_m"], "method": "claimed_place", "confidence": 0.15}
    ip = (impact["lat"], impact["lon"])
    for s in live:
        if s["camera"]:
            s["camera"]["heading_deg"] = geo.bearing_deg((s["camera"]["lat"], s["camera"]["lon"]), ip)

    # 5. remaining offsets: boom-only clips by sound travel, the rest by post time
    posts = [datetime.fromisoformat(s["clip"]["posted_at"]) for s in live if s["clip"]["posted_at"]]
    first_post = min(posts) if posts else None
    for s in live:
        if s["offset"] is not None:
            continue
        if s["phys"]["blast_times"]:
            if s["camera"]:
                d = geo.dist_m((s["camera"]["lat"], s["camera"]["lon"]), ip)
                s["offset"], s["aligned"] = round(d / SOUND_M_S - s["phys"]["blast_times"][0], 2), True
            else:
                s["offset"] = round(-s["phys"]["blast_times"][0], 2)  # approx: camera distance unknown
        elif s["clip"]["posted_at"] and first_post:
            s["offset"] = round(max(30.0, (datetime.fromisoformat(s["clip"]["posted_at"]) - first_post).total_seconds()), 2)

    # 6. the impact event comes from a seekable clip (§9.2)
    for s in S:
        s["player"], s["media_url"] = _player(s["rec"], s["clip"]["path"])

    def flash_conf(s):
        return max((e["confidence"] for e in s["rec"]["timeline"] if e["type"] == "flash"), default=0)

    seekable = [s for s in live if s["player"] in ("youtube", "file")]
    with_flash = [s for s in seekable if s["phys"]["delta_s"] is not None]
    assert seekable, "no seekable clip: the impact clip must be 'youtube' or 'file' (set WITNESS_SOCIAL_FILES=1 once organizers allow it)"
    star = max(with_flash, key=flash_conf) if with_flash else seekable[0]
    if not with_flash and star["offset"] is None:
        star["offset"] = 0.0

    # 7. incident timeline: t = clip_ts + offset_s
    timeline = [{"t": 0.0, "type": "impact", "source": star["id"],
                 "clip_ts": star["phys"]["flash_ts"] if with_flash else round(-star["offset"], 2),
                 "confidence": flash_conf(star) if with_flash else 0.3}]
    for s in live:
        if s["offset"] is None:
            continue
        booms = [s["phys"]["blast_ts"]] if s["phys"]["delta_s"] is not None else s["phys"]["blast_times"][:1]
        for b in booms:
            timeline.append({"t": round(b + s["offset"], 2), "type": "boom_heard", "source": s["id"], "clip_ts": b, "confidence": 0.9})
        for e in s["rec"]["timeline"]:
            if e["type"] in ("siren", "engine_buzz", "jet", "burst", "fire", "rescue", "gunfire"):
                timeline.append({"t": round(e["clip_ts"] + s["offset"], 2), "type": e["type"], "source": s["id"],
                                 "clip_ts": e["clip_ts"], "confidence": e["confidence"]})
    timeline.sort(key=lambda e: e["t"])

    # 8. target: the OSM building nearest the impact, from the hero's building extract (its centre is never read)
    osm_path = hero["osm_file"]
    assert osm_path.is_file(), "heroes.csv names no building extract for this hero: no reconstruction written"
    osm = json.loads(osm_path.read_text(encoding="utf-8"))
    buildings = [e for e in osm["elements"] if e.get("geometry") and e.get("tags", {}).get("building")]
    near = sorted(buildings, key=lambda e: geo.dist_m(_centre(e), ip))
    saw_homes = any("apartment" in str(lm.get("kind", "")).lower() for s in live for lm in s["raw"]["seen"].get("landmarks") or [])
    # the nearest building, or the nearest home inside the radius when the clips show apartment blocks
    tb = next((e for e in near if saw_homes and e["tags"]["building"] in HOMES and geo.dist_m(_centre(e), ip) <= impact["radius_m"]), near[0])
    tags = tb["tags"]
    assert geo.dist_m(_centre(near[0]), ip) <= impact["radius_m"] + 300, "the impact estimate is outside the hero's building extract: no reconstruction written"
    target = {"osm_id": f"{tb['type']}/{tb['id']}", "footprint": [[p["lon"], p["lat"]] for p in tb["geometry"]],
              "levels": int(float(tags.get("building:levels", 5))) if str(tags.get("building:levels", "5")).replace(".", "").isdigit() else 5,
              "osm_tags": tags,
              "visual_basis": [f"{s['id']}@{mmss(lm.get('clip_ts') or 0)} {lm.get('kind')}" for s in live
                               for lm in (s["raw"]["seen"].get("landmarks") or []) if "apartment" in str(lm.get("kind", "")).lower()][:3]}

    # 9. time: only post times are known
    if first_post:
        when, pm, basis = first_post.astimezone(KYIV), 3600, "earliest post time; the impact is earlier by an unknown amount"
    else:
        when, pm, basis = datetime.fromisoformat(hero["date"] + "T12:00:00").replace(tzinfo=KYIV), 43200, "post date only; time of day unknown"
    time = {"impact_local": when.isoformat(timespec="seconds"), "plus_minus_s": pm, "basis": basis}

    # 10. weapon indicators: mean over clips that show the strike
    strike = [s for s in live if s["rec"]["triage"]["event_type"]["strike"] >= 0.5] or live
    options = {k: round(sum(s["rec"]["weapon"]["options"][k] for s in strike) / len(strike), 2) for k in strike[0]["rec"]["weapon"]["options"]}
    weapon = {"options": options, "evidence": [f"{s['id']}@{ev}" for s in strike for ev in s["rec"]["weapon"]["evidence"][:1]][:4]}

    # 11. the eight flags, in order (code rules; §7.1.7)
    def flag(kind, raised=False, label=None, confidence=None, t=None, anchor=None, source=None, clip_ts=None, basis=()):
        f = _item(kind, label if raised and label else FLAG_LABELS[kind], confidence if raised else None, t if raised else None,
                  anchor if raised else None, source if raised else None, clip_ts if raised else None, basis if raised else ())
        return {"type": f.pop("type"), "label": f.pop("label"), "status": "raised" if raised else "checked_none", **f}

    vague = impact["method"] == "claimed_place" or impact["radius_m"] > 500  # too uncertain for map-based flags
    n300 = sum(geo.dist_m(_centre(e), ip) <= 300 for e in buildings)
    home = HOMES.get(tags.get("building")) if not vague else None
    reach = max(impact["radius_m"], 150)
    prot = next((e for e in near if (e["tags"].get("amenity") in PROTECTED or e["tags"].get("building") in PROTECTED)
                 and geo.dist_m(_centre(e), ip) <= reach), None) if not vague else None
    hour = when.hour
    burst_t = next((e["t"] for e in timeline if e["type"] == "burst"), 0.0)
    uxo = max(live, key=lambda s: s["rec"]["triage"]["uxo"])
    mil = max(live, key=lambda s: s["rec"]["triage"]["military_object"])
    flags = [
        flag("residential", bool(home), f"Residential building · {target['levels']} floors", 0.9, 0.0,
             {"kind": "building", "ref": target["osm_id"]}, basis=[f"osm:building={tags.get('building')}"]),
        flag("protected_site", bool(prot),
             prot and f"{(prot['tags'].get('amenity') or prot['tags'].get('building')).replace('_', ' ').capitalize()} nearby · {geo.dist_m(_centre(prot), ip):.0f} m from the impact estimate",
             0.8, 0.0, prot and {"kind": "building", "ref": f"{prot['type']}/{prot['id']}"},
             basis=prot and [f"osm:{'amenity' if prot['tags'].get('amenity') in PROTECTED else 'building'}={prot['tags'].get('amenity') or prot['tags'].get('building')}"] or ()),
        flag("dense_population", n300 >= 100 and not vague, f"Densely populated · {n300} buildings within 300 m", 0.85, 0.0,
             {"kind": "impact"}, basis=[f"osm: {n300} buildings within 300 m"]),
        flag("night_strike", pm <= 3600 and (hour >= 22 or hour < 6), f"Night strike ({when:%H:%M} local)", 0.9, 0.0,
             {"kind": "clock"}, basis=["time.impact_local"]),
        flag("indiscriminate_weapon", options["rocket_cluster"] >= 0.6 and n300 >= 100 and not vague, None, options["rocket_cluster"], burst_t,
             {"kind": "impact"}, basis=[f"weapon.rocket_cluster={options['rocket_cluster']}", f"osm: {n300} buildings within 300 m"]),
        flag("second_strike"),  # needs two impact events 5-60 min apart; one impact measured
        flag("uxo", uxo["rec"]["triage"]["uxo"] >= 0.6, None, uxo["rec"]["triage"]["uxo"], uxo["offset"],
             {"kind": "camera", "ref": uxo["id"]}, uxo["id"], 0.0, [f"{uxo['id']}: Decisions uxo {uxo['rec']['triage']['uxo']}"]),
        flag("military_object", mil["rec"]["triage"]["military_object"] >= 0.5, None, mil["rec"]["triage"]["military_object"], mil["offset"],
             {"kind": "camera", "ref": mil["id"]}, mil["id"], 0.0, [f"{mil['id']}: Decisions military_object {mil['rec']['triage']['military_object']}"]),
    ]

    # 12. review notes from code rules (Carbon adds its own later)
    notes = []
    by_clip_id = {s["rec"]["clip_id"]: s for s in S}
    for s in live:
        cam, t0 = s["camera"], None if s["offset"] is None else max(s["offset"], 0.0)
        anchor = {"kind": "camera", "ref": s["id"]}
        if cam and s["boom"] is not None:
            d = geo.dist_m((cam["lat"], cam["lon"]), ip)
            if abs(d - s["boom"]) > cam["radius_m"] + impact["radius_m"]:  # the §9.2 ring guarantee
                notes.append(_item("location_conflict", f"Camera {s['id']} is {d:.0f} m from the impact but its boom delay says {s['boom']} m",
                                   0.8, t0, anchor, s["id"], s["phys"]["blast_ts"], [f"camera distance {d:.0f} m", f"boom_distance_m={s['boom']}"]))
        if cam and cam["radius_m"] > 300:
            notes.append(_item("weak_camera", f"Camera {s['id']} position is weak (±{cam['radius_m']} m)", 0.9, t0, anchor, s["id"], 0.0,
                               [f"camera.radius_m={cam['radius_m']}"]))
        if s["rec"]["triage"]["graphic_level"] >= 2:
            notes.append(_item("graphic", f"Graphic content in clip {s['id']} (blurred)", 0.9, t0, anchor, s["id"], 0.0,
                               [f"graphic_level={s['rec']['triage']['graphic_level']}"]))
        dup = s["rec"]["fake"]["checks"][3]["detail"]
        if dup.startswith("same video as"):
            other = by_clip_id.get(dup.split()[3].rstrip(","))
            notes.append(_item("recycled_or_edited", f"Clip {s['id']} is the same video as {'clip ' + other['id'] if other else 'an earlier upload'}",
                               0.9, t0, anchor, s["id"], 0.0, ["pHash match"]))
    if len([s for s in live if s["phys"]["delta_s"] is not None]) == 1 and with_flash:
        notes.append(_item("single_source", f"The impact is seen in one clip only ({star['id']})", 0.9, 0.0, {"kind": "impact"},
                           star["id"], star["phys"]["flash_ts"], [f"{star['id']}@{mmss(star['phys']['flash_ts'])} flash"]))

    # 13. sources: every clip, rejected ones too
    sources = []
    for s in S:
        rec, link = s["rec"], s["clip"]["url"]
        failed = [c for c in rec["fake"]["checks"] if c["result"] == "fail"]
        sources.append({
            "id": s["id"], "clip_id": rec["clip_id"], "platform": rec["platform"], "url": link, "embed_url": rec["embed_url"],
            "player": s["player"], "media_url": s["media_url"],
            "uploader": link.split("/")[3] if rec["platform"] == "telegram" else "",
            "posted_at": datetime.fromisoformat(s["clip"]["posted_at"]).astimezone(KYIV).isoformat(timespec="seconds") if s["clip"]["posted_at"] else None,
            "duration_s": rec["duration_s"], "camera": s["camera"], "boom_distance_m": s["boom"], "offset_s": s["offset"],
            "aligned": s["aligned"], "authenticity": rec["fake"]["verdict"],
            "reject_reason": f"{rec['fake']['label']}: {failed[0]['detail']}" if s["fake"] else None,
            "graphic_level": rec["triage"]["graphic_level"],
            "license": "CC BY 4.0 · dsns.gov.ua" if rec["platform"] == "commons" else "embed only",
            "findings": [{"clip_ts": e["clip_ts"], "label": e["label"], "confidence": e["confidence"]} for e in rec["timeline"][:6]],
        })

    conflict = any(n["type"] == "location_conflict" for n in notes)
    n_ok = len(live)
    return {
        "id": hero["id"], "city": hero["city"],
        "title": f"Strike on {home}, {hero['city']}" if home else f"Strike in {hero['city']}, {hero['date']}",
        "osm_file": f"osm/{osm_path.name}", "time": time, "impact": impact, "target": target, "weapon": weapon,
        "flags": flags, "review_notes": notes, "timeline": timeline, "sources": sources, "summary": None,
        "verification": {"agree_place": not conflict, "agree_time": True,
                         "corroboration": "high" if n_ok >= 4 and not conflict else "medium" if n_ok >= 2 else "low",
                         "n_sources": n_ok, "n_rejected": len(S) - n_ok},
        "answer_key": hero["answer_key"], "is_sample": False,
    }, osm_path


def add_carbon(incident):
    """The Carbon cross-check (never cut): its review notes and the summary. Carbon never sees the answer key."""
    from . import gemini
    by_id = {s["id"]: s for s in incident["sources"]}
    doc = {k: v for k, v in incident.items() if k not in ("answer_key", "summary")}
    doc["clip_descriptions"] = {s["id"]: cached_observations(s["clip_id"]) for s in incident["sources"]}
    out = gemini.crosscheck(doc)
    have = {(n["type"], n["source"]) for n in incident["review_notes"]}
    for n in (out.get("notes") or [])[:5]:  # model output is untrusted: keep only well-formed notes
        src = by_id.get(n.get("source"))
        letters = [x for x in n.get("sources") or [] if x in by_id]
        text = json.dumps(n, ensure_ascii=False).lower()
        if (src is None or n.get("type") not in ("time_conflict", "location_conflict", "single_source") or (n["type"], n["source"]) in have
                or any(w in text for w in contract.VERDICT_WORDS)):
            continue
        ts = min(max(float(n.get("clip_ts") or 0), 0.0), src["duration_s"])
        anchor = ({"kind": "cameras", "ref": letters} if n["type"] == "time_conflict" and len(letters) >= 2
                  else {"kind": "camera", "ref": src["id"]} if n["type"] != "single_source" else {"kind": "impact"})
        incident["review_notes"].append(_item(
            n["type"], str(n.get("label", ""))[:120], round(min(max(float(n.get("confidence") or 0.5), 0.0), 1.0), 2),
            None if src["offset_s"] is None else round(ts + src["offset_s"], 2), anchor, src["id"], round(ts, 2),
            [str(b)[:80] for b in (n.get("basis") or [])[:4]] + ["Carbon cross-check"]))
    summary = str(out.get("summary") or "").strip()
    incident["summary"] = summary if summary and not any(w in summary.lower() for w in contract.VERDICT_WORDS) else None
    types = {n["type"] for n in incident["review_notes"]}
    incident["verification"]["agree_time"] = "time_conflict" not in types
    incident["verification"]["agree_place"] = "location_conflict" not in types
    if not incident["verification"]["agree_place"] and incident["verification"]["corroboration"] == "high":
        incident["verification"]["corroboration"] = "medium"
    return incident


def cached_observations(clip_id):
    from .clip import cached_by_clip_id
    entry = cached_by_clip_id(clip_id)
    return entry["raw"]["seen"].get("observations", "") if entry else ""


def write_index():
    """web/public/incidents/index.json (§9.3) from the incident files on disk and the clips analyzed so far."""
    incs = [json.loads(f.read_text(encoding="utf-8")) for f in sorted((PUBLIC / "incidents").glob("[0-9]*.json"))]
    recs = [json.loads(f.read_text(encoding="utf-8"))["record"] for f in (CACHE / "clips").glob("*.json")]
    cities = [i["city"] for i in incs]
    index = {"is_sample": False, "city": max(set(cities), key=cities.count), "n_clips": len(recs),
             "n_rejected": sum(r["fake"]["verdict"] == "fake" for r in recs),
             "incidents": [{"id": i["id"], "title": i["title"], "lat": i["impact"]["lat"], "lon": i["impact"]["lon"],
                            "radius_m": i["impact"]["radius_m"], "n_sources": i["verification"]["n_sources"],
                            "corroboration": i["verification"]["corroboration"], "impact_local": i["time"]["impact_local"]}
                           for i in incs]}
    contract.check_index(index)
    (PUBLIC / "incidents" / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    return index


def write(incident, osm_path):
    """Key check, then the file. Refuses a raised military_object flag: the repo is public (§13)."""
    # a reconstruction needs a place: a city-level estimate gives the 3D scene nothing true to draw
    assert incident["impact"]["method"] != "claimed_place", "city-level location only: no reconstruction written"
    contract.check_incident(incident, json.loads((PUBLIC / "sample_incident.json").read_text(encoding="utf-8")))
    (PUBLIC / "incidents").mkdir(exist_ok=True)
    (PUBLIC / "osm").mkdir(exist_ok=True)
    if not (PUBLIC / "osm" / osm_path.name).exists():
        shutil.copy(osm_path, PUBLIC / "osm" / osm_path.name)
    out = PUBLIC / "incidents" / f"{incident['id']}.json"
    out.write_text(json.dumps(incident, ensure_ascii=False, indent=1), encoding="utf-8")
    link = CACHE / "clip_incident.json"
    known = json.loads(link.read_text()) if link.exists() else {}
    known.update({s["clip_id"]: incident["id"] for s in incident["sources"]})
    link.write_text(json.dumps(known))
    return out


if __name__ == "__main__":
    hs = heroes()
    if "--list" in sys.argv:
        for h in hs:
            print(h["id"], h["date"], h["city"], len(h["clips"]), "clips", h["osm_file"].name)
    else:
        want = sys.argv[sys.argv.index("--hero") + 1]
        for h in hs:
            if want in ("all", h["id"]):
                try:
                    inc, osm_file = assemble(h)
                    assert inc["impact"]["method"] != "claimed_place", "city-level location only: no reconstruction written"
                    if "--carbon" in sys.argv:
                        add_carbon(inc)
                    print(write(inc, osm_file), f"· impact {inc['impact']['method']} ±{inc['impact']['radius_m']} m ·",
                          f"{inc['verification']['n_sources']} sources · error vs answer key",
                          f"{geo.dist_m((inc['impact']['lat'], inc['impact']['lon']), (h['answer_key']['lat'], h['answer_key']['lon'])):.0f} m")
                except AssertionError as e:
                    print(f"{h['id']}: NOT WRITTEN\n{e}", file=sys.stderr)
        idx = write_index()
        print(f"index.json: {len(idx['incidents'])} incidents, {idx['n_clips']} clips, {idx['n_rejected']} rejected")
