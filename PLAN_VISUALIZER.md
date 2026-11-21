# Witness visualizer: implementation plan (web/)

> **For agentic workers:** execute inline (superpowers:executing-plans), one step at a time, in order. Steps use `- [ ]`; tick with one line of result.
> **New session?** "Read WITNESS_SPEC.md and PLAN_VISUALIZER.md, then continue from the first unticked step." `WITNESS_SPEC.md` (local, not in git) is the truth. It is the 10:12 AM file; the user confirmed it at 10:49 even though it is not "Revision 2". Prompt-only items (fixtures, /health, sample_index, eval `split`, player kinds) are followed where they add to the spec without contradicting it.

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
- **Video** `src/players/*`: `interface Player { kind:'youtube'|'file'|'embed'; canSeek; sync(clipTs, playing, rate, force) }`. Kind = `source.player` if present, else from `embed_url`: `youtube.com/embed`/`youtu.be` → youtube (IFrame API, `seekTo`, rate ≤ 2, at 4x pause + reseek every 1 s); `.mp4|.webm|.mov` or `/media/` → file (`<video>`, `currentTime`, `playbackRate`); else embed (iframe, no seek: "▸ this moment is at 0:12" printed under it). Re-seek only when `seekNonce` changes or drift > 0.5 s.
- **Data loading (fixed, §9.3 + prompt):** Vite proxy `/api` → `http://127.0.0.1:8000`, prefix stripped (spec paths `/analyze`, `/judge`, `/health`). Incidents: `incidents/index.json`, fallback `sample_index.json`; `incidents/<id>.json` (id `sample` → `sample_incident.json`). Break-it: `fetch` + `body.getReader()` SSE parse (not EventSource); if `GET /api/health` fails or the POST fails at network level → replay `fixtures/*.txt` (listed in `fixtures/index.json`) under the SAMPLE DATA banner. Proof: `eval/results.json`, banner unless `split === 'test'`.
- **OSM:** `web/public/osm/<file>.json` (Overpass `out geom` shape) + `web/public/osm/index.json` `[{file, city, center:{lat,lon}, radius_m}]` (mine). Loader picks the nearest center to `impact`; warns on screen if impact is outside its radius.
- **Routes (hash, no router lib):** `#/` overview · `#/incident/<id>` · `#/break` · `#/proof`.
- **Media for `file` kind:** dev-server middleware in `vite.config.ts` serves `$WITNESS_DATA` (default `../data`) under `/media/` (videos never in git).

## Global constraints (every step)
- §7.1.9 Never: "war crime", "illegal", "guilty", perpetrator names (callouts too) · missile/trajectory in any mode (D6) · a point or callout without its uncertainty/confidence · casualty counts · graphic level ≥ 2 autoplaying unblurred · presenting the point cloud as a scan.
- `is_sample === true` (incident, index, fixture replay, non-test eval) → big **SAMPLE DATA** banner.
- No hand-written labels on stage: every on-stage string is a JSON field (`label`, `title`, `summary`…) or a fixed UI chrome word. `basis` strings are displayed verbatim, never parsed.
- `camera: null` → no icon/cone, listed "position unknown". Building anchor not in target/OSM → not drawn; listed "anchor not found". Never invent positions.
- `t` from the JSON is authoritative; never recompute it from `clip_ts`/`offset_s`. (The only subtraction is the video seek `clipTs = t − offset_s`, §7.1.7.)
- Never write into `web/public/incidents/`, `web/public/eval/`, `web/public/fixtures/` (teammate's). No Streamlit. No Gemini calls from web/.
- Honesty label always visible: "Geometry: OpenStreetMap footprints, heights estimated. Not a scan." Credit "© OpenStreetMap contributors (ODbL)".
- Building height = `building:levels × 3 m`, default 5 floors (§7.1.3).

## Spec gaps → resolution (going ahead)
1. Sample impact 49.99/36.33 is 2.2–6 km from every OSM extract → sample geometry re-centered on `Kharkiv_buildings_2024-06-22.json` (center 49.97989, 36.24711); target = a real apartments way from that file. Text fields kept from §9.2.
2. §9.2 has no OSM-file field → `osm/index.json`, nearest center (above).
3. No `player` field → kind inferred from `embed_url`; `player` honored if it appears.
4. Sources have no `duration_s` → lane ends at that source's last known moment + 5 s with a dashed tail. Propose adding `sources[].duration_s` (§9 change → ask the user at V2).
5. OSM extracts hold buildings only → ground grid, no road lines.
6. Default height: §7.1.3 (5 floors) over §8.1 (9 m) for the scene.
7. No `/health` in spec → ask teammate for `GET /health` → 200; also treat a network failure of `/analyze` as offline.
8. SSE event shape unspecified → `data: {"stage":"fetch|watch|physics|score|locate","status":"start|done","detail":"…"}` (stage names = §9.1 `stages_ms` keys); the event whose JSON has `clip_id` is the final §9.1 record.
9. `incidents/index.json` shape unspecified → `{"incidents":[{id, city, title, time:{impact_local}, impact:{lat,lon,radius_m}, verification:{n_sources,n_rejected,corroboration}, is_sample}], "run":{"n_clips","n_rejected"}}` (§9.2 names only); a bare array is accepted too.
10. `eval/results.json` shape unspecified → render `rows[]` as a table (any keys) + `worst_misses[]` as cards; unknown shape → key/value table.
11. `authenticity` values: `real` → ✓, `rejected` → ✗ (collapsed, with reason), anything else → ⚠ with the raw value.
12. Telegram embeds cannot seek → embed kind prints the moment; seekable hero clips need `embed_url: "/media/telegram/<file>.mp4"` (value convention, not a new field), only after organizer answer to §13 Q3.
13. Hero in Zaporizhzhia ≠ Kharkiv → overview shows one city at a time (city with most incidents; others as tabs).
14. Overview map: no tile server (flaky wifi) → dark SVG with dots, scale bar, OSM credit.
15. Heroes per `data/` (11:06): 2024-06-22 Kharkiv (14 clips; `evidence_report_2024-06-22.html` built), 2024-09-01 Kharkiv (10), 2025-02-28 Zaporizhzhia (3), 2025-06-24 Dnipro (11 links + OSM extract). Zaporizhzhia/Dnipro are other cities (gap 13). `benchmark.csv`: XU_kraine_57707 and itsdonetsk_170630 are the same video (identical stats).
16. `data/manifest.csv` `screen` column is empty: nothing screened yet (D12). The sample's clip B (Commons 2025-04-03) is unscreened; dev use only, never on stage.

Repo: https://github.com/kevinyyin/Witness (pushed 11:06). `data/` files stay out of git (§4.3).

## Integration checklist (from teammate; time I need it)
- [ ] **11:50** fps on his Mac (demo laptop): `git pull; cd web; npm i; npm run dev` → open `http://localhost:5173/#/incident/sample`, read the FPS box. I'll say when it's pushed.
- [ ] **1:30** `web/public/fixtures/*.txt` (raw SSE from `/analyze`, one per test link) + `fixtures/index.json` `[{"file","label"}]`.
- [ ] **1:40** `web/public/incidents/<id>.json` (§9.2, `is_sample:false`) + `incidents/index.json` (gap 9). Fields I read: `id city title time.impact_local time.plus_minus_s impact.{lat,lon,radius_m,confidence,method} target.{osm_id,footprint,levels,osm_tags,visual_basis} weapon.{options,evidence} flags[].{type,label,status,confidence,t,t_end,anchor,basis} review_notes[].{same} timeline[].{t,type,source,clip_ts,confidence,anchor?} sources[].{id,clip_id,platform,url,embed_url,uploader,posted_at,camera,boom_distance_m,offset_s,aligned,authenticity,graphic_level,license,findings[].{clip_ts,label}} summary verification.{agree_place,agree_time,corroboration,n_sources,n_rejected} answer_key.{source,lat,lon,url} is_sample`.
- [ ] **2:00** backend on `127.0.0.1:8000`: `POST /analyze` (JSON `{url, claimed_place?}` or multipart field `file`) streaming SSE (gap 8) · `GET /health` · `POST /judge {clip_id, truth}`. §9.1 fields I read: `clip_id source_url platform embed_url duration_s timeline[] triage.{graphic_level,…} fake.{verdict,label,confidence,checks[].{name,result,detail,clip_ts}} location.{lat,lon,radius_m,level,method,evidence,candidates} weapon.* incident_id stages_ms`.
- [ ] **3:00** Carbon `review_notes` + `summary` in incident JSONs; `eval/results.json` (`split:"dev"`); `web/public/incidents/evidence_report_<id>.html` from `custody.py report <id>` (§13.1; the sidebar footer links it; `/media` deliberately serves only video/images).
- [ ] **3:50** `eval/results.json` with `split:"test"`.

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
  - **Result 11:27:** 22 tests pass. Scrub check (#3) scripted: +2 s → residential + night-strike flags + "boom heard +1.5 s → 0.52 km"/"+2.0 s → 0.69 km", wave 686 m, clock 02:41:09, lower third "BOOM HEARD · clip C at 0:14 · conf 0.90"; +30 s → pins only, wave gone; −10 s → heat 0, no callouts, clock 02:40:57. Marker click → t−2 and plays (#4, video part is V3). Every callout shows basis + confidence (#6). Fixed: callouts now fade in over the 0.3 s *before* t (were invisible when landing exactly on t); cards follow an on-screen anchor. Hover tooltips = native `title`. Pins re-open via tooltip, not a full callout. `duration_s` question (gap 4) still to ask; lanes use the last-moment + 5 s fallback (dashed end).

### V3 · Sidebar + first real incident (1:30–2:00)
- [ ] **Goal:** §7.1.7 sidebar: source video (3 player kinds, synced to `t`, auto-pick in walk mode, pin on camera click, blur when `graphic_level ≥ 2` with "Show anyway"), clickable findings (seek player + scene), Now, What probably happened (`summary`), weapon bars (8 options, "why" line from `weapon.evidence`, big "Unclear" if top < 0.5, footer text), All flags (time order, checked-none at bottom), Sources (✓/⚠/✗, uploader, post time, location confidence, license; rejected collapsed), footer ("Evidence record" → `incidents/evidence_report_<id>.html` if it exists, §13.1; wording "built around the Berkeley Protocol", never "compliant"/"certified"). Then pull the first real incident (1:40) and run the integration checklist.
- **Files:** `src/players/{youtube,file,embed,index}.ts`, `src/ui/SourceVideo.tsx`, `src/ui/Sidebar.tsx`, `src/ui/WeaponBars.tsx`, `src/ui/FlagsList.tsx`, `src/ui/Sources.tsx`.
- **Reads:** `sources[].{id,platform,url,embed_url,uploader,posted_at,camera.radius_m,offset_s,authenticity,graphic_level,license,findings[].{clip_ts,label}}`, `weapon.{options,evidence}`, `summary`, `flags[]`, `review_notes[]`, `verification.{n_sources,n_rejected,corroboration}`, `answer_key.{source,url}`.
- **Accept (§7.1.8 #1, #4, #7):** real incident opens in < 2 s; click a flag → sidebar video at the flag's clip moment (or, for an embed, the moment printed); weapon bars and flags come from pipeline output. **2:00 checkpoint, say exactly:** "Visualizer renders real incident JSON for ≥1 hero incident." If not: cut polish and fix this first.
- **Fallback:** if YouTube API misbehaves, use embed kind with printed moments for all.

### V4 · Break-it panel (2:00–3:00)
- [ ] **Goal:** §7.2: URL input or MP4 drop + "claimed place"; live stages Fetching → Watching & listening → Physics checks → Scoring → Locating → Verdict, each ticking with its detail; verdict card (rejected: label + confidence + checks pass/fail with `detail` + `clip_ts`; real: location ± radius / "city only", weapon bars, graphic level, incident or "new incident", "Open in reconstruction"); "What was it really?" (Real strike · Game · Movie · Fireworks/demolition · Other) → `POST /api/judge` + live scoreboard "Judge tries: N · Witness right: M" (kept in localStorage; wrong answers stay); offline → fixture replay under SAMPLE DATA.
- **Files:** `src/breakit/sse.ts` (`readSSE(res, onEvent)`), `src/breakit/api.ts` (`health()`, `analyze(input, onEvent)`, `judge(clipId, truth)`, `replayFixture(file, onEvent)`), `src/ui/BreakIt.tsx`, `src/ui/Verdict.tsx`, `src/ui/Scoreboard.tsx`.
- **Reads:** §9.1 `fake.{verdict,label,confidence,checks[]}`, `location.{lat,lon,radius_m,level,evidence}`, `weapon.*`, `triage.graphic_level`, `incident_id`, `stages_ms`, `duration_s`.
- **Accept:** with the backend up: paste a T4 link → stages tick, verdict ≤ 60 s with reasons. Backend down → banner + fixture replay. Rejected clips never touch the map.
- **Fallback:** if URL input fails at the gate, MP4 drop only (§7.2).

### V5 · Walkthrough director, proof slide, overview (3:00–3:30)
- [ ] **Goal:** `shotAt` per §7.1.4 (establishing −20→−10 with title card; witnesses −10→−2 sweeping known cameras with "A · Telegram · 1.06 km away"; impact −2→+1 at ~250 m; sound wave +1 → last boom pulled back to frame all cameras; flags orbit; gap card); [Resume walkthrough]; double-click building to focus. Proof slide from `eval/results.json`. Overview SVG dot map (size = `n_sources`, color = `corroboration`, rejected tray, "N clips → M incidents").
- **Files:** `src/scene/walkthrough.ts` (+ test: `shotAt` at −15/−5/0/+5 returns finite poses, same `t` → same pose), `src/ui/Proof.tsx`, `src/ui/Overview.tsx`.
- **Reads:** `timeline`, `sources[].camera`, `impact`, `title`; `eval/results.json` `split`, `rows`, `worst_misses`; index fields (gap 9).
- **Accept (§7.1.8 #2, #5):** Play from −20: beats in order, wave reaches each camera at its measured delay, callouts pinned, gap card then later events; drag → Free, timeline still drives; Resume returns to the director at the current `t`.
- **Fallback (cut order):** overview first, then walkthrough → auto-orbit + slow-mo.

### V6 · Polish + rehearsal (3:30–4:30)
- [ ] **Goal:** all 2–3 hero incidents load (§7.1.8 #7 by 3:30); rehearse on the teammate's Mac with the untouched rehearsal links; check every §7.1.9 item on screen; 1-min video capture support (clean full-screen, hide FPS with `F`).
- **Accept:** full §7.1.8 pass list on the Mac, recorded here.

### V7 · Submit (4:30–5:00)
- [ ] **Goal:** README "How to run" for web (`npm i`, `npm run dev`, data link, `WITNESS_DATA`), credits (OSM ODbL, dsns.gov.ua CC BY 4.0, Bellingcat, GeoConfirmed, CIR), final push.
