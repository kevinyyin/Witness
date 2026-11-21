# VERIFIED.md — Gemini facts checked against the official docs

Fetched 2026-11-21 from `aistudio.google.com/docs/*.md` (where `ai.google.dev/gemini-api/docs` now redirects). The saved pages are in `docs/` (git-ignored). Each fact names the saved file and line. **Nothing here has been run against the live API yet**; K1 and K6 do that.

## Models
- Hydrogen = `gemini-4-hydrogen` (stable). Source: model-gemini-4-hydrogen.md:218
- Carbon = `gemini-4-carbon` (stable). Source: model-gemini-4-carbon.md:218
- Both take text, image, video, audio, PDF. Context window 1,048,576 tokens; max output 65,536. Source: model-gemini-4-hydrogen.md:42,54,56 and model-gemini-4-carbon.md:42,54,56
- Decisions model = `gemini-decision-1`. Input limit 262,144 tokens, output 0. Source: model-gemini-decision-1.md:189,191

## SDK
- Package `google-genai`, latest 3.6.1, needs Python ≥ 3.11. Source: sdk-pypi-google-genai-json.md (`info.version`, `info.requires_python`)
- The Decisions API needs SDK ≥ 3.2. Source: decisions-api-guide.md:53
- Key env var: `GEMINI_API_KEY`; `genai.Client()` reads it. Source: sdk-get-started.md:55
- **Default API is the Interactions API (`client.interactions.create`). `generateContent` is legacy.** Source: docs-index-llms-txt.md:10
- Async client for interactions/decisions: NOT VERIFIED in the saved pages. Use the sync client in threads (`asyncio.to_thread`).

## Hydrogen / Carbon calls (Interactions API)
- Call shape: `client.interactions.create(model=…, input=[{"type":"video","uri":…,"mime_type":…}, {"type":"text","text":…}])`; text is `interaction.output_text`. Put the text prompt after the video. Source: video-understanding.md:60-68, 1638
- JSON output: `response_format={"type":"text","mime_type":"application/json","schema": <JSON schema>}`. Source: sdk-get-started.md:1378-1385
- Upload: `f = client.files.upload(file=path)`, poll `client.files.get(name=f.name)` until `f.state.name == "ACTIVE"`, then pass `f.uri` and `f.mime_type`. Source: video-understanding.md:53-58
- **YouTube URL input works with Hydrogen:** `{"type":"video","uri":"https://www.youtube.com/watch?v=…"}`. It is a preview feature. Public videos only; max 10 videos per request; free tier 8 h of YouTube per day. Source: video-understanding.md:541, 555-563, 709-712
- Default video processing is static: **frames at 1 FPS, timestamps every second**, audio included. So Hydrogen's own timestamps are about ±1 s. Source: video-understanding.md:716, 1589-1593
- Per-video options go in a `processing` object: `{"type":"static","start_offset":"10.5s","end_offset":"20s","fps":0.5}`; `fps` in (0, 24]. Source: video-understanding.md:1214-1238, 1321-1326
- `content_layers` picks `"frames"`, `"audio"`, `"transcript"` (default frames + audio). This gives the §11 ablation arms directly. Source: video-understanding.md:1387-1393
- Timestamps in prompts use `MM:SS`. Source: video-understanding.md:1635
- Video length: up to 3 h at low media resolution. About 100 tokens per second of video at low resolution. Source: video-understanding.md:1583-1585, 1609-1611
- File sizes: inline < 100 MB; Files API 2 GB per file (files page) or 20 GB paid (video page) — the two pages disagree; our clips are far below both. Files are deleted after 48 h. Source: video-understanding.md:23-25, files-api.md:480, 591-592
- Safety: extra filters are **off by default**. A blocked input or response is an HTTP 400 with `error.code` = `safety` (or `jailbreak`, `prohibited_content`, `blocklist`). `safety_settings=[{"type":…,"threshold":"off|block_only_high|…"}]` exists. Source: safety-settings.md:27-49, 187-194, 262

## Decisions API
- `client = genai.Client(http_options={"api_version": "v1beta"})`; `client.decisions.create(model="gemini-decision-1", input=…, questions={key: {...}})`. REST: `POST /v1beta/decisions`. Source: decisions-api-guide.md:63-74, 109
- Question = `type` (`noul` | `choice` | `score`) + `instructions` (text only) + `criteria`. Source: decisions-api-guide.md:1279-1281
  - `noul`: optional `criteria {true_description, false_description}`; answer `.noul` (0.01–0.99), `.confidence`. Source: decisions-api-guide.md:34, 165-168
  - `choice`: `criteria` = map option → description (2–255 options); answer `.choice`, `.probabilities` (sum to 1), `.confidence`. Options are sorted alphabetically. Source: decisions-api-guide.md:35, 244-251, 267-278, 1314
  - `score`: `criteria` = list of level descriptions, lowest first; answer `.score` (weighted mean of level indices), `.probabilities`, `.legend`, `.confidence`. Source: decisions-api-guide.md:36, 364-369, 385-395
- 1 to 1,000 questions per request, within the 262,144-token window. Question keys match `[A-Za-z0-9_-]+`, ≤ 64 chars. The model never sees the keys. Questions are scored independently in one pass; latency is nearly flat. Source: decisions-api-guide.md:40-43, 1273, 1285, 1313, 1318
- Input blocks: text, image, audio, video, document. Video block: `{"type":"video","uri"|"data":…,"mime_type":…,"resolution":"low"}`. MIME must be the real format (`video/mp4`, `video/webm`, …). Source: decisions-api-guide.md:719-742, 1136-1142
- Media by Files API URI, public HTTPS URL (≤ 15 MB), or inline base64 (≤ 100 MB per request). Source: decisions-api-guide.md:737-740
- **The Decisions API does NOT accept YouTube URLs.** Source: decisions-api-guide.md:1332
- Safety block = HTTP 400 with `error.code` (`safety`, `prohibited_content`, `blocklist`, `image_safety`, `content_blocked`). Source: decisions-api-guide.md:1295-1298
- No context caching, no Batch API. Source: decisions-api-guide.md:1337-1338
- Doc advice: ask narrow positive questions, combine in code; add an `other` option to choices. Source: decisions-api-guide.md:1224-1241
- Rate limits for Decision 1: free tier 200 RPM / 50,000 TPM. Gemini 4 interactive limits are not in the docs (dashboard only). Source: rate-limits.md:181-200, 15

## Checked claims from launch coverage
| Claim | Result |
|---|---|
| `gemini-4-hydrogen`, `gemini-4-carbon`, `gemini-decision-1` | VERIFIED |
| `client.decisions.create`, google-genai, v1beta | VERIFIED |
| Question types `noul` / `choice` / `score` | VERIFIED |
| Up to 1,000 questions per request | VERIFIED |
| ~256K-token input | VERIFIED (262,144) |
| Video and audio input on the Decisions API | VERIFIED |
| YouTube URL input to Hydrogen | VERIFIED (preview) |
| YouTube URL input to the Decisions API | **NOT SUPPORTED** |

## What this changes in the pipeline
1. Hydrogen and Carbon are called through `client.interactions.create`, not `generateContent`.
2. File inputs: upload once with the Files API, give the same `uri` to Hydrogen and to the Decisions API in parallel.
3. YouTube URL inputs without a download: Hydrogen watches the URL; the Decisions API scores Hydrogen's written observations (text), not the video.
4. Hydrogen's timing is 1 FPS. Flash and boom times are refined in code (audio onsets, frame brightness) when we hold the file; in model-timed mode a second Hydrogen pass re-reads ±5 s around the blast at `fps: 10`.
5. Ablation arms: full = default layers; transcript = `content_layers: ["transcript"]`; 5 frames = five image blocks.

## Not read yet
Managed Agents pages (only needed for the optional last step). Rate limits for our own key (dashboard).
