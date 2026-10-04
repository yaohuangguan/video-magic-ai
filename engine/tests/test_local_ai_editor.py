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

    def test_auto_model_prefers_fast_on_8gb_class_gpu(self) -> None:
        with (
            patch("videomagic_engine.vision._device", return_value="cuda"),
            patch("videomagic_engine.vision._free_gpu_gb", return_value=6.95),
        ):
            from videomagic_engine.vision import FAST_MODEL, QUALITY_MODEL, select_model

            self.assertEqual(select_model("auto"), FAST_MODEL)
            self.assertEqual(select_model("fast"), FAST_MODEL)
            self.assertEqual(select_model("quality"), QUALITY_MODEL)

    def test_duration_budget_prunes_greedy_model_selection(self) -> None:
        scenes = [
            {
                "id": f"scene-{index + 1:03d}",
                "start": float(index * 4),
                "end": float((index + 1) * 4),
                "description": f"Scene {index + 1}",
                "motionScore": score,
            }
            for index, score in enumerate([0.1, 0.95, 0.2, 0.85, 0.3, 0.75])
        ]
        fake = {
            "text": '{"sceneIds":["scene-001","scene-002","scene-003","scene-004","scene-005","scene-006"],"summary":"Fast highlight","title":"Best moments"}',
            "model": "test-model",
            "device": "cpu",
        }

        with patch("videomagic_engine.vision._run", return_value=fake):
            result = plan_edit(scenes, "Make a 15 second fast highlight.", "fast")

        self.assertLessEqual(result["estimatedDurationSeconds"], 17.25)
        self.assertGreaterEqual(result["estimatedDurationSeconds"], 8.0)
        self.assertIn("scene-002", result["sceneIds"])
        self.assertIn("scene-004", result["sceneIds"])
        self.assertEqual(result["targetDurationSeconds"], 15.0)

    def test_under_selected_plan_is_supplemented_to_duration_budget(self) -> None:
        scenes = [
            {
                "id": f"scene-{index + 1:03d}",
                "start": float(index * 4),
                "end": float((index + 1) * 4),
                "description": f"Scene {index + 1}",
                "motionScore": score,
            }
            for index, score in enumerate([0.3, 0.4, 1.0, 0.9, 0.8, 0.1])
        ]
        fake = {
            "text": '{"sceneIds":["scene-001","scene-002"],"summary":"Two semantic picks","title":"Highlight"}',
            "model": "test-model",
            "device": "cpu",
        }

        with patch("videomagic_engine.vision._run", return_value=fake):
            result = plan_edit(scenes, "Make a 15 second highlight.", "fast")

        self.assertGreaterEqual(result["estimatedDurationSeconds"], 12.0)
        self.assertLessEqual(result["estimatedDurationSeconds"], 17.25)
        self.assertGreater(len(result["sceneIds"]), 2)
        self.assertIn("scene-003", result["sceneIds"])

    def test_invalid_small_planner_output_uses_motion_fallback(self) -> None:
        scenes = [
            {
                "id": f"scene-{index + 1:03d}",
                "start": float(index * 4),
                "end": float((index + 1) * 4),
                "description": f"Scene {index + 1}",
                "motionScore": score,
            }
            for index, score in enumerate([0.05, 0.9, 0.1, 1.0, 0.2])
        ]
        fake = {
            "text": "我建议保留最有动作的几个镜头，但这里没有按 JSON 输出。",
            "model": "test-model",
            "device": "cpu",
        }

        with patch("videomagic_engine.vision._run", return_value=fake):
            result = plan_edit(
                scenes,
                "只保留最有动作和反应的部分，剪成15秒左右的快节奏高光。",
                "fast",
            )

        self.assertTrue(result["plannerFallback"])
        self.assertIn("scene-004", result["sceneIds"])
        self.assertIn("scene-002", result["sceneIds"])
        self.assertLessEqual(result["estimatedDurationSeconds"], 17.25)

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
