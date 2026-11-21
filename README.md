# Witness

Investigators get hundreds of thousands of war videos with no location, no grouping, and fakes mixed in. Witness takes the pile, throws out the fakes, places each real clip on a map with honest uncertainty, groups clips of the same strike, and lets a human scrub through a 3D reconstruction of each strike with every source video one click away. **It sorts. Humans decide.**

Built at the Gemini 4 NYC Hackathon, Nov 21, 2026. Track: **Element 119** (video and audio are the input; we show where it breaks).

## Contents
1. [What it does](#what-it-does)
2. [Built before vs during the event](#built-before-vs-during-the-event)
3. [How Gemini 4 is used](#how-gemini-4-is-used)
4. [How it works](#how-it-works)
5. [Proof](#proof)
6. [Where it breaks](#where-it-breaks)
7. [How to run](#how-to-run)
8. [Repo layout](#repo-layout)
9. [Data, sources and licenses](#data-sources-and-licenses)
10. [Safety rules](#safety-rules)

## What it does
There are four screens (`web/`), all fed by one Python pipeline (`pipeline/`).

| Screen | Route | What a person does there |
|---|---|---|
| **Break it** | `#/break` | Paste any YouTube link or drop any video file. Witness watches and listens to it live and answers: real strike footage, a fake (video game, film, fireworks, demolition, unrelated), or unsure. The clip plays on the page, and every reason on the verdict card is a button that jumps the video to the moment it is about. A real clip is placed on a map with its uncertainty radius. A scoreboard keeps every answer, wrong ones included. |
| **Reconstruction** | `#/incident/<id>` | One strike, rebuilt from several clips. A point-cloud city block from OpenStreetMap, a clock, the impact, flags and review notes that appear in the scene at the moment they apply, and the source video that covers the playhead. Where two cameras caught the same moment, both play together. Drag the timeline and everything rewinds. |
| **Overview** | `#/` | A map of the rebuilt incidents (two, chosen by hand), each with its radius and how many clips back it. |
| **Proof** | `#/proof` | Scores against published answer keys, each next to a baseline, plus what we changed after seeing failures and the worst misses. |

Witness never says who did it, never says "war crime", and never names a weapon as fact. It shows indicators, each with its evidence and a confidence.

## Built before vs during the event
**Before** (no product code):
- **The plan.** `WITNESS_SPEC.md`, a planning document (not in the public repo). Its current revision is dated Nov 20.
- **The data download script.** `prep_data.py` (not in the public repo) downloaded openly licensed videos, OpenStreetMap extracts and published answer keys.
- **The data folder** that script filled. It is not in git (see [Data](#data-sources-and-licenses)).
- **Human screening lists**, in `data_meta/*.csv`: which clips are fit to show, which incidents to use as hero examples, and the YouTube links for testing. This started the night before and the screening of hero clips continued during the event.
- **Camera poses**, in `data_meta/camera_poses.csv`: where each camera stood and which way it faced, from matching the skyline in a frame against OpenStreetMap buildings with a separate script (`skyline.py`, not in the public repo). The pipeline reads these positions; it does not compute them.

**During**: every line in `pipeline/`, `web/` and `eval/`. The first commit in this repository is from 10:46 AM on Nov 21, 2026.

**The incidents on screen are a human list.** The Overview and Reconstruction screens show the incidents in `data_meta/heroes.csv`: a person picked which clips belong to each one, by Bellingcat incident id. They are not the output of the grouping algorithm. Automatic grouping is scored on the Proof screen (the "Grouping" row) and its groups are not displayed.

Nothing was trained. The models are used as they come; the data is only used to test against.

## How Gemini 4 is used
Three models, each with one job. The model IDs are in `pipeline/gemini.py`.

| Model | Job | Why this model |
|---|---|---|
| **Gemini 4 Hydrogen** (`gemini-4-hydrogen`) | Watches and listens to each clip. Returns a timed list of events (flash, blast, siren, engine buzz, fire, rescue, speech), the landmarks and signs it can read, whether a game or film interface is on screen, and a plain description. Also gives three independent reads of where the clip was filmed, and a second, finer pass at 10 frames per second around a blast. | Fast enough to run on every clip, and it takes video with sound, including a YouTube link directly. |
| **Gemini 4 Carbon** (`gemini-4-carbon`) | Second reader of each assembled incident. It gets the incident as JSON and reports contradictions a human must check (two clips disagree on time, a clip seems to show another place, an event only one clip shows), then writes the short summary. | Slower and deeper; it runs once per incident, not once per clip. |
| **Decisions API** (`gemini-decision-1`) | Every calibrated score: war-related or not, real footage or not and which kind of fake, how graphic, civilian objects, unexploded ordnance, military objects, weapon indicators, and "was this filmed at this place?" for each map candidate. | It returns probabilities, so thresholds live in code where they can be read and tested. |

What plain code does, on purpose, instead of a model:
- **Physics.** Light arrives before sound. The gap between the flash and the boom, times 343 m/s, is the distance from the camera to the blast. A boom that arrives with a distant flash is a sign of dubbed or rendered footage.
- **Repeated sound.** Two blasts whose waveforms are identical are a stock sound effect.
- **Seen before.** A perceptual hash catches the same pictures posted earlier under another caption.
- **The verdict.** `pipeline/fake.py` is the only place a clip is called fake: four named checks, then an explicit rule, with the thresholds at the top of the file.

## How it works
```
clip (video file, or a YouTube link) + optional text of the post
 -> ingest        files only: sha256, perceptual hash, audio track, 5 frames
 -> Hydrogen      event timeline, landmarks, on-screen interface, description
 -> physics       blast onsets from the audio, flash from frame brightness,
                  flash-to-boom gap -> distance, repeated-sample test
 -> Decisions     all scores in one call (the video itself for a file;
                  Hydrogen's description for a link)
 -> fake verdict  four checks -> real / fake / unsure, with reasons
 -> locate        town named in the post or clip -> three Hydrogen reads
                  (the middle one is the estimate, their spread sets the
                  radius) -> landmarks looked up in OpenStreetMap and
                  scored against the footage
 -> grouping      clips whose radius and time window overlap
 -> incident      shared timeline, impact, target building, flags
 -> Carbon        cross-check notes and the summary
 -> contract      the JSON is checked key by key before it is written
```
- A clip that shows a military object (score 0.5 or higher) is never located, and such an incident is never written.
- The answer keys are never used to locate anything. The eval reads them to score, one early test script read them, and the incident builder copies the published location into the incident file so the reconstruction can show it next to our estimate.
- The server streams each stage as it finishes (`POST /api/analyze`), which is what the break-it screen shows ticking.
- On the live path the server waits at most 8 seconds for the three location reads and 20 seconds for the finer timing pass, so a verdict arrives in under a minute. Bulk runs and the eval wait for everything.
- On the live path a link is scored by three Decisions calls at once and the median of each score is used; the score step shows all three. Bulk runs and the eval use one call, so the test-set link numbers are single-call numbers. `WITNESS_LINK_MEDIAN=0` turns it off.

Other endpoints: `GET /api/health`, `GET` and `POST /api/judge` (the scoreboard), `GET /api/media/<file>` (local video files for the reconstruction).

## Proof
Ground truth is published investigator work (Bellingcat Civilian Harm in Ukraine, GeoConfirmed, CIR, Texty). `eval/split.csv` fixes which clips are `dev` and which are `test`. Clips were assigned by a hash of their id before any tuning on them, and one clip that was run by mistake before the freeze is excluded. Everything was tuned on `dev` only. The `test` split is run once, after the pipeline is frozen; the script refuses to run it a second time.

`eval/results.json` is the source of truth and carries a `split` field. The numbers below are the **test set: 70 clips the pipeline had never been run on, scored once after the freeze** (finished 3:47 PM, Nov 21).

| Claim | Metric | Witness | Claude Opus 5.5 (5 frames + caption) | Hydrogen asked directly | n |
|---|---|---|---|---|---|
| Geolocation | within 1 km | 47% | 23% | 40% | 47 |
| Geolocation | within 5 km | 83% | 77% | 81% | 47 |
| Geolocation | median error | 1.2 km | 2.6 km | 1.2 km | 47 |
| Honest uncertainty | true location inside the stated radius | 66% (target 70%, missed) | n/a | n/a | 47 |
| Fakes caught | recall | 100% | 100% | 100% | 70 |
| Fakes caught | precision | 95% | 100% (file clips; Witness 92% on the same 60) | 100% | 70 |
| Grouping | hero clips grouped correctly | 82% | 79% (group by city and date) | | 28 |

Which input matters, on the real-or-fake question (n = 60): full video 98%, five still frames 95%, transcript only 48%.

Read these honestly:
- **Geolocation is the win, against the other lab's model.** Twice as many clips land within 1 km (47% against 23%) and the median error is less than half (1.2 km against 2.6 km). Against a single direct Hydrogen call the edge is small: 47% against 40% within 1 km, and the same median.
- **The uncertainty radius is too tight.** The true location is inside it 66% of the time, under our 70% target. On the dev set it was 76%, because the radius rule was tuned there.
- **Fake detection is slightly worse than a single call on this set.** Witness rejected all 19 fakes, and also rejected one real strike clip as "not war". Every baseline was right on every clip it was given (Opus sees only the 60 file clips). These fakes (fireworks, demolitions, games, films) are easy for any current model.
- **The dev numbers were optimistic.** Within 1 km fell from 59% on dev to 47% on test, and the median error rose from 0.7 km to 1.2 km.
- **Full video beats still frames only slightly** on real-or-fake. Sound and motion earn their place in the flash-to-boom measurement and the event timeline.

How the test run went: the first attempt crashed 20 minutes in, before any result was written, on a file whose name contains "ß" (see below). The upload was fixed and the run resumed from the clips already analyzed. No result had been computed or seen when the fix was made.

Reproduce the dev numbers: `python eval/run_eval.py --split dev`. It needs the data folder and API keys (see [How to run](#how-to-run)).

## Where it breaks
Found by pushing on it during the event. The fixes we made are listed on the proof screen with their commits.

- **A link is judged from a description, and descriptions vary.** The Decisions API cannot take a YouTube link, so for links it scores Hydrogen's written description. Five runs of one real clip gave not-real scores of 0.05, 0.14, 0.15, 0.35 and 0.64. A link is therefore rejected only at 0.8 or higher; between 0.45 and 0.8 the answer is "unsure, needs a human". A dropped file is scored on the footage itself and is steadier.
- **Location reads on a link are slow.** One read took over two minutes. The live path stops waiting after 8 seconds, so a fresh link is usually placed at city level only.
- **A real clip was rejected on the test set.** One Telegram clip of a real strike scored 0.89 not-real and was called "not war". It is the only wrong verdict in 70.
- **Three reads can agree and still be wrong.** The three worst test misses are 13 to 14 km off. In each, the three location reads agreed with each other to about 1 km (all naming Industrialnyi District, Kharkiv), so the radius was 2.5 to 3.9 km and the true location fell outside it.
- **A file name broke the upload.** A clip with "ß" in its name could not be uploaded, because the file name travels in an HTTP header that must be plain ASCII. It crashed the first test run. Such files are now uploaded through a plain-named link.
- **Town names are ambiguous.** A name lookup once returned the wrong Dnipro, 468 km away. Two location reads that agree now overrule the lookup.
- **Most footage is aftermath.** In the two rebuilt incidents no clip gives a usable flash-to-boom distance: one dashcam is inside the blast and one street camera has no sound. The impact location comes from landmarks, and the impact time is only known to about an hour, from upload times.
- **Alignment by flash alone is rough.** Hydrogen reads one frame per second, so two cameras aligned by their flash agree to about a second.
- **The 3D city is not a scan.** It is generated from OpenStreetMap footprints with estimated heights.
- **Carbon's notes change between runs.** One incident's corroboration level moved between "medium" and "high" on a re-run because a note was not repeated.
- **Weapon indicators are weak.** Both rebuilt incidents come out "unclear", which is the honest answer.

## How to run
Needs Python 3.11 or newer, Node, and ffmpeg.

**A fresh clone without the data folder and a Gemini key gets the 3D scenes, the static data (incidents, map extracts, eval results) and two recorded Break-it runs only.** The web app (step 2) and the checks (step 4) run without either. Live analysis, the local source videos in the reconstruction, rebuilding incidents and the eval need the data folder and the key.

**1. The pipeline server**
```
python3.11 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
echo "GEMINI_API_KEY=..." > .env
.venv/bin/uvicorn pipeline.app:app --host 127.0.0.1 --port 8000
```
The server has no page of its own; `http://127.0.0.1:8000/docs` lists its endpoints. `ANTHROPIC_API_KEY` in `.env` is needed only for the eval's Claude baseline.

**2. The web app**
```
cd web
npm install
npm run dev          # http://localhost:5173
```
- Use `localhost`, not `127.0.0.1`. The dev server proxies `/api` to the pipeline server.
- Without the pipeline server, the break-it screen replays two recorded runs from `web/public/fixtures/` under a SAMPLE DATA banner.
- Incident data is static: `web/public/incidents/*.json`, written by the pipeline. `web/public/sample_incident.json` is a hand-made fixture for development and always shows a SAMPLE DATA banner.
- Keys in the reconstruction: Space play or pause · left and right arrows previous or next marker · J / K / L for 0.25x, pause, 4x · W wireframe · F shows the frame-rate box. Drag for a free camera; "Walkthrough" returns to the directed camera.

**3. Rebuilding the data products** (needs the data folder)
```
.venv/bin/python -m pipeline.clip PATH_OR_URL [--place TEXT] [--fresh]   # one clip, stages printed
.venv/bin/python -m pipeline.bulk                                        # bulk run + grouping
.venv/bin/python -m pipeline.incidents --hero 0622 --carbon              # one rebuilt incident
.venv/bin/python eval/run_eval.py --split dev                            # the proof numbers
```

**4. Checks**
```
cd web && npm test                               # timing, scene and stream tests
.venv/bin/python -m pipeline.fake                # verdict rule self-check
.venv/bin/python -m pipeline.physics             # audio self-check
.venv/bin/python -m pipeline.contract --selftest
.venv/bin/python -m pipeline.test_link_median   # median-of-3 link scoring, mocked scorer
```

## Repo layout
```
pipeline/        Python + FastAPI
  app.py         the server: /api/analyze (stage stream), /api/judge, /api/health, /api/media
  clip.py        one clip -> record, as a stream of stage events
  ingest.py      hashes, audio track, frames (files only)
  gemini.py      every model call: prompts, schemas, Decisions questions
  physics.py     blast onsets, flash time, flash-to-boom, repeated samples
  fake.py        the four checks and the verdict rule
  geo.py         the location funnel
  bulk.py        bulk run and grouping
  incidents.py   incident assembly and the Carbon cross-check
  contract.py    checks on every JSON file before it is written
  killtests/     throwaway scripts from the 10:30 go/no-go gate
web/             Vite + React + three.js
  src/scene/     point-cloud city, markers, directed camera
  src/time/      everything on screen as a pure function of scene time
  src/ui/        the four screens
  src/breakit/   stream reader and API calls for the break-it screen
  public/        incident JSON, eval results, OSM extracts, recorded fixtures
eval/            run_eval.py, split.csv, results.json
data_meta/       CSV exports of the human decisions (screening, heroes, test links)
custody.py       chain-of-custody log: a hash-chained record of every file and processing step; the incident builder reads its manifest
docs/VERIFIED.md facts about the Gemini API checked against the official docs on the day
PLAN_*.md        the working plans
data/            link to the data folder (not in git)
```
Not in the public repo: `WITNESS_SPEC.md` (the planning document), `prep_data.py` (the data download script) and `skyline.py` (the skyline-matching script that produced `data_meta/camera_poses.csv`). Comments that cite a section number (§) refer to the planning document.

## Data, sources and licenses
`data/` is a link to a folder outside the repository (videos, OpenStreetMap extracts, answer keys). Code reads its path from `WITNESS_DATA`.
- Mac or Linux: `ln -s ~/witness-data data`
- Windows: `mklink /J data <path-to>\witness-data`

Sources:
- **Map geometry:** © OpenStreetMap contributors (ODbL). Town lookups use OpenStreetMap's Nominatim.
- **Strike-aftermath videos:** Ukraine State Emergency Service (dsns.gov.ua) and Interior Ministry via Wikimedia Commons, CC BY 4.0.
- **Answer keys:** Bellingcat Civilian Harm in Ukraine, GeoConfirmed, CIR Eyes on Russia, Texty.
- **YouTube clips** are analyzed by link and played through the official embed. They are not downloaded or redistributed.
- **Telegram clips** are used for the two rebuilt incidents and part of the eval. They are analyzed and played from local files in the data folder. The organizers confirmed on the day (12:07 PM) that downloaded Telegram clips may be used.
- **No video is stored in this repository.**

## Safety rules
- Only already-published footage, days old or older. Civilian sites only. Witness never locates defensive positions or troop movements: a clip that shows a military object gets no location, and such an incident is never written.
- No perpetrator attribution and no legal verdicts. Flags are for legal review, never findings.
- Graphic level 2 or higher is blurred by default, on both the reconstruction and the break-it screen.
- Results go to investigators. There is no public map.
- Every claim on screen names the clip and the second it rests on.
