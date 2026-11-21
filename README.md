# Witness

Investigators get hundreds of thousands of war videos with no location, no grouping, and fakes mixed in. Witness takes the pile, throws out the fakes, places each real clip on a map with honest uncertainty, groups clips of the same strike, and lets a human scrub through a 3D reconstruction of each strike with every source video one click away. **It sorts. Humans decide.**

Built at the Gemini 4 NYC Hackathon, Nov 21, 2026.

## Layout
```
web/        Vite + React + three.js: reconstruction view, break-it panel, overview, proof slide
pipeline/   Python 3.11 + FastAPI: ingest, Gemini calls, fake checks, geolocation, incident JSON
eval/       run_eval.py -> eval/results.json
data/       link to the prep data folder (NOT committed, see below)
data_meta/  CSV exports of the shared decision sheet (screening, heroes, break-it links)
```

## How to run
**Web (reconstruction view, break-it panel, overview, proof slide):**
```
cd web
npm install
npm run dev          # http://localhost:5173
```
- `#/` overview · `#/incident/<id>` reconstruction · `#/break` break-it panel · `#/proof` proof slide.
- The Vite dev server proxies `/api` to the pipeline server on `127.0.0.1:8000` (see `pipeline/` and `PLAN_PIPELINE.md`). Without it, the break-it panel replays the recorded runs in `web/public/fixtures/` under a SAMPLE DATA banner.
- Incident data is static: `web/public/incidents/*.json` (pipeline output). `web/public/sample_incident.json` is a hand-made contract fixture and always shows a **SAMPLE DATA** banner; it never goes on stage.
- Keys in the reconstruction view: Space play/pause · ←/→ previous/next marker · J/K/L 0.25x/pause/4x · W wireframe · F hide the FPS box. Drag = free camera, [Resume walkthrough] returns to the director camera; double-click focuses a spot.
- `npm test` runs the unit tests; `npm run make-sample` rebuilds the sample from `data/osm/` (needs the `data` link).

## Data (`data/`, not in git)
`data/` is a link to the prep folder produced by `prep_data.py` (videos, OSM extracts, answer keys).
Code reads the path from `WITNESS_DATA`.
- Windows: `mklink /J data <path-to>\witness-data`
- Mac/Linux: `ln -s ~/witness-data data`

## Sources and licenses
- Map geometry: © OpenStreetMap contributors (ODbL). The 3D scene is generated from OSM footprints with estimated heights. **It is not a scan.**
- Strike-aftermath videos: Ukraine State Emergency Service (dsns.gov.ua) / Interior Ministry via Wikimedia Commons, CC BY 4.0.
- Answer keys: Bellingcat Civilian Harm in Ukraine, GeoConfirmed, CIR Eyes on Russia, Texty.
- Social/YouTube clips play through official embeds only (no redistribution).

## Safety rules
- Only already-published footage, days old or older. Civilian sites only. Never locates defensive positions or troop movements.
- No perpetrator attribution, no legal verdicts: flags are for legal review, never findings.
- Graphic level ≥ 2 is blurred by default; civilian faces blurred on stage.
- Results go to investigators; no public map.
