from __future__ import annotations

VOICES = [
    {"id": "zm_009", "name": "Male 009", "label": "男声 009", "description": "Kokoro Mandarin male speaker.", "gender": "male"},
    {"id": "zm_010", "name": "Male 010", "label": "男声 010", "description": "Official Kokoro Mandarin male sample voice.", "gender": "male"},
    {"id": "zm_011", "name": "Male 011", "label": "男声 011", "description": "Kokoro Mandarin male speaker.", "gender": "male"},
    {"id": "zm_012", "name": "Male 012", "label": "男声 012", "description": "Kokoro Mandarin male speaker.", "gender": "male"},
    {"id": "zf_001", "name": "Female 001", "label": "女声 001", "description": "Official Kokoro Mandarin female sample voice.", "gender": "female"},
    {"id": "zf_002", "name": "Female 002", "label": "女声 002", "description": "Kokoro Mandarin female speaker.", "gender": "female"},
    {"id": "zf_003", "name": "Female 003", "label": "女声 003", "description": "Kokoro Mandarin female speaker.", "gender": "female"},
    {"id": "zf_004", "name": "Female 004", "label": "女声 004", "description": "Kokoro Mandarin female speaker.", "gender": "female"},
]

VOICE_IDS = {voice["id"] for voice in VOICES}
DEFAULT_VOICE = "zm_010"
