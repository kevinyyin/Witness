"""Ingest: sha256, duration, wav for the audio checks, 5 frames for pHash and the frames baseline."""
import hashlib
import subprocess

import imagehash
from PIL import Image

from . import CACHE

MAX_S = 180  # §7.2: clips over 3 min are analyzed on the first 3 min only


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def duration(path):
    return float(_run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)))


def prepare(path):
    """Returns sha256, duration_s, wav path, 5 frame paths, 5 pHashes and the file to upload."""
    digest = sha256(path)
    out = CACHE / "media" / digest
    out.mkdir(parents=True, exist_ok=True)
    dur = duration(path)
    wav = out / "audio.wav"
    if not wav.exists():
        # a clip with no audio track makes ffmpeg fail; the audio checks then report n/a
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-t", str(MAX_S), "-vn", "-ac", "1",
                        "-ar", "22050", str(wav)], capture_output=True)
    frames = []
    for i, frac in enumerate((0.1, 0.3, 0.5, 0.7, 0.9)):
        jpg = out / f"frame_{i}.jpg"
        if not jpg.exists():
            _run("ffmpeg", "-v", "error", "-y", "-ss", f"{min(dur, MAX_S) * frac:.2f}", "-i", str(path),
                 "-frames:v", "1", "-vf", "scale=640:-2", str(jpg))
        frames.append(jpg)
    upload = path
    if dur > MAX_S:
        upload = out / ("first180" + str(path)[str(path).rfind("."):])
        if not upload.exists():
            _run("ffmpeg", "-v", "error", "-y", "-i", str(path), "-t", str(MAX_S), "-c", "copy", str(upload))
    return {
        "sha256": digest,
        "duration_s": round(dur, 2),
        "wav": wav if wav.exists() else None,
        "frames": frames,
        "phash": [str(imagehash.phash(Image.open(f))) for f in frames if f.exists()],
        "upload": upload,
    }
