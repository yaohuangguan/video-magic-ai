from __future__ import annotations

import unittest
from unittest.mock import patch

from videomagic_engine.media import scene_windows
from videomagic_engine.tts import split_script
from videomagic_engine.vision import plan_edit
from videomagic_engine.voices import lang_code_for_voice, repo_for_voice


class LocalAiEditorTests(unittest.TestCase):
    def test_scene_windows_cover_video_without_gaps(self) -> None:
        scenes = scene_windows(14.0, target_chunk_seconds=6.0)
        self.assertEqual(len(scenes), 3)
        self.assertEqual(scenes[0]["id"], "scene-001")
        self.assertAlmostEqual(float(scenes[0]["start"]), 0.0, places=3)
        self.assertAlmostEqual(float(scenes[-1]["end"]), 14.0, places=3)
        for left, right in zip(scenes, scenes[1:]):
            self.assertAlmostEqual(float(left["end"]), float(right["start"]), places=3)

    def test_plan_edit_only_accepts_real_scene_ids(self) -> None:
        scenes = [
            {"id": "scene-001", "start": 0.0, "end": 5.0, "description": "A person enters."},
            {"id": "scene-002", "start": 5.0, "end": 10.0, "description": "The person reacts."},
        ]
        fake = {
            "text": '{"sceneIds":["scene-999","scene-002"],"summary":"Keep reaction","title":"Reaction"}',
            "model": "test-model",
            "device": "cpu",
        }
        with patch("videomagic_engine.vision._run", return_value=fake):
            result = plan_edit(scenes, "Keep only the reaction.", "fast")

        self.assertEqual(result["sceneIds"], ["scene-002"])
        self.assertEqual(result["segments"][0]["start"], 5.0)
        self.assertEqual(result["title"], "Reaction")

    def test_english_script_splits_on_sentence_punctuation(self) -> None:
        self.assertEqual(
            split_script("This starts quietly. Then everything changes! Final beat?"),
            ["This starts quietly.", "Then everything changes!", "Final beat?"],
        )

    def test_voice_routes_to_language_specific_kokoro_model(self) -> None:
        self.assertEqual(lang_code_for_voice("am_michael"), "a")
        self.assertIn("Kokoro-82M", repo_for_voice("am_michael"))
        self.assertEqual(lang_code_for_voice("zm_010"), "z")
        self.assertIn("v1.1-zh", repo_for_voice("zm_010"))


if __name__ == "__main__":
    unittest.main()
