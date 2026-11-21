# PLAN_PIPELINE.md — Witness pipeline half

**Resume in a new session:** read `WITNESS_SPEC.md` (Revision 2), this file and `docs/VERIFIED.md`, then continue from the first unticked step. Run `date` before every step. After each step: run its check, tick it here with one result line, commit, push (never data, never `.env`).

Written Sat Nov 21, 10:45 AM ET. Spec says "Teammate" for the pipeline owner: that is me.

---

## A. Spec gaps → what I am doing
1. **Late start.** Gate was 10:30–11:00; nothing was on this Mac at 10:42. Go/fog moves to ~11:25. Shrunk: P1 90 → 60 min, P2 60 → 45 min (so P3 gets 45 min before 2:00). Teammate deadlines unchanged.
2. **Fake rule wording.** Prompt: "code over the four named checks". §8: "physics + audio + Decisions answers". Fireworks / demolition / not-war have no check of their own. → The verdict is code over the four checks only; the Decisions "not real" answer and its sub-question feed `render_hud` (the visual check) and its `detail`.
3. **`location.level: unknown`** but keys may not be null. → Country centroid, radius that covers the country, `method: "none"`.
4. **`time.impact_local`**: no clip carries wall-clock time. → Earliest `posted_at` minus that clip's offset; if no `posted_at`, the date in `heroes.csv` at 12:00 with `plus_minus_s: 43200` and `night_strike` = `checked_none`. `basis` says which.
5. **`camera.fov_deg`** cannot be measured. → 60 for every phone clip.
6. **Ids.** `clip_id` = `c_` + 4 digits from a counter file in the cache (stable per sha256/URL). Incident `id` = 4-digit string; hero ids from `heroes.csv` if it has them.
7. **Unspecified numbers** (dense-population threshold, flag confidences for code rules, `fake.confidence`): set in §C, tuned on dev only until 3:30.
8. **CSV columns** of `data_meta/*.csv` are unknown until the repo arrives. → Read the headers in step S2 and record them in the S2 tick line.
9. **Answer keys.** Only `eval/` and the kill test K3-mini read `data/answer_keys/`. The pipeline copies `answer_key` into an incident from `heroes.csv` as the last write step and never reads it for geolocation.
10. **"3 runs per clip"** (§8) is not done on the break-it path (60 s limit); bulk uses one run + cache.
11. **Impact clip must be `youtube` or `file`.** If a hero has a flash only in Telegram/X clips, I stop and ask (swap hero, or organizer answer 3).
12. **§14 "ready-to-paste prompt per step"** is replaced by the resume sentence above (per the prompt).
13. **K1 "does the Decisions API accept YouTube URLs?"** The docs say no (`docs/VERIFIED.md`); Hydrogen does. Read to the letter, §12 would then hide the URL box. → I keep `youtube_url_input: true` if Hydrogen accepts the URL in K1: for URL inputs the Decisions API scores Hydrogen's written observations (text), or the downloaded file if organizers say yes to Q4. **The user confirms this at the gate.**
14. **Hydrogen samples video at 1 FPS**, so its timestamps are about ±1 s (±343 m). → Flash and boom times are refined in code (§C.2).

## B. Needed from others
- **Me (user):** repo URL · `~/witness-data` unzipped · Gemini key in `.env` (variable name per `docs/VERIFIED.md`) · go/fog at the gate · read the fps number at 11:50.
- **Teammate:** repo pushed with `.gitignore`, `data_meta/{screen,heroes,break_it,rehearsal}.csv`, `web/public/sample_incident.json` with real `osm_file` + real clips, Vite proxy `/api` → `127.0.0.1:8000`, `web/` runnable by 11:50.
- **Organizers (§13):** answers 1–4. Q3 decides Telegram/X analysis. Q4 decides the YouTube mode (§C.6).

## C. Design (mine; fixed parts of §9 are implemented as written)
1. **Shape.** One package `pipeline/`, plain functions, no DB, no queue. Hydrogen and Carbon go through `client.interactions.create`; a file is uploaded once (Files API) and the same `uri` goes to Hydrogen and to the Decisions API in parallel (sync client in threads). Cache = one JSON per clip in `data/cache/<sha256 or url-hash>.json`; Gemini calls via `asyncio.gather`. Only the first 180 s of a clip is analyzed.
2. **Four checks** (always all four, this order):
   - `flash_to_boom`: pair each flash with the next blast. Flash time = largest frame-to-frame brightness jump (ffmpeg, full frame rate) within ±1.5 s of Hydrogen's `flash`; blast time = librosa onset within ±1.5 s of Hydrogen's `blast`. Model-timed mode (no file): a second Hydrogen pass over ±5 s around the blast at `fps: 10`. `d = 343 × Δ`. **fail** if Δ < 0.15 s while Hydrogen's apparent blast distance ≥ 300 m, or `d` < ⅓ of the apparent distance. **n/a** with no flash+blast pair.
   - `repeated_sample`: normalized cross-correlation of 0.5 s windows at each blast onset. **fail** if any pair ≥ 0.95. **n/a** with < 2 blasts or no file.
   - `render_hud`: **fail** if Decisions `not_original_or_not_real` ≥ 0.6. `detail` = top sub-question option + HUD time span if Hydrogen saw one.
   - `seen_before`: pHash of 5 frames, Hamming ≤ 8 on ≥ 3 frames against earlier clips from a different source. **fail** = match. **n/a** with no file.
3. **Verdict rule** (code in `pipeline/fake.py`):
   - any check **fail** → `fake`. `label` = `recycled` if `seen_before` failed, else the top option of the Decisions sub-question (`video_game | movie | fireworks | demolition | not_war`).
   - no fail, and not-real score 0.35–0.6 → `unsure`, `label: null`.
   - else `real`, `label: real_strike`.
   - `confidence`: fake = max(not-real score, 0.9 if a physics or pHash check failed) · real = 1 − not-real score · unsure = 0.5.
4. **Alignment** (`t = 0` = first impact):
   - clip with a flash: `offset_s = −flash clip_ts`; `boom_distance_m = 343 × Δ`.
   - clip with only a boom: `offset_s = dist(camera, impact) / 343 − boom clip_ts`, `boom_distance_m: null`.
   - no flash, no boom: `offset_s` = `posted_at` − impact time, `aligned: false`; no `posted_at` → `offset_s: null`.
   - every event: `t = clip_ts + offset_s` (assert ≤ 0.05).
   - **Ring guarantee:** for a source with `camera` and `boom_distance_m`, if `|dist(camera, impact) − boom_distance_m| > camera.radius_m + impact.radius_m` → raise `location_conflict` on that camera.
5. **Geolocation funnel** (`pipeline/geo.py`): `claimed_place` → city → Hydrogen landmark list → name/type match in `data/osm/<City>_landmarks.json` → keep candidate sets whose landmarks lie within 1 km of each other → Decisions "same place?" on the top ≤ 10 → centre = weighted mean of sets ≥ 0.5, `radius_m` = farthest kept candidate + 150 (min 150). `level`: `point` ≤ 300 m, `district` ≤ 5 km, else `city`. `military_object ≥ 0.5` → `location: null`, funnel skipped.
6. **YouTube links, two modes.** `WITNESS_YT_DOWNLOAD=1` in `.env` only after organizers say yes to Q4: temp download (yt-dlp), full checks, file deleted after. Default (no): URL goes to Hydrogen, `flash_to_boom` detail starts with "model-timed", `repeated_sample` and `seen_before` = `n/a`, `sha256: null`. If K1 shows URL input fails: `youtube_url_input: false`, file drops only.
7. **Incident assembly.** Camera = clip location (`camera: null` if radius > 1000 m); `heading_deg` = bearing camera → impact. Impact = least-squares intersection of rings from ≥ 2 sources (`evidence_rings`), else median location of aftermath clips (`landmarks`), else `claimed_place`. Target = nearest footprint in `osm_file`; `levels` from `building:levels`, default 5.
8. **Player.** youtube → `youtube` · commons → `file` with the `upload.wikimedia.org` URL · dropped file → `file` under `/api/media/` · telegram/x → `embed`. The `impact` event is taken only from a `youtube` or `file` clip.
9. **Grouping** (bulk): two non-rejected clips join when centre distance ≤ r1 + r2, both radii ≤ 2 km, and post times within 6 h. Heroes are forced from `heroes.csv`; the eval grouping row scores the rule without the forcing.
10. **Code-rule numbers.** dense population ≥ 100 buildings within 300 m · night = 22:00–06:00 local and `plus_minus_s` ≤ 3600 · weak camera radius > 300 m · corroboration: `high` ≥ 4 sources and `agree_place`, `medium` 2–3, `low` 1.

## D. What I deliver (integration checklist)
| Item | Deadline |
|---|---|
| `GET /api/health` → `ok`, `youtube_url_input` | 1:30 |
| `POST /api/analyze` stream (6 stages, 4 statuses, one `result` or `error`) | 1:30 |
| `web/public/fixtures/analyze_fake.txt`, `analyze_real.txt` | **1:30** |
| `POST` + `GET /api/judge` (file-backed scoreboard) | 1:30 |
| `GET /api/media/<file>` | 1:40 |
| First `web/public/incidents/<id>.json` passing the key check (+ its `web/public/osm/` file) | **1:40** |
| 2:00 checkpoint | **2:00** |
| All hero incidents with Carbon notes + `summary` | **3:00** |
| `web/public/incidents/index.json` | 3:00 |
| `eval/results.json` + `web/public/eval/results.json`, `split: dev` | **3:00** |
| AI freeze | **3:30** |
| Both `results.json` with `split: test`, `frozen_at` set | **3:50** |

## E. Hard rules (every step)
- §13: published footage only, civilian sites only, no perpetrator, no verdict words ("war crime", "illegal", "guilty") in any string the pipeline writes; Carbon output is checked for them in code.
- `military_object ≥ 0.5`: clip → `location: null`; incident with that flag raised is never written to `web/public/`.
- `graphic_level` always set; ≥ 2 is the web's blur signal.
- Never commit data, `.env`, or saved doc pages. No Streamlit. No code reads `data_meta/rehearsal.csv`.
- Kill tests and prompt tuning use `split = dev` rows only. Product code never imports `pipeline/killtests/`.
- Every Gemini call follows `docs/VERIFIED.md`, not memory.
- Never touch the teammate's files (everything in `web/` outside `public/incidents|eval|fixtures`, plus root files and `data_meta/`).

---

## F. Steps

### Gate (target 10:45 → ~11:25)
- [x] **S1 Docs → `docs/VERIFIED.md`** (10:45–11:00) — done 10:50: 49 pages saved, 32 sourced lines; every identifier VERIFIED except YouTube URL input to the Decisions API (NOT SUPPORTED, gap 13). Not yet committed (no repo).
  Goal: verified model IDs, SDK calls, limits, video/audio/YouTube input, Decisions question types.
  Files: `docs/*.md` (saved pages, ignored), `docs/VERIFIED.md` (committed).
  Check: `grep -c 'Source:' docs/VERIFIED.md` ≥ 10 and each identifier in the prompt's CRITICAL paragraph has a line marked VERIFIED (with file + quote) or NOT FOUND.
  Fallback: an identifier NOT FOUND → tell the user before any call uses it.
- [ ] **S2 Repo + env** (5 min, as soon as the URL, data and key exist)
  Goal: `git init`, remote, pull; spec + `PROMPT_*.md` in `.git/info/exclude`; `.venv` (Python 3.11) with `pipeline/requirements.txt`; `data` symlink → `~/witness-data`; commit this plan.
  Check: `git check-ignore -q .env data docs/x.md && git status --short | grep -v '^??' | wc -l` = 0; `ls data/manifest.csv data_meta/heroes.csv web/public/sample_incident.json`; `head -1 data_meta/*.csv`.
  Fallback: no repo yet → work locally, commit when it exists.
- [ ] **G1 K1 safety + URL input** — `pipeline/killtests/k1_safety.py`
  5 `dev` strike clips through Hydrogen and the Decisions API; 1 `dev` YouTube link from `break_it.csv` as URL input to each.
  Check: `python pipeline/killtests/k1_safety.py` prints `answered N/5`, `refused N`, `youtube_url_input true|false`. Pass: 5/5 answered.
  If it fails: refusals → report for the fog decision. No URL support → `youtube_url_input: false`.
- [ ] **G2 K6 latency** — `pipeline/killtests/k6_latency.py`
  One `dev` clip: ffmpeg + Hydrogen + Decisions, wall-clock per stage.
  Check: prints total seconds. Pass: ≤ 60 s. Fail → 180 s cap, parallel calls, lower fps.
- [ ] **G3 K3-mini geolocation** — `pipeline/killtests/k3_geo.py`
  5 `dev` clips with known locations: Hydrogen landmarks → OSM landmark search → distance to the key.
  Check: prints 5 distances. Pass: ≥ 2 within 5 km. Fail → pitch "narrows to district + candidates".
- [ ] **GATE: go / fog.** I give K1, K6, K3-mini results; the user decides. **No product code before "go". On "fog": stop and re-plan (D13).**

### P1 Clip pipeline (go → 12:30)
- [ ] **P1**
  Goal: one clip (file or URL) → §9.1 record without `fake`/`location` yet.
  Files: `pipeline/ingest.py` (sha256, pHash, ffmpeg → wav + 5 frames, duration), `pipeline/gemini.py` (Hydrogen timeline + landmarks; one Decisions call), `pipeline/clip.py` (`analyze_clip`, cache), `pipeline/contract.py` (same-keys check, used for clips, incidents, stream, results).
  Fields: `clip_id`, `source_url`, `platform`, `embed_url`, `sha256`, `duration_s`, `posted_at`, `claimed_place`, `timeline[] {clip_ts, type, label, confidence}`, `triage {war_related, event_type{strike, aftermath, other}, graphic_level, civilian_objects, uxo, military_object}`, `weapon {options{8}, evidence}`, `stages_ms {fetch, watch, score}`.
  Check: `python -m pipeline.clip data/videos/<dev clip>` prints the record; `python -m pipeline.contract --selftest` passes (enum and key asserts on that record).
  Cut: none (P0).
- [ ] **11:50 fps check.** Pull, `cd web && npm i && npm run dev`, ask the user to read the fps number → teammate (12:00 point-cloud decision).

### P2 Fake checks + break-it API (12:30 → 1:15) — deadline 1:30
- [ ] **P2**
  Goal: full §9.1 record over a streamed endpoint; scoreboard; health.
  Files: `pipeline/physics.py` (onsets, flash→boom, repeated sample), `pipeline/fake.py` (§C.2–3), `pipeline/geo.py` (§C.5), `pipeline/app.py` (FastAPI on `127.0.0.1:8000`: `/api/health`, `/api/analyze`, `/api/judge` GET+POST with `data/cache/scoreboard.json`, `/api/media/<file>`).
  Fields: `fake {verdict, label, confidence, checks[4] {name, result, detail, clip_ts}}`, `location {lat, lon, radius_m, level, method, evidence, candidates}` (or `null`), `incident_id`, `stages_ms {fetch, watch, physics, score, locate, verdict}`; stream events `stage {stage, status, ms, summary}`, `result`, `error {stage, message}`; health `{ok, youtube_url_input}`; scoreboard `{tries, right, history[] {clip_id, verdict, label, truth, right}}`.
  Check: `uvicorn pipeline.app:app --port 8000 &` then
  `curl -sN -X POST 127.0.0.1:8000/api/analyze -H 'content-type: application/json' -d '{"url":"<dev game link>","claimed_place":null}' > web/public/fixtures/analyze_fake.txt` and the same with a `dev` real clip (`-F file=@…`) `> analyze_real.txt`;
  `python -m pipeline.contract --stream web/public/fixtures/analyze_*.txt` (stage order, statuses, exactly one `result`, §9.1 keys, 4 checks in order); each run ≤ 60 s; `curl -s 127.0.0.1:8000/api/health`; judge POST then GET returns the same board; `python -m pipeline.fake` self-test (one synthetic case per verdict).
  **1:30 gate — pass:** both fixture files committed and pushed, contract check exit 0. → "pull now: fixtures".
  Cut: `repeated_sample` → `n/a`; YouTube stays model-timed.

### P3 Hero incidents (1:15 → 2:00) — deadlines 1:40, 2:00
- [ ] **P3**
  Goal: real §9.2 JSON per hero in `data_meta/heroes.csv`.
  Files: `pipeline/incidents.py` (assemble, code-rule flags and notes, key check, write, copy OSM file).
  Fields: `id`, `city`, `title`, `osm_file`, `time {impact_local, plus_minus_s, basis}`, `impact {lat, lon, radius_m, method, confidence}`, `target {osm_id, footprint, levels, osm_tags, visual_basis}`, `weapon`, `flags[8] {type, label, status, confidence, t, t_end, anchor, source, clip_ts, basis}`, `review_notes[] {type, label, confidence, t, t_end, anchor, source, clip_ts, basis}` (code rules: `location_conflict`, `weak_camera`, `single_source`, `recycled_or_edited`, `graphic`), `timeline[] {t, type, source, clip_ts, confidence}`, `sources[] {id, clip_id, platform, url, embed_url, player, media_url, uploader, posted_at, duration_s, camera{lat, lon, heading_deg, fov_deg, radius_m, confidence}, boom_distance_m, offset_s, aligned, authenticity, reject_reason, graphic_level, license, findings[]}`, `summary: null`, `verification {agree_place, agree_time, corroboration, n_sources, n_rejected}`, `answer_key {source, lat, lon, url}`, `is_sample: false`.
  Check: `python -m pipeline.incidents --hero <id>` writes `web/public/incidents/<id>.json`; `python -m pipeline.contract web/public/incidents/<id>.json` exit 0 (same keys at every level as `web/public/sample_incident.json`, enums, all 8 flags in order, `|t − (clip_ts + offset_s)| ≤ 0.05`, ring guarantee or a `location_conflict` note, impact source is `youtube`/`file`, no raised `military_object`).
  **1:40 gate — pass:** one hero file committed and pushed, contract exit 0 (some `camera: null` is fine). → "pull now: first real incident".
  Cut: `camera: null`; `impact.method` `landmarks` → `claimed_place`; alignment by post time (`aligned: false`).
- [ ] **2:00 CHECKPOINT.** Pass = on the visualizer's laptop, after `git pull`, the web opens `web/public/incidents/<id>.json` for ≥ 1 hero incident with `is_sample: false`: no SAMPLE DATA banner, the timeline scrubs, and one source video plays and seeks. If not, both stop other work and fix this first.

### P4 Bulk, grouping, index, Carbon (2:00 → 3:00) — deadline 3:00
- [ ] **P4a Carbon cross-check + summary (never cut)**
  Files: `pipeline/gemini.py` (`carbon_crosscheck`), `pipeline/incidents.py`.
  Fields: `review_notes[]` of type `time_conflict`, `location_conflict`, `single_source` (each with `t`, `anchor`, `source`, `clip_ts`, `basis`), `summary`, `verification.agree_place`, `verification.agree_time`.
  Check: `python -m pipeline.incidents --hero all --carbon`; contract exit 0 on every hero file; `grep -Eil 'war crime|illegal|guilty' web/public/incidents/*.json` prints nothing.
  Cut: `summary` stays `null` (first item in the cut order). The cross-check notes stay.
- [ ] **P4b Bulk run + grouping + `index.json`**
  Files: `pipeline/bulk.py` (run screened `ok` clips through `analyze_clip` in parallel, group per §C.9, write index).
  Fields: `index.json {is_sample, city, n_clips, n_rejected, incidents[] {id, title, lat, lon, radius_m, n_sources, corroboration, impact_local}}`.
  Check: `python -m pipeline.bulk --limit 150`; `python -m pipeline.contract --index web/public/incidents/index.json`; every listed id has a file.
  Cut: `--limit 50`.
- [ ] **P4c Dev eval** (see P5 for the harness) → `eval/results.json` with `split: dev`, copied to `web/public/eval/results.json`.
  **3:00 gate — pass:** hero files with Carbon notes, `index.json`, both `results.json` (`split: dev`) committed and pushed. → "pull now: index + summaries".

### P5 Eval harness (3:00 → 3:30), freeze, test run
- [ ] **P5**
  Files: `eval/run_eval.py --split dev|test`.
  Fields: `split`, `frozen_at`, `n_clips`, `rows[] {claim, metric, witness, baseline, unit, baseline_name, n}` (geolocation within 1 km / 5 km / median, with post text and video-only, vs. Gemini asked directly · inside-radius %, baseline `null` · fake precision / recall vs. single Hydrogen call · weapon top-1 vs. majority class · civilian-area flag vs. always residential · grouping vs. city + date), `ablation {metric, unit, full_video, frames_5, transcript, n}`, `worst_misses[3] {clip_id, thumb, expected, got, why}` (largest error among scored test items; `thumb` from Commons clips only, else `null`).
  Check: `python eval/run_eval.py --split dev && cmp eval/results.json web/public/eval/results.json && python -m pipeline.contract --results eval/results.json`; `! grep -rn rehearsal pipeline eval`.
  Cut: weapon and civilian-area rows first, then the video-only geolocation mode. Ablation and fake rows stay.
- [ ] **3:30 AI FREEZE.** Commit, `git tag ai-freeze`, push. No prompt or rule changes after this.
- [ ] **3:30–3:50 test run, once.** `python eval/run_eval.py --split test` (refuses if a `split: test` result already exists; sets `frozen_at`). Commit both files. → "pull now: test results".

### After the freeze
- [ ] **P6 (3:50 → 4:30)** Crash fixes from rehearsal and latency only. Send the teammate the pipeline's README lines (how to run, sources, licenses, safety rules).
- [ ] **P7 (4:30 → 5:00)** Submit: final pull, server restart test on the demo machine, `curl /api/health`.
- [ ] **Optional, only if everything above is ticked:** geolocation funnel as a Managed Agent (method log).
