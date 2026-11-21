"""Witness pipeline. Paths and the API key are set up here, once."""
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
_env = ROOT / ".env"
if _env.exists():
    for _line in _env.read_text().splitlines():
        _k, _, _v = _line.partition("=")
        if _k.strip() and not _k.startswith("#"):
            os.environ.setdefault(_k.strip(), _v.strip())

DATA = pathlib.Path(os.environ.get("WITNESS_DATA", "~/witness-data")).expanduser()
CACHE = DATA / "cache"  # under the data folder, so it is never committed
(CACHE / "clips").mkdir(parents=True, exist_ok=True)
PUBLIC = ROOT / "web" / "public"
