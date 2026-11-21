#!/usr/bin/env python3
r"""
Witness chain of custody, built around the Berkeley Protocol on Digital Open Source Investigations
(preserve originals, record provenance, log every processing step so a human can repeat it).

Files (append-only JSON Lines; each entry carries the hash of the previous entry, so edits or deletions show up):
    witness-data/custody/manifest.jsonl   one entry per original file: sha256, size, source URL, post id, capture time, tool
    witness-data/custody/steps.jsonl      one entry per pipeline step: clip sha256, step, model, prompt version, inputs, outputs

Use from code:
    from custody import record_capture, log_step
Command line:
    .\.venv\Scripts\python.exe -X utf8 custody.py backfill            # hash clips already on disk (marked as backfill)
    .\.venv\Scripts\python.exe -X utf8 custody.py verify              # re-hash every file + check both logs' hash chains
    .\.venv\Scripts\python.exe -X utf8 custody.py report <incident>   # evidence report (HTML) for e.g. 2024-06-22
"""
import csv, datetime as dt, glob, hashlib, html, json, os, platform, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("WITNESS_DATA", os.path.join(HERE, "witness-data"))
CUST = os.path.join(DATA, "custody")
MANIFEST = os.path.join(CUST, "manifest.jsonl")
STEPS = os.path.join(CUST, "steps.jsonl")
TOOL = "witness-custody/0.1"


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _last_hash(log):
    if not os.path.exists(log):
        return "0" * 64
    last = None
    with open(log, "rb") as f:
        for line in f:
            if line.strip():
                last = line
    return hashlib.sha256(last.strip()).hexdigest() if last else "0" * 64


def _append(log, entry):
    os.makedirs(CUST, exist_ok=True)
    entry["prev_entry_sha256"] = _last_hash(log)
    line = json.dumps(entry, ensure_ascii=False, sort_keys=True)
    with open(log, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    return entry


def recorded():
    out = {}
    if os.path.exists(MANIFEST):
        for line in open(MANIFEST, encoding="utf-8"):
            if line.strip():
                e = json.loads(line); out[e["local_path"]] = e
    return out


def record_capture(path, source_url, post_id="", channel="", posted_at="", tool="", captured_at=None, note=""):
    """Call right after an original file is saved. Never modify the original afterwards; work on copies."""
    rel = os.path.relpath(path, DATA).replace(os.sep, "/")
    return _append(MANIFEST, {
        "type": "capture", "local_path": rel, "sha256": sha256_file(path), "bytes": os.path.getsize(path),
        "source_url": source_url, "platform": "telegram" if "t.me/" in source_url else "", "channel": channel,
        "post_id": str(post_id), "posted_at": posted_at, "captured_at": captured_at or now(),
        "tool": tool or TOOL, "host": platform.node(), "note": note})


def log_step(clip_sha256, step, inputs, outputs, model="", prompt_version="", code_version="", started_at=None, note=""):
    """Call once per pipeline step per clip (ingest, Gemini timeline, physics, geolocation, grouping...)."""
    return _append(STEPS, {
        "type": "step", "clip_sha256": clip_sha256, "step": step, "model": model, "prompt_version": prompt_version,
        "code_version": code_version, "inputs": inputs, "outputs": outputs,
        "started_at": started_at or now(), "finished_at": now(), "note": note})


def backfill():
    done = recorded()
    rows = {}
    p = os.path.join(DATA, "telegram_clips.csv")
    if os.path.exists(p):
        for r in csv.DictReader(open(p, encoding="utf-8-sig")):
            rows[f"{r['channel']}_{r['post_id']}"] = r
    n = 0
    for f in sorted(glob.glob(os.path.join(DATA, "telegram", "*", "*")) + glob.glob(os.path.join(DATA, "videos", "**", "*.*"), recursive=True)):
        rel = os.path.relpath(f, DATA).replace(os.sep, "/")
        if rel in done or f.endswith(".part"):
            continue
        if dt.datetime.now().timestamp() - os.path.getmtime(f) < 120:
            print(f"  skipped (still downloading?): {rel}"); continue
        stem = os.path.splitext(os.path.basename(f))[0]
        m = re.match(r"(.+)_(\d+)$", stem)
        r = rows.get(stem, {})
        url = r.get("url") or (f"https://t.me/{m.group(1)}/{m.group(2)}" if m and "telegram" in rel else "")
        record_capture(f, url, post_id=r.get("post_id", m.group(2) if m else ""), channel=r.get("channel", m.group(1) if m else ""),
                       posted_at=r.get("date", ""), tool="tg_pull.py (Telethon)" if "telegram" in rel else "prep_data.py (Wikimedia)",
                       captured_at=dt.datetime.fromtimestamp(os.path.getmtime(f), dt.timezone.utc).isoformat(timespec="seconds"),
                       note="backfill: hashed after download; capture time = file modified time")
        n += 1
    print(f"backfilled {n} files -> {MANIFEST}")


def verify():
    ok = True
    for log in (MANIFEST, STEPS):
        if not os.path.exists(log):
            continue
        prev = "0" * 64
        for i, line in enumerate(open(log, "rb"), 1):
            if not line.strip():
                continue
            e = json.loads(line)
            if e.get("prev_entry_sha256") != prev:
                print(f"CHAIN BROKEN in {os.path.basename(log)} at line {i}"); ok = False
            prev = hashlib.sha256(line.strip()).hexdigest()
    for rel, e in recorded().items():
        f = os.path.join(DATA, rel)
        if not os.path.exists(f):
            print(f"MISSING {rel}"); ok = False
        elif sha256_file(f) != e["sha256"]:
            print(f"CHANGED {rel}"); ok = False
    print("custody OK: every original matches its hash and both logs are intact" if ok else "custody problems found (see above)")
    return ok


def report(incident):
    """Per-incident evidence report: originals, hashes, provenance, verified location, and every logged step."""
    man = recorded()
    hero = {}
    for fn in glob.glob(os.path.join(DATA, "*links*.txt")):
        for line in open(fn, encoding="utf-8"):
            m = re.search(r"t\.me/(?:s/)?(\w+)/(\d+).*#\s*(\S+)", line)
            if m:
                hero.setdefault(f"{m.group(1)}_{m.group(2)}", m.group(3))
    bench = {}
    bp = os.path.join(DATA, "benchmark.csv")
    if os.path.exists(bp):
        for r in csv.DictReader(open(bp, encoding="utf-8-sig")):
            bench[r["clip_file"].replace(os.sep, "/")] = r
    steps = [json.loads(l) for l in open(STEPS, encoding="utf-8")] if os.path.exists(STEPS) else []
    items = [e for rel, e in man.items() if hero.get(os.path.splitext(os.path.basename(rel))[0]) == incident]
    E = html.escape
    p = [f"<!doctype html><meta charset=utf-8><title>Evidence Report {E(incident)}</title>",
         "<style>body{font:14px system-ui;margin:32px;max-width:1100px;color:#111}table{border-collapse:collapse;width:100%;font-size:12px}"
         "td,th{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}code{font-size:11px;word-break:break-all}"
         "h1{margin-bottom:0}.s{color:#666}</style>",
         f"<h1>Evidence report: incident {E(incident)}</h1>",
         f"<p class=s>Generated {now()} by {TOOL}. Built around the Berkeley Protocol: originals preserved and hashed at capture, "
         "provenance recorded, every processing step logged. Witness gives no verdicts; findings are for human review.</p>",
         f"<h2>1. Source material ({len(items)} originals)</h2><table><tr><th>#</th><th>File</th><th>SHA-256</th><th>Source</th>"
         "<th>Posted</th><th>Captured (UTC)</th><th>Verified location (answer key)</th></tr>"]
    for i, e in enumerate(sorted(items, key=lambda e: e["local_path"]), 1):
        b = bench.get(e["local_path"], {})
        loc = f"{b.get('truth_lat','')}, {b.get('truth_lon','')} ({b.get('truth_source','')})" if b.get("truth_lat") else "none"
        p.append(f"<tr><td>{i}</td><td>{E(e['local_path'])}</td><td><code>{e['sha256']}</code></td>"
                 f"<td><a href='{E(e['source_url'])}'>{E(e['source_url'])}</a></td><td>{E(e.get('posted_at',''))}</td>"
                 f"<td>{E(e['captured_at'])}{' (backfill)' if 'backfill' in e.get('note','') else ''}</td><td>{E(loc)}</td></tr>")
    p.append("</table>")
    shas = {e["sha256"] for e in items}
    st = [s for s in steps if s["clip_sha256"] in shas]
    p.append(f"<h2>2. Processing log ({len(st)} steps)</h2>")
    if st:
        p.append("<table><tr><th>When</th><th>Clip</th><th>Step</th><th>Model / prompt</th><th>Outputs</th></tr>")
        for s in st:
            p.append(f"<tr><td>{E(s['finished_at'])}</td><td><code>{s['clip_sha256'][:12]}</code></td><td>{E(s['step'])}</td>"
                     f"<td>{E(s.get('model',''))} {E(s.get('prompt_version',''))}</td><td><code>{E(json.dumps(s['outputs'], ensure_ascii=False)[:400])}</code></td></tr>")
        p.append("</table>")
    else:
        p.append("<p>No pipeline steps logged yet for these clips.</p>")
    p.append("<h2>3. Integrity</h2><p>Re-run <code>custody.py verify</code> to re-hash every original and check that both logs are unbroken.</p>")
    out = os.path.join(DATA, f"evidence_report_{incident}.html")
    open(out, "w", encoding="utf-8").write("\n".join(p))
    print(f"{len(items)} originals, {len(st)} steps -> {out}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "verify"
    if cmd == "backfill":
        backfill()
    elif cmd == "verify":
        sys.exit(0 if verify() else 1)
    elif cmd == "report":
        report(sys.argv[2])
    else:
        print(__doc__)
