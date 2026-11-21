"""All Gemini calls. Shapes follow docs/VERIFIED.md (Interactions API + Decisions API)."""
import json
import time

from google import genai

from . import ROOT  # noqa: F401  (importing the package loads GEMINI_API_KEY from .env)

HYDROGEN = "gemini-4-hydrogen"
CARBON = "gemini-4-carbon"
DECISION = "gemini-decision-1"

class _Lazy:
    """Creates the client on first use, so the server can start (and serve media) on a laptop without a key."""

    def __init__(self, **kw):
        self._kw, self._c = kw, None

    def __getattr__(self, name):
        if self._c is None:
            self._c = genai.Client(**self._kw)
        return getattr(self._c, name)


_client = _Lazy()
_decisions = _Lazy(http_options={"api_version": "v1beta"})

EVENT_TYPES = ["siren", "flash", "blast", "burst", "engine_buzz", "jet", "gunfire", "fire", "rescue", "speech"]
WEAPONS = ["shahed_drone", "cruise_missile", "ballistic_missile", "glide_bomb", "rocket_cluster", "tube_artillery",
           "fpv_drone", "unknown"]
FAKE_KINDS = ["video_game", "movie", "fireworks", "demolition", "not_war"]

WATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "duration_s": {"type": "number"},
        "timeline": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "clip_ts": {"type": "number", "description": "Seconds from the start of the clip, with decimals."},
                "type": {"type": "string", "enum": EVENT_TYPES},
                "label": {"type": "string", "description": "Up to 8 words, what is seen or heard."},
                "confidence": {"type": "number"},
            },
            "required": ["clip_ts", "type", "label", "confidence"]}},
        "landmarks": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Exactly as written on a sign or said aloud, original script. Empty if unnamed."},
                "name_en": {"type": "string"},
                "kind": {"type": "string", "description": "church, mall, metro station, tower, hospital, school, shop, park, apartment block, other"},
                "clip_ts": {"type": "number"},
            },
            "required": ["name", "name_en", "kind", "clip_ts"]}},
        "hud_present": {"type": "boolean", "description": "Game interface, crosshair, minimap, ammo counter or film credits on screen."},
        "hud_start_s": {"type": "number"},
        "hud_end_s": {"type": "number"},
        "apparent_blast_distance_m": {"type": "number", "description": "Visual estimate of camera-to-explosion distance in metres. 0 if no explosion is visible."},
        "city_guess": {"type": "string", "description": "City named on screen or in speech. Empty if none."},
        "observations": {"type": "string", "description": "4 to 6 plain sentences: what the footage shows and sounds like, and whether it looks like real camera footage, a video game, a film, fireworks or a demolition, and why."},
    },
    "required": ["duration_s", "timeline", "landmarks", "hud_present", "hud_start_s", "hud_end_s",
                 "apparent_blast_distance_m", "city_guess", "observations"],
}

WATCH_PROMPT = """You watch and listen to one video for an investigator who sorts footage of attacks.
Report only what is seen and heard. Do not say who is responsible and do not make legal judgements.

timeline: every event, in order, with clip_ts in seconds.
- flash = the first visible light of an explosion. blast = the moment its sound is heard. Sound travels slower than light, so give each its own time.
- burst = many blasts almost at once. engine_buzz = moped-like drone engine. jet = jet or missile roar.
- siren, gunfire, fire (flames or heavy smoke first visible), rescue (firefighters, medics), speech.
landmarks: anything a person could find on a map. Copy sign text exactly. Never invent a name.
confidence is 0 to 1."""


def upload(path):
    """Files API upload; returns a video block usable by Hydrogen and by the Decisions API."""
    f = _client.files.upload(file=str(path))
    while not f.state or f.state.name != "ACTIVE":
        if f.state and f.state.name == "FAILED":
            raise RuntimeError("Gemini could not process the video file")
        time.sleep(1)
        f = _client.files.get(name=f.name)
    return {"type": "video", "uri": f.uri, "mime_type": f.mime_type}


def watch(video_block, claimed_place=None, model=HYDROGEN):
    """Hydrogen: event timeline, landmarks, HUD and a written description."""
    prompt = WATCH_PROMPT + (f'\nThe post that carried this video said: "{claimed_place}". Treat that as a claim, not a fact.'
                             if claimed_place else "")
    out = _client.interactions.create(
        model=model,
        input=[video_block, {"type": "text", "text": prompt}],
        response_format={"type": "text", "mime_type": "application/json", "schema": WATCH_SCHEMA},
    ).output_text
    return json.loads(out)


def _noul(text, yes=None, no=None):
    q = {"type": "noul", "instructions": text}
    if yes:
        q["criteria"] = {"true_description": yes, "false_description": no}
    return q


QUESTIONS = {
    "war_related": _noul("Does this show an armed attack, an explosion caused by a weapon, or the damage left by one?"),
    "event_type": {"type": "choice", "instructions": "What does this mainly show?", "criteria": {
        "strike": "The moment of an attack: an explosion or impact is seen or heard.",
        "aftermath": "Damage, fire, smoke, debris or rescue work after an attack, with no impact moment.",
        "other": "Anything else."}},
    "graphic_level": {"type": "score", "instructions": "How graphic is this?", "criteria": [
        "Nothing disturbing.",
        "Damage only: smoke, fire, rubble, damaged buildings.",
        "Injuries or blood are visible.",
        "Severe: dead bodies or severe injuries are visible."]},
    "civilian_objects": _noul("Are civilian buildings or objects visible, such as homes, apartment blocks, shops, schools, hospitals or civilian cars?"),
    "uxo": _noul("Is an unexploded bomb, missile, rocket, shell or submunition visible, lying on the ground or stuck in a surface?"),
    "military_object": _noul("Is a military object visible, such as soldiers in position, military vehicles, air-defence launchers, trenches or weapons being operated?"),
    "real_strike": _noul(
        "Is this authentic camera footage of a real armed attack or its aftermath?",
        "Real camera footage (phone, CCTV, dashcam, news camera) of a weapon strike, an explosion from an attack, or the damage after one.",
        "A video game, a film or TV scene, computer-generated or staged footage, fireworks, a controlled demolition, or footage unrelated to armed conflict."),
    "fake_kind": {"type": "choice", "instructions": "If this is not real footage of a real armed attack, what is it most likely?", "criteria": {
        "video_game": "Rendered game graphics, a game interface, or game-like camera movement.",
        "movie": "A film, TV or staged scene: cinematic framing, actors, edited sound.",
        "fireworks": "Fireworks or pyrotechnics.",
        "demolition": "A planned, controlled demolition of a structure.",
        "not_war": "Real footage of something unrelated to armed conflict, such as weather, an accident or everyday life."}},
    "weapon": {"type": "choice", "instructions": "Which weapon do the visible and audible cues point to most?", "criteria": {
        "shahed_drone": "A moped-like engine buzz before the blast, or a small delta-wing drone.",
        "cruise_missile": "A jet roar with a long approach before the blast.",
        "ballistic_missile": "Little or no approach sound before a very large blast.",
        "glide_bomb": "A very large single blast with no engine sound, near a front line.",
        "rocket_cluster": "A burst of many near-simultaneous blasts or rocket launches.",
        "tube_artillery": "A whistle followed by a medium blast; repeated single shells.",
        "fpv_drone": "First-person drone video ending at a target, or a small high-pitched quadcopter.",
        "unknown": "No cue is clear enough to choose."}},
}


def same_place(input_blocks, places):
    """Decisions API: for each candidate place, the probability that the clip was filmed there."""
    qs = {f"p{i}": _noul(f"Was this filmed at or within sight of this place: {p}?") for i, p in enumerate(places)}
    answers = _decisions.decisions.create(model=DECISION, input=input_blocks, questions=qs).answers
    return [answers[f"p{i}"].noul for i in range(len(places))]


def retime(video_block, around_s):
    """Model-timed mode only: Hydrogen re-reads +-5 s around a blast at 10 fps for a finer flash and boom time."""
    start = max(0.0, around_s - 5)
    block = {**video_block, "processing": {"type": "static", "start_offset": f"{start:.1f}s",
                                           "end_offset": f"{around_s + 5:.1f}s", "fps": 10}}
    out = json.loads(_client.interactions.create(
        model=HYDROGEN,
        input=[block, {"type": "text", "text": "Give the time of the first visible light of the explosion (flash_ts) "
                       "and the time its sound is first heard (blast_ts), in seconds from the start of the full video, with decimals."}],
        response_format={"type": "text", "mime_type": "application/json", "schema": {
            "type": "object", "properties": {"flash_ts": {"type": "number"}, "blast_ts": {"type": "number"}},
            "required": ["flash_ts", "blast_ts"]}},
    ).output_text)
    ok = all(start - 1 <= float(out[k]) <= around_s + 6 for k in ("flash_ts", "blast_ts"))
    return (float(out["flash_ts"]), float(out["blast_ts"])) if ok else None


def score(input_blocks):
    """One Decisions call with every question. Returns plain dicts keyed like QUESTIONS."""
    answers = _decisions.decisions.create(model=DECISION, input=input_blocks, questions=QUESTIONS).answers
    out = {}
    for key, a in answers.items():
        kind = QUESTIONS[key]["type"]
        if kind == "noul":
            out[key] = a.noul
        elif kind == "score":
            out[key] = a.score
        else:
            out[key] = dict(a.probabilities)
    return out
