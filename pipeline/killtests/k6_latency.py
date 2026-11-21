"""K6 (throwaway, gate only): one clip end to end, wall-clock per stage. Pass = total <= 60 s.
Usage: set -a; source .env; set +a
       python pipeline/killtests/k6_latency.py CLIP
"""
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

from k1_safety import PROMPT, QUESTIONS, decisions, hydrogen, upload

path = sys.argv[1]
t = {}

t0 = time.time()
wav = tempfile.mktemp(suffix=".wav")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-t", "180", "-ac", "1", "-ar", "22050", wav], check=True)
t["ffmpeg"] = time.time() - t0

t0 = time.time()
block = upload(path)
t["upload"] = time.time() - t0


def timed(fn):
    s = time.time()
    fn()
    return time.time() - s


t0 = time.time()
with ThreadPoolExecutor() as pool:
    h = pool.submit(timed, lambda: hydrogen.interactions.create(
        model="gemini-4-hydrogen", input=[block, {"type": "text", "text": PROMPT}]))
    d = pool.submit(timed, lambda: decisions.decisions.create(
        model="gemini-decision-1", input=[{**block, "resolution": "low"}], questions=QUESTIONS))
    t["hydrogen"], t["decisions"] = h.result(), d.result()
t["gemini_parallel"] = time.time() - t0

total = t["ffmpeg"] + t["upload"] + t["gemini_parallel"]
for k, v in t.items():
    print(f"{k:16s} {v:6.1f} s")
print(f"{'TOTAL':16s} {total:6.1f} s  ->  {'PASS' if total <= 60 else 'FAIL'} (limit 60 s)")
