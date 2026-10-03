from __future__ import annotations

CHINESE_REPO_ID = "hexgrad/Kokoro-82M-v1.1-zh"
BASE_REPO_ID = "hexgrad/Kokoro-82M"

VOICES = [
    {
        "id": "zm_009",
        "name": "Punchy Male",
        "label": "男声 009",
        "description": "Sharper Mandarin delivery for commentary and short-form clips.",
        "gender": "male",
        "language": "zh",
        "languageName": "Mandarin",
        "langCode": "z",
        "repoId": CHINESE_REPO_ID,
    },
    {
        "id": "zm_010",
        "name": "Story Male",
        "label": "男声 010",
        "description": "Balanced Mandarin narration for stories and explainers.",
        "gender": "male",
        "language": "zh",
        "languageName": "Mandarin",
        "langCode": "z",
        "repoId": CHINESE_REPO_ID,
    },
    {
        "id": "zm_011",
        "name": "Deep Male",
        "label": "男声 011",
        "description": "Steadier Mandarin voice for documentary-style narration.",
        "gender": "male",
        "language": "zh",
        "languageName": "Mandarin",
        "langCode": "z",
        "repoId": CHINESE_REPO_ID,
    },
    {
        "id": "zf_001",
        "name": "Bright Female",
        "label": "女声 001",
        "description": "Clear Mandarin female voice for lifestyle and social clips.",
        "gender": "female",
        "language": "zh",
        "languageName": "Mandarin",
        "langCode": "z",
        "repoId": CHINESE_REPO_ID,
    },
    {
        "id": "af_heart",
        "name": "Heart",
        "label": "Heart",
        "description": "Warm American English voice for natural narration.",
        "gender": "female",
        "language": "en-US",
        "languageName": "English (US)",
        "langCode": "a",
        "repoId": BASE_REPO_ID,
    },
    {
        "id": "af_bella",
        "name": "Bella",
        "label": "Bella",
        "description": "Expressive American English female voice for creator content.",
        "gender": "female",
        "language": "en-US",
        "languageName": "English (US)",
        "langCode": "a",
        "repoId": BASE_REPO_ID,
    },
    {
        "id": "am_michael",
        "name": "Michael",
        "label": "Michael",
        "description": "Clean American English male narration.",
        "gender": "male",
        "language": "en-US",
        "languageName": "English (US)",
        "langCode": "a",
        "repoId": BASE_REPO_ID,
    },
    {
        "id": "am_puck",
        "name": "Puck",
        "label": "Puck",
        "description": "More energetic American English delivery for short-form videos.",
        "gender": "male",
        "language": "en-US",
        "languageName": "English (US)",
        "langCode": "a",
        "repoId": BASE_REPO_ID,
    },
    {
        "id": "bf_emma",
        "name": "Emma",
        "label": "Emma",
        "description": "Warm British English female narration.",
        "gender": "female",
        "language": "en-GB",
        "languageName": "English (UK)",
        "langCode": "b",
        "repoId": BASE_REPO_ID,
    },
    {
        "id": "bm_george",
        "name": "George",
        "label": "George",
        "description": "Classic British English male narration.",
        "gender": "male",
        "language": "en-GB",
        "languageName": "English (UK)",
        "langCode": "b",
        "repoId": BASE_REPO_ID,
    },
]

VOICE_BY_ID = {voice["id"]: voice for voice in VOICES}
VOICE_IDS = set(VOICE_BY_ID)
DEFAULT_VOICE = "zm_010"


def voice_metadata(voice_id: str) -> dict[str, str]:
    try:
        return VOICE_BY_ID[voice_id]
    except KeyError as exc:
        raise ValueError(f"Unknown voice: {voice_id}") from exc


def voice_lang_code(voice_id: str) -> str:
    return voice_metadata(voice_id)["langCode"]


def voice_repo_id(voice_id: str) -> str:
    return voice_metadata(voice_id)["repoId"]


def voice_language(voice_id: str) -> str:
    return voice_metadata(voice_id)["language"]
