"""Plain-code physics: blast onsets from audio, flash time from frame brightness, flash->boom distance, repeated samples."""
import subprocess

import numpy as np
from scipy.io import wavfile
from scipy.signal import correlate

SOUND_M_S = 343.0
WINDOW_S = 1.5  # Hydrogen samples at 1 FPS (docs/VERIFIED.md), so its times are only good to about a second
JUMP_DB = 10.0  # a blast = loudness rising this far above the median of the previous second


def load_audio(wav):
    """Returns samples, rate and blast-like onsets [(time_s, dB over the previous second's median)]."""
    sr, y = wavfile.read(str(wav))
    y = y.astype(np.float32) / 32768
    hop = sr // 50  # 20 ms
    m = len(y) // hop
    db = 10 * np.log10((y[: m * hop].reshape(m, hop) ** 2).mean(axis=1) + 1e-10)
    onsets, i = [], 1
    while i < m:
        rise = db[i] - np.median(db[max(0, i - 50): i])
        if rise >= JUMP_DB:
            onsets.append((i * hop / sr, float(rise)))
            i += 25  # one onset per half second
        else:
            i += 1
    return y, sr, onsets


def onset_near(onsets, ts, window=2 * WINDOW_S):
    """The loudness onset closest in time to a model-reported blast, or None."""
    near = [(abs(t - ts), t) for t, _ in onsets if abs(t - ts) <= window]
    return min(near)[1] if near else None


def flash_near(path, ts, before=None):
    """Time of the largest brightness jump within WINDOW_S of a model-reported flash, or None.

    `before` = the measured boom time: light always arrives first, and a close blast shakes the camera,
    so nothing after the boom may count as the flash.
    """
    start = max(0.0, ts - WINDOW_S)
    end = start + 2 * WINDOW_S if before is None else min(start + 2 * WINDOW_S, before + 0.1)
    if end - start < 0.2:
        return None
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{start:.2f}", "-t", f"{end - start:.2f}", "-i", str(path),
         "-vf", "fps=30,scale=64:36,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
    n = len(raw) // (64 * 36)
    if n < 3:
        return None
    # 4x4-pixel block means, so a small distant fireball still shows up
    blocks = np.frombuffer(raw[: n * 64 * 36], np.uint8).reshape(n, 9, 4, 16, 4).mean(axis=(2, 4))
    jump = np.diff(blocks, axis=0).max(axis=(1, 2))
    i = int(jump.argmax())
    return start + (i + 1) / 30 if jump[i] >= 25 else None


def max_repeat(y, sr, times):
    """Highest normalized cross-correlation between 0.5 s windows at two blast onsets (1.0 = identical sample)."""
    wins = []
    for t in times[:6]:
        w = y[max(0, int((t - 0.02) * sr)): int((t + 0.5) * sr)]
        if len(w) > sr // 4 and np.linalg.norm(w) > 0:
            wins.append((t, w / np.linalg.norm(w)))
    best = (0.0, None, None)
    for i in range(len(wins)):
        for j in range(i + 1, len(wins)):
            c = float(np.abs(correlate(wins[i][1], wins[j][1], mode="full", method="fft")).max())
            if c > best[0]:
                best = (c, wins[i][0], wins[j][0])
    return best


def measure(path, wav, timeline):
    """Refines Hydrogen's flash and blast times against the file. Returns what the fake checks need."""
    flashes = [e["clip_ts"] for e in timeline if e["type"] == "flash"]
    blasts = [e["clip_ts"] for e in timeline if e["type"] in ("blast", "burst")]
    out = {"flash_ts": None, "blast_ts": None, "delta_s": None, "refined": False, "blast_times": [], "repeat": (0.0, None, None)}
    y = sr = None
    onsets = []
    if wav:
        y, sr, onsets = load_audio(wav)
        out["blast_times"] = sorted({round(t, 2) for t in (onset_near(onsets, b) for b in blasts) if t is not None})
        if len(out["blast_times"]) >= 2:
            out["repeat"] = max_repeat(y, sr, out["blast_times"])
    if flashes and blasts:
        flash = flashes[0]
        blast = next((b for b in blasts if b >= flash - 0.5), blasts[0])
        b_ref = onset_near(onsets, blast) if onsets else None
        f_ref = flash_near(path, flash, before=b_ref) if path else None
        out["refined"] = f_ref is not None and b_ref is not None
        out["blast_ts"] = round(b_ref if b_ref is not None else blast, 2)
        out["flash_ts"] = round(f_ref if f_ref is not None else min(flash, out["blast_ts"]), 2)
        out["delta_s"] = round(max(0.0, out["blast_ts"] - out["flash_ts"]), 2)
    return out


if __name__ == "__main__":
    # self-check: two identical synthetic bursts must correlate ~1, noise must not
    rng = np.random.default_rng(0)
    sr_, burst = 22050, rng.standard_normal(11025) * np.exp(-np.linspace(0, 6, 11025))
    y_ = np.concatenate([np.zeros(sr_), burst, np.zeros(sr_), burst, np.zeros(sr_), rng.standard_normal(11025) * 0.5])
    assert max_repeat(y_, sr_, [1.0, 2.5])[0] > 0.95
    assert max_repeat(y_, sr_, [1.0, 4.0])[0] < 0.5
    assert onset_near([(1.0, 12.0), (1.4, 15.0), (9.0, 20.0)], 1.3) == 1.4 and onset_near([(9.0, 20.0)], 1.0) is None
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".wav") as f:
        quiet = rng.standard_normal(len(y_)) * 0.001
        wavfile.write(f.name, sr_, ((y_ / np.abs(y_).max() * 0.8 + quiet) * 32767).astype(np.int16))
        found = [round(t, 1) for t, _ in load_audio(f.name)[2]]
    assert found[:2] == [1.0, 2.5], found
    print("physics selftest OK")
