from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

from videomagic_engine.director import normalize_edit_plan
from videomagic_engine.subtitles import write_srt
from videomagic_engine.tts import (
    SAMPLE_RATE,
    plan_timeline,
    split_script,
    synthesize,
    synthesize_timed,
    synthesize_timeline,
)


class TimingTests(unittest.TestCase):
    def test_split_script_uses_chinese_sentence_boundaries(self) -> None:
        text = "第一句。第二句！第三句？最后一句"
        self.assertEqual(
            split_script(text),
            ["第一句。", "第二句！", "第三句？", "最后一句"],
        )

    def test_split_script_uses_english_sentence_boundaries(self) -> None:
        text = "First sentence. Second sentence! Is this third? Final line."
        self.assertEqual(
            split_script(text, "en-US"),
            [
                "First sentence.",
                "Second sentence!",
                "Is this third?",
                "Final line.",
            ],
        )

    def test_english_timeline_uses_selected_voice_language(self) -> None:
        result = plan_timeline(
            "Start with the reveal. Then show the reaction! Finish on the punchline.",
            12.0,
            voice="af_heart",
        )
        self.assertEqual(len(result["timeline"]), 3)
        self.assertEqual(result["timeline"][0]["text"], "Start with the reveal.")

    def test_auto_timing_spreads_sentences_across_target_duration(self) -> None:
        def fake_segment(_pipeline, text: str, voice: str, speed: float) -> np.ndarray:
            base_seconds = 1.6 if "第一" in text else 1.2
            samples = int(SAMPLE_RATE * base_seconds / speed)
            return np.ones(samples, dtype=np.float32) * 0.02

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "timed.wav"
            with (
                patch("videomagic_engine.tts.get_pipeline", return_value=(object(), "cpu")),
                patch("videomagic_engine.tts._generate_segment", side_effect=fake_segment),
            ):
                result = synthesize_timed(
                    text="第一句。第二句。",
                    output_path=output,
                    target_duration=5.0,
                    voice="zm_010",
                    speed=1.0,
                )

            self.assertTrue(output.exists())
            self.assertTrue(result["autoTiming"])
            self.assertAlmostEqual(result["durationSeconds"], 5.0, places=2)
            self.assertEqual(len(result["timeline"]), 2)
            self.assertGreater(result["timeline"][0]["start"], 0)
            self.assertGreater(
                result["timeline"][1]["start"],
                result["timeline"][0]["end"],
            )

    def test_auto_mode_falls_back_to_cpu_when_cuda_generation_fails(self) -> None:
        gpu_pipeline = object()
        cpu_pipeline = object()
        fallback_audio = np.ones(int(SAMPLE_RATE * 0.5), dtype=np.float32) * 0.02

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "fallback.wav"
            with (
                patch.dict("os.environ", {"VIDEOMAGIC_TTS_DEVICE": ""}, clear=False),
                patch("videomagic_engine.tts.get_pipeline", return_value=(gpu_pipeline, "cuda")),
                patch("videomagic_engine.tts._load_pipeline", return_value=(cpu_pipeline, "cpu")) as load_pipeline,
                patch(
                    "videomagic_engine.tts._generate_segment",
                    side_effect=[RuntimeError("CUDA out of memory"), fallback_audio],
                ),
            ):
                result = synthesize(
                    text="自动降级测试。",
                    output_path=output,
                    voice="zm_010",
                    speed=1.0,
                )

            self.assertTrue(output.exists())
            self.assertEqual(result["device"], "cpu")
            load_pipeline.assert_called_once_with("cpu", "zm_010")

    def test_plan_timeline_builds_non_overlapping_draft(self) -> None:
        result = plan_timeline(
            "第一句比较短。第二句明显更长一点，需要更多时间。第三句。",
            12.0,
        )
        timeline = result["timeline"]

        self.assertEqual(len(timeline), 3)
        self.assertTrue(result["draft"])
        self.assertGreater(timeline[0]["start"], 0)
        self.assertLessEqual(timeline[-1]["end"], 12.0)
        self.assertGreater(timeline[1]["start"], timeline[0]["end"])
        self.assertGreater(
            timeline[1]["end"] - timeline[1]["start"],
            timeline[0]["end"] - timeline[0]["start"],
        )

    def test_custom_timeline_places_audio_at_requested_start(self) -> None:
        fake_audio = np.ones(int(SAMPLE_RATE * 0.7), dtype=np.float32) * 0.02
        timeline = [
            {"id": "a", "text": "第一句。", "start": 1.0, "end": 2.0},
            {"id": "b", "text": "第二句。", "start": 3.0, "end": 4.0},
        ]

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "custom.wav"
            with (
                patch("videomagic_engine.tts.get_pipeline", return_value=(object(), "cpu")),
                patch("videomagic_engine.tts._generate_segment", return_value=fake_audio),
            ):
                result = synthesize_timeline(
                    segments=timeline,
                    output_path=output,
                    target_duration=5.0,
                    voice="zm_010",
                    speed=1.0,
                )

            audio, sample_rate = __import__("soundfile").read(output)

        self.assertEqual(sample_rate, SAMPLE_RATE)
        self.assertAlmostEqual(len(audio) / SAMPLE_RATE, 5.0, places=2)
        self.assertAlmostEqual(result["timeline"][0]["start"], 1.0, places=2)
        self.assertAlmostEqual(result["timeline"][1]["start"], 3.0, places=2)
        self.assertTrue(result["customTimeline"])

    def test_custom_timeline_rejects_overlap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "cannot overlap"):
                synthesize_timeline(
                    segments=[
                        {"text": "第一句。", "start": 0.5, "end": 2.0},
                        {"text": "第二句。", "start": 1.5, "end": 3.0},
                    ],
                    output_path=Path(directory) / "bad.wav",
                    target_duration=4.0,
                    voice="zm_010",
                    speed=1.0,
                )

    def test_auto_timing_can_raise_effective_speed(self) -> None:
        def fake_segment(_pipeline, _text: str, voice: str, speed: float) -> np.ndarray:
            samples = int(SAMPLE_RATE * 2.4 / speed)
            return np.ones(samples, dtype=np.float32) * 0.02

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "fit.wav"
            with (
                patch("videomagic_engine.tts.get_pipeline", return_value=(object(), "cpu")),
                patch("videomagic_engine.tts._generate_segment", side_effect=fake_segment),
            ):
                result = synthesize_timed(
                    text="第一句。第二句。",
                    output_path=output,
                    target_duration=4.0,
                    voice="zm_010",
                    speed=1.0,
                )

            self.assertGreater(result["speed"], 1.0)
            self.assertLessEqual(result["speed"], 1.6)
            self.assertAlmostEqual(result["durationSeconds"], 4.0, places=2)


class DirectorPlanTests(unittest.TestCase):
    def test_normalize_edit_plan_clamps_ranges_and_builds_output_timeline(self) -> None:
        result = normalize_edit_plan(
            {
                "title": "Fast cut",
                "summary": "Keep the reveal and reaction.",
                "narrationLanguage": "en",
                "clips": [
                    {
                        "sourceStart": -2,
                        "sourceEnd": 3,
                        "speed": 1.5,
                        "narration": "Watch what happens next.",
                    },
                    {
                        "sourceStart": 8,
                        "sourceEnd": 20,
                        "speed": 4,
                        "narration": "And this is the reaction.",
                    },
                ],
            },
            source_duration=10.0,
        )

        self.assertEqual(result["narrationLanguage"], "en")
        self.assertEqual(len(result["clips"]), 2)
        self.assertEqual(result["clips"][0]["sourceStart"], 0.0)
        self.assertEqual(result["clips"][1]["sourceEnd"], 10.0)
        self.assertEqual(result["clips"][1]["speed"], 2.0)
        self.assertAlmostEqual(
            result["clips"][1]["outputStart"],
            result["clips"][0]["outputEnd"],
            places=3,
        )
        self.assertGreater(result["outputDurationSeconds"], 0)

    def test_normalize_edit_plan_respects_target_duration_cap(self) -> None:
        result = normalize_edit_plan(
            {
                "title": "Thirty second cut",
                "narrationLanguage": "en",
                "clips": [
                    {"sourceStart": 0, "sourceEnd": 10, "speed": 1.0},
                    {"sourceStart": 10, "sourceEnd": 20, "speed": 1.0},
                ],
            },
            source_duration=20.0,
            target_duration=8.0,
        )

        self.assertLessEqual(result["outputDurationSeconds"], 8.01)
        self.assertAlmostEqual(
            result["clips"][1]["outputStart"],
            result["clips"][0]["outputEnd"],
            places=3,
        )

    def test_normalize_edit_plan_rejects_empty_clip_list(self) -> None:
        with self.assertRaisesRegex(ValueError, "no clips"):
            normalize_edit_plan(
                {"narrationLanguage": "zh", "clips": []},
                source_duration=10.0,
            )


class SubtitleTests(unittest.TestCase):
    def test_write_srt_uses_timeline_boundaries(self) -> None:
        timeline = [
            {"text": "第一句。", "start": 0.25, "end": 1.75},
            {"text": "第二句。", "start": 2.0, "end": 3.4},
        ]

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "captions.srt"
            result = write_srt(timeline, output)
            content = output.read_text(encoding="utf-8")

        self.assertEqual(result["entries"], 2)
        self.assertIn("00:00:00,250 --> 00:00:01,750", content)
        self.assertIn("00:00:02,000 --> 00:00:03,400", content)
        self.assertIn("第一句。", content)
        self.assertIn("第二句。", content)


if __name__ == "__main__":
    unittest.main()
