"""Median-of-3 link scoring (live path only), with a mocked scorer.  Run: python -m pipeline.test_link_median"""
import time
from concurrent.futures import ThreadPoolExecutor

from .clip import score_link


def _scorer(answers):
    """A stand-in for gemini.score: each call takes the next answer; an Exception is raised, a number is slept first."""
    it = iter(answers)

    def score(_text):
        a = next(it)
        if isinstance(a, Exception):
            raise a
        if isinstance(a, tuple):
            time.sleep(a[0])
            a = a[1]
        return {"real_strike": a, "fake_kind": {"video_game": 1 - a, "movie": 0.0}}
    return score


def _run(answers, wait_s=1):
    with ThreadPoolExecutor(1) as pool:  # one worker: the calls take their answers in order
        return score_link("a description", 3, wait_s, pool, _scorer(answers))


def test_three_results():
    scores, raw = _run([0.36, 0.95, 0.85])
    assert scores == {"real_strike": 0.85, "fake_kind": {"video_game": 1 - 0.85, "movie": 0.0}} and len(raw) == 3


def test_two_results():  # one call failed: the median of two is their mean
    scores, raw = _run([0.4, RuntimeError("503"), 0.8])
    assert abs(scores["real_strike"] - 0.6) < 1e-9 and len(raw) == 2


def test_one_result():  # one failed, one came back after the wait: the one in time is used alone
    scores, raw = _run([RuntimeError("503"), 0.7, (0.5, 0.1)], wait_s=0.2)
    assert scores["real_strike"] == 0.7 and len(raw) == 1


def test_none_in_time_or_all_failed():
    scores, raw = _run([(0.3, 0.9), RuntimeError("503"), RuntimeError("503")], wait_s=0.05)
    assert scores["real_strike"] == 0.9 and len(raw) == 1  # late, but the only answer: same as a single call
    try:
        _run([RuntimeError("a"), RuntimeError("b"), RuntimeError("c")])
        raise AssertionError("expected the scorer's error")
    except RuntimeError as e:
        assert str(e) == "a"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
    print("link median selftest OK")
