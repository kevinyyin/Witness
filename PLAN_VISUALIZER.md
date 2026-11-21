# Witness visualizer: implementation plan (web/)

> **For agentic workers:** execute inline (superpowers:executing-plans), one step at a time, in order. Steps use `- [ ]`; tick with one line of result.
> **New session?** "Read WITNESS_SPEC.md (Revision 2) and PLAN_VISUALIZER.md, then continue from the first unticked step." `WITNESS_SPEC.md` in the repo folder (local, not in git) is **Revision 2** (header + §17), saved 11:27:58; it replaced the 10:12 file at 11:28. V0–V3 were built against the earlier file and aligned to Rev 2 at ~11:35 (commit "Align with spec Rev 2").

**Goal:** §7.1 Reconstruction view (P0), §7.2 Break-it panel UI, §7.3 Overview dot map, §7.4 Proof slide, rendering only pipeline JSON (§9).
**Architecture:** plain three.js in one imperative `WitnessScene` class + React for HTML panels; one zustand store holds scene time `t`; one rAF loop advances `t` and renders; everything else is a pure function of `(incident, t)`.
**Tech stack:** Vite + React + TypeScript, three (+ examples/jsm EffectComposer/UnrealBloomPass/OrbitControls), zustand, vitest. No r3f, no map tiles, no Streamlit.
**Spec:** `WITNESS_SPEC.md` (§4.2, §7, §9, §13). Run `date` before every step.

---

## Architecture (decided once; steps must not fight it)
- **`t` is the spine (D14, §7.1.5–6).** `src/time/store.ts`: `useTime = create<{t; playing; speed: 0.25|1|4; mode: 'walk'|'free'; pinned: string|null; seekNonce: number}>`. Only three writers: the loop (`t` while playing), the timeline (scrub/jump; bumps `seekNonce`), the keyboard. Nothing else stores time-dependent state.
- **One loop** `src/time/loop.ts` `startLoop(scene, overlays: ((t)=>void)[])`: rAF → if playing, `t += dt * speed * (mode==='walk' ? slowmo(t) : 1)`; if `t` enters a compressed gap, set `t = gap.t1` (hard cut); clamp at ruler end → pause; then `scene.update(t, mode)`, then each overlay fn (callout DOM positions, fps). React panels subscribe to `t` through selectors that round (`Math.round(t*10)`) to cap re-renders.
- **Pure derivations** `src/time/derive.ts` (unit-tested):
  `clockAt(inc,t)` = `time.impact_local` + t, printed with `±time.plus_minus_s` · `heatAt(t)` 0 before 0 → 1 at +1.5 s, stays 1 · `waveRadiusM(t)` = 343·t (t>0) · `blinkAt(inc,id,t)` = within 0.6 s after that source's `boom_heard` event `t` · `calloutState(item,t)` → `hidden|full|pin` + opacity (full from `t` to `t_end ?? t+4`, 0.3 s fades; `t:null` → never in scene) · `slowmo(t)` = 0.25 for |t|<1.5, eased to 1 by |t|=3 · `pickClip(inc,t,pinned)` → `{source, clipTs: t − offset_s, kind}` (pinned > impact source for |t|<2 > aligned source covering t, earliest offset).
- **Ruler** `src/time/ruler.ts` `buildRuler(inc) → {start,end,gaps,tToX(t),xToT(x)}`: marks = timeline + flags + notes with non-null `t`; any gap > 60 s between marks → fixed-width "⋯ N min ⋯" segment; start = min(−20, first−2), end = max(+30, last+10).
- **Walkthrough** `src/scene/walkthrough.ts` `shotAt(inc,t,ctx) → {pos, look, title?}`: pose = pure function of `t` per the §7.1.4 table, 1 s smoothstep blends between shots. No keyframes, nothing stored. Free mode = OrbitControls; any drag/wheel sets `mode='free'`.
- **Scene** `src/scene/Scene.ts` `class WitnessScene { load(inc, osm); update(t, mode); projectAnchor(a: Anchor) → {x,y,visible}|null; setWire(on); dispose() }`. Local frame: origin = `impact` lat/lon, meters, x east, y up, z south (`src/scene/geo.ts toLocal`).
- **Video** `src/ui/SourceVideo.tsx` + `src/ui/players.ts` (§9.2 "How the sidebar plays a clip"): `player: "youtube"` → IFrame API on `embed_url` (seek, rate ≤ 2; drift correction covers 4x); `player: "file"` → `<video>` on `media_url` (opaque: https or `/api/media/…`); `player: "embed"` → official embed iframe, not seekable, moment printed. A youtube/file source whose URL is still "…" falls back to the printed moment. Re-seek only when `seekNonce` changes or drift > 0.5 s.
- **Data loading (Rev 2 §9.3):** Vite proxy `/api` → `http://127.0.0.1:8000`, **no rewrite** (FastAPI routes all start with `/api`). Incidents are static: `incidents/index.json` → if missing `sample_index.json`; `incidents/<id>.json` (id `sample` → `sample_incident.json`). Break-it: `GET /api/health` → `{ok, youtube_url_input}` (false hides the URL box; failure → replay `fixtures/analyze_fake.txt` / `analyze_real.txt` under SAMPLE DATA); `POST /api/analyze` read with `fetch` + stream reader; `GET`/`POST /api/judge` scoreboard. Proof: `eval/results.json`, "DEV NUMBERS, NOT FINAL" banner unless `split === 'test'`.
- **OSM:** the incident's own `osm_file` (path under `web/public/`), Overpass `out geom` shape, `center` stored as `[lat, lon]`. Warn on screen if the impact is outside the file's radius.
- **Routes (hash, no router lib):** `#/` overview · `#/incident/<id>` · `#/break` · `#/proof`.

## Global constraints (every step)
- §7.1.9 Never: "war crime", "illegal", "guilty", perpetrator names (callouts too) · missile/trajectory in any mode (D6) · a point or callout without its uncertainty/confidence · casualty counts · graphic level ≥ 2 autoplaying unblurred · presenting the point cloud as a scan.
- `is_sample === true` (incident, index, fixture replay, non-test eval) → big **SAMPLE DATA** banner.
- No hand-written labels on stage: every on-stage string is a JSON field (`label`, `title`, `summary`…) or a fixed UI chrome word. `basis` strings are displayed verbatim, never parsed.
- `camera: null` → no icon/cone, listed "position unknown". An anchor at a null camera or a building not in `osm_file` is pinned screen-level like `clock` (§9.2). Never invent positions.
- `t` from the JSON is authoritative (§9.0); `offset_s` is used only to place lanes and seek video (`clip_ts = t − offset_s`). A click on a flag/note seeks the clip in its `source` + `clip_ts`.
- Verdict enum `real | fake | unsure` → ✓ real / ⚠ unsure / ✗ rejected (= `fake`), with `reject_reason`.
- Never write into `web/public/incidents/`, `web/public/eval/`, `web/public/fixtures/` (teammate's). No Streamlit. No Gemini calls from web/.
- Honesty label always visible: "Geometry: OpenStreetMap footprints, heights estimated. Not a scan." Credit "© OpenStreetMap contributors (ODbL)".
- Building height = `building:levels × 3 m`, default 5 floors (§7.1.3).

## Spec gaps → resolution (Rev 2; §17 points are settled and not re-opened)
Rev 2 settled what used to be gaps 2–4 and 7–12 (`osm_file`, `player`/`media_url`, `duration_s`, `/api/health`, the stream format, `index.json`, `results.json`, the verdict enum, `camera.confidence`, flag `source`+`clip_ts`). Still open:
1. The §9.2 example's coordinates are kilometres from every OSM extract → `make_sample.mjs` shifts the whole example by one offset onto `Kharkiv_buildings_2024-06-22.json` (distances, times, offsets unchanged; checked: camera→impact vs `boom_distance_m` 1062/1063, 651/652, 309/309 m); target = real way/103292605 (apartments, 10 floors); keys checked equal to the example in code.
2. §9.2 wants one real screened `youtube` source in the sample: **no YouTube link exists in our data yet** → B and C keep "…" (sidebar prints the moment) until the user picks one. `file` source D = Commons Art Museum 2026-06-14 (CC BY 4.0, real `https` URL) — **not yet screened by eye**.
3. OSM extracts hold buildings only → ground grid, no road lines.
4. Default height: §7.1.3 (5 floors).
5. Rev 2 drops three sections that were added to the old file this morning (§8.1 core geometry, §10.1 prep results, §13.1 Berkeley Protocol). Going with Rev 2: no "Berkeley Protocol" wording on screen; the footer still links `incidents/evidence_report_<id>.html` if the pipeline exports one (matches "Evidence record").
6. Heroes per `data/` (11:06): 2024-06-22 Kharkiv (14 clips), 2024-09-01 Kharkiv (10), 2025-02-28 Zaporizhzhia (3), 2025-06-24 Dnipro (11 links + OSM extract). `index.json` has one `city` → overview shows that city. `benchmark.csv`: XU_kraine_57707 and itsdonetsk_170630 are the same video.
7. Overview map: no tile server (flaky wifi) → dark SVG with dots, scale bar, OSM credit.
8. `data/manifest.csv` `screen` column is empty: nothing screened yet (D12).

Repo: https://github.com/kevinyyin/Witness (pushed 11:06). `data/` files stay out of git (§4.3).

## Integration checklist (from teammate; time I need it)
- [ ] **11:50** fps on his Mac (demo laptop): `git pull; cd web; npm i; npm run dev` → open `http://localhost:5173/#/incident/sample` for 2 minutes, read the FPS box (§4.2).
- [ ] **1:30** `web/public/fixtures/analyze_fake.txt` + `analyze_real.txt` (raw `/api/analyze` bodies, §9.3).
- [ ] **1:40** `web/public/incidents/<id>.json` (§9.2, same keys as the sample, `is_sample:false`) + `incidents/index.json` (§9.3) + its `osm_file` copied into `web/public/osm/`. Fields I read: `id city title osm_file time.{impact_local,plus_minus_s} impact.{lat,lon,radius_m} target.{osm_id,footprint,levels} weapon.{options,evidence} flags[]/review_notes[].{type,label,status,confidence,t,t_end,anchor,source,clip_ts,basis} timeline[].{t,type,source,clip_ts,confidence,anchor?} sources[].{id,platform,url,embed_url,player,media_url,uploader,posted_at,duration_s,camera.{lat,lon,heading_deg,fov_deg,radius_m,confidence},boom_distance_m,offset_s,aligned,authenticity,reject_reason,graphic_level,license,findings[].{clip_ts,label}} summary answer_key.{lat,lon} is_sample`. The impact clip must be `youtube` or `file` (§9.2) so check #4 can seek.
- [ ] **2:00** backend on `127.0.0.1:8000` (routes under `/api`): `GET /api/health`, `POST /api/analyze` (stream: `event: stage` × n, then one `event: result` or `event: error`), `GET`/`POST /api/judge`. §9.1 fields I read: `clip_id platform embed_url duration_s triage.graphic_level triage.military_object fake.{verdict,label,confidence,checks[].{name,result,detail,clip_ts}} location.{lat,lon,radius_m,level,evidence}|null weapon.{options,evidence}|null incident_id stages_ms`.
- [ ] **3:00** Carbon notes + `summary` in every hero incident; `web/public/eval/results.json` (`split:"dev"`).
- [ ] **3:50** `web/public/eval/results.json` with `split:"test"`.

## Review focus (most likely to bite; each has a test or check in its step)
1. Source with `camera:null` → no cone, "position unknown", its video still plays (V1b check, V3 check).
2. Checked-none flag (`t:null`, `anchor:null`) → sidebar only, never on the ruler or in the scene (V2 test `calloutState`/`buildRuler`).
3. Second event 18 min later → compressed gap, playback hard-cuts with the gap card (V2 test `buildRuler`).
4. Missing `incidents/index.json` / backend down / impact outside the OSM extract → fallback + banner/warning, never a blank screen (V0, V4 checks).
5. Weapon top option < 0.5 → big "Unclear" (V3 check).

---

## Schedule (ET; started late: Phase 0 ended 10:48, Phase A ~10:55)
| Step | Box | Gate |
|---|---|---|
| V0 scaffold | 10:55–11:10 | 11:00 go/fog (no scene code before "go") |
| V1a point cloud + fps | 11:10–11:40 | push by 11:40 for the 11:50 Mac fps |
| V1b scene objects | 11:40–12:30 | **12:00 point cloud ≥ 30 fps or wireframe** |
| V2 timeline + `t` | 12:30–1:30 | |
| V3 sidebar + real data | 1:30–2:00 | 1:40 first real incident; **2:00 checkpoint** |
| V4 break-it | 2:00–3:00 | |
| V5 walkthrough, proof, overview | 3:00–3:30 | |
| V6 polish + rehearsal | 3:30–4:30 | 3:50 test results |
| V7 submit | 4:30–5:00 | |

Cut order if behind (§4.2): overview dot map → smoke column → evidence-rings toggle → Walkthrough camera (fallback: auto-orbit + slow-mo at impact). **Never cut:** 3D scene (wireframe OK), scrubbable timeline with time-anchored flags, source sidebar, break-it panel, real data.

---

## Steps

### V0 · Scaffold (10:55–11:10)
- [x] **Goal:** runnable `web/` that loads an incident JSON + OSM file and shows the banner; no scene code.
  - **Result 11:00:** build + 4 tests pass; `#/incident/sample` shows SAMPLE DATA + "Kharkiv_buildings_2024-06-22.json · 941 buildings · impact inside radius"; index falls back to sample; `/media` serves video with range (206); `/api` → 502 while backend is down. Sample target = way/103292605 (apartments, 10 floors). OSM `center` is `[lat, lon]` in the files. A 5th extract (`Dnipro_buildings_2025-06-24.json`) appeared in data/osm at ~10:55 and is included.
- **Files:** `web/` (Vite react-ts), `vite.config.ts` (proxy + `/media` middleware), `src/types.ts`, `src/data/load.ts` (`loadIndex()`, `loadIncident(id)`, `loadOsmFor(impact)`), `src/App.tsx` (hash routes, stub pages), `src/ui/SampleBanner.tsx`, `public/sample_incident.json`, `public/sample_index.json`, `public/osm/Kharkiv_buildings_2024-06-22.json` (+ the other 3 extracts) + `public/osm/index.json`, `scripts/make_sample.mjs` (picks the target way, writes sample geometry), `src/time/derive.test.ts` stub, `vitest`.
- **Reads:** `is_sample`, `id`, `city`, `title`, `impact.{lat,lon}`; OSM `elements[].{id,tags,geometry}`.
- **Accept:** `npm run build` passes; `npx vitest run` passes; `npm run dev` → `#/incident/sample` shows "SAMPLE DATA", title, and "OSM: Kharkiv_buildings_2024-06-22.json · 941 buildings · impact inside radius". Rename `public/incidents/index.json` away (it doesn't exist yet) → index falls back to `sample_index.json`.
- **Fallback:** none needed. If go/fog not heard by end of V0, ask once; on "fog", stop and re-plan.

### V1a · Point-cloud city + free orbit + fps (11:10–11:40) — needs "go"
- [x] **Goal:** §7.1.2 look: black void, LiDAR-style points on walls + roofs (~1 pt per 1.5 m², cap 500k), sparse ground grid, cool white/cyan brighter with height, depth fog; OrbitControls; FPS box.
- **Files:** `src/scene/geo.ts` (`toLocal`), `src/scene/pointcloud.ts` (`buildCityPoints(osm, origin, targetId) → {geometry, count}`; `buildCityWire(...)` for fallback), `src/scene/shaders.ts`, `src/scene/Scene.ts`, `src/ui/Fps.tsx` (big mono "FPS 58 · 412k pts", updated every 0.5 s), `src/ui/Reconstruction.tsx`, honesty label.
- **Reads:** `impact.{lat,lon}`, `target.osm_id`; OSM `tags["building:levels"]`, `geometry`.
- **Accept:** user eyeball: a recognisable block of point buildings around the impact, no sky, distant points fade; FPS box ≥ 30 on Windows (early warning only). Commit + push; **tell the user "scene pushed, ready for the Mac fps check"**.
- **Fallback:** `?wire=1` / key `W` → wireframe extrusions from the same data (§7.1.2).
  - **Result 11:14:** 495k pts (adaptive spacing, budget 450k + ground grid), orbit/zoom work, honesty label + OSM credit on screen, 9 tests pass. Built in `IncidentPage.tsx` (not a separate Reconstruction.tsx). Windows FPS not measured: the agent's browser pane was hidden/throttled (1.5 rAF/s on an empty page), so its 30 fps reading is meaningless. Needs a visible browser.

### V1b · Target, impact, sphere, cameras, cones, answer key (11:40–12:30)
- [x] **Goal:** §7.1.3 objects at a fixed `t` (store exists, no timeline yet): target points tagged for heat, impact marker + flash sprite, uncertainty sphere radius `impact.radius_m`, camera icons + letters + view cones (opacity = location confidence), "position unknown" list for null cameras, green answer-key marker (toggle), bloom only on flash/markers (threshold above city brightness).
- **Files:** `src/scene/markers.ts`, `src/scene/Scene.ts` (`update(t)` uses `heatAt`, flash pulse at 0), `src/time/store.ts`, `src/time/derive.ts` (`heatAt`), temp `t` slider.
- **Reads:** `target.{osm_id,footprint,levels}`, `impact.{lat,lon,radius_m,confidence}`, `sources[].{id,camera.{lat,lon,heading_deg,fov_deg,radius_m},platform,boom_distance_m}`, `answer_key.{lat,lon}`.
- **Accept (§7.1.8 #8, #9):** slider to 0 → white flash, target turns red and stays red for t>0, back below 0 → calm. Toggle investigators' location → green marker inside/near the sphere. Source with `camera:null` has no cone and is listed "position unknown". No missile/trajectory anywhere. **12:00: ask the user for the Mac fps number → point cloud or wireframe**, record it here.
- **Fallback:** wireframe (decided at 12:00).
  - **Result 11:14:** flash at +0.1 s, target red at +5 s and calm again below 0, amber 40 m sphere, camera cones + ±radius rings + letters, "Position unknown: D", green investigators' marker inside the sphere (#8). Windows early warning: 6.5 ms/frame with bloom, 5.3 without (≈150 fps ceiling, Intel Arc 140V, 896×960 canvas, timed with readPixels sync because the agent's pane is throttled). **12:00 Mac decision: pending** (point cloud unless the Mac reads < 30).
  - Gap 17: §9.2 has no camera location confidence → cone opacity from `camera.radius_m` (marked `shortcut:` in markers.ts).

### V2 · Timeline drives everything via `t` (12:30–1:30)
- [x] **Goal:** §7.1.6 timeline (ruler with gap breaks, flags row ▲/●/○, events row, one lane per clip by `offset_s`, unaligned hatched "approx."), play/pause, 0.25/1/4x, scrub, click-to-jump (t−2 s, play, callout, `seekNonce++`), keyboard (Space, ←/→, J/K/L), hover tooltips (basis verbatim + confidence); loop; sound wave 343 m/s + camera blink + "boom heard +3.1 s → 1.06 km"; time-anchored callouts (HTML cards + leader lines, projected per frame); pins after `t_end`; clock top-right with ±; lower third; Now panel; walkthrough-lite (auto-orbit + slow-mo at impact) as the 'walk' mode until V5.
- **Files:** `src/time/loop.ts`, `src/time/ruler.ts`, `src/time/derive.ts` (+ tests), `src/ui/Timeline.tsx`, `src/ui/Callouts.tsx`, `src/ui/Clock.tsx`, `src/ui/LowerThird.tsx`, `src/ui/NowPanel.tsx`, `src/ui/keys.ts`, `src/scene/anchors.ts` (`resolveAnchor(inc, osmIndex, anchor) → Vec3[] | 'clock' | null`).
- **Reads:** `timeline[].{t,type,source,clip_ts,confidence,anchor}`, `flags[]` / `review_notes[]` `.{type,label,status,confidence,t,t_end,anchor,basis}`, `sources[].{id,offset_s,aligned,boom_distance_m,findings}`, `time.{impact_local,plus_minus_s}`.
- **Tests (vitest, `src/time/derive.test.ts`):** `calloutState({t:0,t_end:null},2).state==='full'`, `…,4.5)==='pin'`, `…,-1)==='hidden'`, `{t:null}` → `'hidden'` always; `waveRadiusM(3.1)≈1063.3`; `heatAt(-0.1)===0`, `heatAt(5)===1`; `buildRuler` on sample: exactly one gap, ending at the second impact (t = 1080), `xToT(tToX(41))≈41`, checked-none flag not among marks; `clockAt(sample, 0)` → "02:41:07 (±6 min)".
- **Accept (§7.1.8 #3, #4, #6):** scrub +30 → −10 s: wave, heat, callouts, clock, Now panel rewind together. Click the ● time-conflict marker → playhead at 39 s, callout on cameras C and E. Every callout shows basis + confidence. Before starting: ask the user about adding `sources[].duration_s` (gap 4).
- **Fallback:** if behind at 1:15, drop hover tooltips and J/K/L (keep Space and ←/→).
  - **Result 11:20:** 22 tests pass. Scrub check (#3) scripted: +2 s → residential + night-strike flags + "boom heard +1.5 s → 0.52 km"/"+2.0 s → 0.69 km", wave 686 m, clock 02:41:09, lower third "BOOM HEARD · clip C at 0:14 · conf 0.90"; +30 s → pins only, wave gone; −10 s → heat 0, no callouts, clock 02:40:57. Marker click → t−2 and plays (#4, video part is V3). Every callout shows basis + confidence (#6). Fixed: callouts now fade in over the 0.3 s *before* t (were invisible when landing exactly on t); cards follow an on-screen anchor. Hover tooltips = native `title`. Pins re-open via tooltip, not a full callout. `duration_s` question (gap 4) still to ask; lanes use the last-moment + 5 s fallback (dashed end).

### V3 · Sidebar + first real incident (1:30–2:00)
- [x] **Goal:** §7.1.7 sidebar: source video (3 player kinds, synced to `t`, auto-pick in walk mode, pin on camera click, blur when `graphic_level ≥ 2` with "Show anyway"), clickable findings (seek player + scene), Now, What probably happened (`summary`), weapon bars (8 options, "why" line from `weapon.evidence`, big "Unclear" if top < 0.5, footer text), All flags (time order, checked-none at bottom), Sources (✓/⚠/✗, uploader, post time, location confidence, license; rejected collapsed), footer ("Evidence record" → `incidents/evidence_report_<id>.html` if it exists, §13.1; wording "built around the Berkeley Protocol", never "compliant"/"certified"). Then pull the first real incident (1:40) and run the integration checklist.
- **Files:** `src/players/{youtube,file,embed,index}.ts`, `src/ui/SourceVideo.tsx`, `src/ui/Sidebar.tsx`, `src/ui/WeaponBars.tsx`, `src/ui/FlagsList.tsx`, `src/ui/Sources.tsx`.
- **Reads:** `sources[].{id,platform,url,embed_url,uploader,posted_at,camera.radius_m,offset_s,authenticity,graphic_level,license,findings[].{clip_ts,label}}`, `weapon.{options,evidence}`, `summary`, `flags[]`, `review_notes[]`, `verification.{n_sources,n_rejected,corroboration}`, `answer_key.{source,url}`.
- **Accept (§7.1.8 #1, #4, #7):** real incident opens in < 2 s; click a flag → sidebar video at the flag's clip moment (or, for an embed, the moment printed); weapon bars and flags come from pipeline output. **2:00 checkpoint, say exactly:** "Visualizer renders real incident JSON for ≥1 hero incident." If not: cut polish and fix this first.
- **Fallback:** if YouTube API misbehaves, use embed kind with printed moments for all.
  - **Result 11:26 (sample only):** 29 tests pass. Opens in 149 ms on the establishing shot (#1). Sidebar follows t: −14 s → A ("0:02", embed), 0 s → C ("0:12"), +1082 s → D blurred with "Show anyway". Click boom@B marker → t −0.5, pinned B, `<video>` at 11.5 s = t − offset_s (#4). Camera click → pins its clip (raycast). 8 weapon bars + footer text; summary guarded against verdict words; "anchor not in scene" shown when an anchor can't be resolved. Marker click pins the marker's source (event `source` or camera anchor), else back to auto. YouTube kind untested (no YouTube link in any data yet).

### V3b · Real data in (1:40–2:00) — if it is before 1:40, do V4 first and come back
- [ ] **Goal:** teammate says "pull now" → `git pull`; check `web/public/incidents/index.json` + `<id>.json` against the integration checklist (same keys as the sample, `is_sample:false`, `osm_file` present in `web/public/osm/`, anchors resolve, impact clip is `youtube`/`file`); open each incident; fix my side only. **2:00 checkpoint (Rev 2 §4.2), say exactly:** "Pass = on the visualizer's laptop, after `git pull`, the web opens `web/public/incidents/<id>.json` for ≥ 1 hero incident with `is_sample: false`: no SAMPLE DATA banner, the timeline scrubs, and one source video plays and seeks." If not, both stop other work and fix this first.
- **Accept (§7.1.8 #1, #4, #7 on real data).**

### V4 · Break-it panel (2:00–3:00)
- [ ] **Goal:** §7.2: URL input or MP4 drop + "claimed place"; live stages Fetching → Watching & listening → Physics checks → Scoring → Locating → Verdict, each ticking with its detail; verdict card (rejected: label + confidence + checks pass/fail with `detail` + `clip_ts`; real: location ± radius / "city only", weapon bars, graphic level, incident or "new incident", "Open in reconstruction"); "What was it really?" (Real strike · Game · Movie · Fireworks/demolition · Other) → `POST /api/judge` + live scoreboard "Judge tries: N · Witness right: M" (kept in localStorage; wrong answers stay); offline → fixture replay under SAMPLE DATA.
- **Files:** `src/breakit/sse.ts` (`readSSE(res, onEvent)`: `event:`/`data:` pairs → `{event:'stage'|'result'|'error', data}`; unit-tested on a captured body), `src/breakit/api.ts` (`health()`, `analyze({url,claimed_place}|{file,claimed_place}, onEvent)`, `judge(clip_id, truth)`, `scoreboard()`, `replayFixture('analyze_fake'|'analyze_real', onEvent)`), `src/ui/BreakIt.tsx`, `src/ui/Verdict.tsx`.
- **Reads (Rev 2):** `/api/health` `{ok, youtube_url_input}` (false → hide URL box); stage events `{stage: fetch|watch|physics|score|locate|verdict, status: start|done|skipped|error, ms, summary}`; result §9.1 `fake.{verdict,label,confidence,checks[4].{name,result,detail,clip_ts}}`, `location|null` (null + `triage.military_object ≥ 0.5` → "Location withheld: military object visible"), `weapon|null` (same bar component as §9.2), `triage.graphic_level`, `incident_id|null` ("Open in reconstruction" only when not null), `stages_ms`; scoreboard `{tries, right, history[]}` from `GET/POST /api/judge` with `truth: real_strike|video_game|movie|fireworks_demolition|other` (server keeps it; no localStorage). `flash_to_boom.detail` starting "model-timed" = URL-only analysis; show as is.
- **Accept:** with the backend up: paste a T4 link → stages tick, verdict ≤ 60 s with reasons. Backend down → banner + fixture replay. Rejected clips never touch the map.
- **Fallback:** if URL input fails at the gate, MP4 drop only (§7.2).

### V5 · Walkthrough director, proof slide, overview (3:00–3:30)
- [ ] **Goal:** `shotAt` per §7.1.4 (establishing −20→−10 with title card; witnesses −10→−2 sweeping known cameras with "A · Telegram · 1.06 km away"; impact −2→+1 at ~250 m; sound wave +1 → last boom pulled back to frame all cameras; flags orbit; gap card); [Resume walkthrough]; double-click building to focus. Proof slide from `eval/results.json` (`rows[]` table with `witness`/`baseline`/`unit`/`baseline_name`/`n`, `ablation` full_video vs frames_5 vs transcript, `worst_misses[]` with `thumb|null`, `expected`, `got`, `why`; "DEV NUMBERS, NOT FINAL" banner unless `split === 'test'`). Overview SVG dot map from `index.json` (`lat`, `lon`, size = `n_sources`, color = `corroboration`, "rejected: `n_rejected`" tray, "`n_clips` clips → M incidents"). Evidence rings toggle (`boom_distance_m`, none when null).
- **Files:** `src/scene/walkthrough.ts` (+ test: `shotAt` at −15/−5/0/+5 returns finite poses, same `t` → same pose), `src/ui/Proof.tsx`, `src/ui/Overview.tsx`.
- **Reads:** `timeline`, `sources[].camera`, `impact`, `title`; `eval/results.json` `split`, `rows`, `worst_misses`; index fields (gap 9).
- **Accept (§7.1.8 #2, #5):** Play from −20: beats in order, wave reaches each camera at its measured delay, callouts pinned, gap card then later events; drag → Free, timeline still drives; Resume returns to the director at the current `t`.
- **Fallback (cut order):** overview first, then walkthrough → auto-orbit + slow-mo.

### V6 · Polish + rehearsal (3:30–4:30)
- [ ] **Goal:** all 2–3 hero incidents load (§7.1.8 #7 by 3:30); rehearse on the teammate's Mac with the untouched rehearsal links; check every §7.1.9 item on screen; 1-min video capture support (clean full-screen, hide FPS with `F`).
- **Accept:** full §7.1.8 pass list on the Mac, recorded here.

### V7 · Submit (4:30–5:00)
- [ ] **Goal:** README "How to run" for web (`npm i`, `npm run dev`, data link, `WITNESS_DATA`), credits (OSM ODbL, dsns.gov.ua CC BY 4.0, Bellingcat, GeoConfirmed, CIR), final push.
