from __future__ import annotations

MANDARIN_REPO_ID = "hexgrad/Kokoro-82M-v1.1-zh"
ENGLISH_REPO_ID = "hexgrad/Kokoro-82M"

VOICES = [
    {"id": "zm_009", "name": "Male 009", "label": "男声 009", "description": "Punchier Mandarin male voice for commentary.", "gender": "male", "language": "zh", "langCode": "z", "repoId": MANDARIN_REPO_ID},
    {"id": "zm_010", "name": "Male 010", "label": "男声 010", "description": "Balanced Mandarin male narration.", "gender": "male", "language": "zh", "langCode": "z", "repoId": MANDARIN_REPO_ID},
    {"id": "zm_011", "name": "Male 011", "label": "男声 011", "description": "Deeper Mandarin male voice for explainers.", "gender": "male", "language": "zh", "langCode": "z", "repoId": MANDARIN_REPO_ID},
    {"id": "zm_012", "name": "Male 012", "label": "男声 012", "description": "Mandarin male speaker.", "gender": "male", "language": "zh", "langCode": "z", "repoId": MANDARIN_REPO_ID},
    {"id": "zf_001", "name": "Female 001", "label": "女声 001", "description": "Bright Mandarin female voice.", "gender": "female", "language": "zh", "langCode": "z", "repoId": MANDARIN_REPO_ID},
    {"id": "zf_002", "name": "Female 002", "label": "女声 002", "description": "Mandarin female speaker.", "gender": "female", "language": "zh", "langCode": "z", "repoId": MANDARIN_REPO_ID},
    {"id": "zf_003", "name": "Female 003", "label": "女声 003", "description": "Mandarin female speaker.", "gender": "female", "language": "zh", "langCode": "z", "repoId": MANDARIN_REPO_ID},
    {"id": "zf_004", "name": "Female 004", "label": "女声 004", "description": "Mandarin female speaker.", "gender": "female", "language": "zh", "langCode": "z", "repoId": MANDARIN_REPO_ID},
    {"id": "af_heart", "name": "Heart", "label": "Heart", "description": "Warm American English female voice.", "gender": "female", "language": "en-US", "langCode": "a", "repoId": ENGLISH_REPO_ID},
    {"id": "af_bella", "name": "Bella", "label": "Bella", "description": "Expressive American English female voice.", "gender": "female", "language": "en-US", "langCode": "a", "repoId": ENGLISH_REPO_ID},
    {"id": "am_michael", "name": "Michael", "label": "Michael", "description": "Balanced American English male narration.", "gender": "male", "language": "en-US", "langCode": "a", "repoId": ENGLISH_REPO_ID},
    {"id": "am_fenrir", "name": "Fenrir", "label": "Fenrir", "description": "Energetic American English male voice.", "gender": "male", "language": "en-US", "langCode": "a", "repoId": ENGLISH_REPO_ID},
    {"id": "bf_emma", "name": "Emma", "label": "Emma", "description": "Natural British English female voice.", "gender": "female", "language": "en-GB", "langCode": "b", "repoId": ENGLISH_REPO_ID},
    {"id": "bm_george", "name": "George", "label": "George", "description": "Natural British English male narration.", "gender": "male", "language": "en-GB", "langCode": "b", "repoId": ENGLISH_REPO_ID},
]

VOICE_BY_ID = {voice["id"]: voice for voice in VOICES}
VOICE_IDS = set(VOICE_BY_ID)
DEFAULT_VOICE = "zm_010"


def voice_config(voice: str) -> dict:
    try:
        return VOICE_BY_ID[voice]
    except KeyError as exc:
        raise ValueError(f"Unknown voice: {voice}") from exc


def language_for_voice(voice: str) -> str:
    return str(voice_config(voice)["language"])


def lang_code_for_voice(voice: str) -> str:
    return str(voice_config(voice)["langCode"])


def repo_for_voice(voice: str) -> str:
    return str(voice_config(voice)["repoId"])
