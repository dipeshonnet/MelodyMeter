import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'artifacts/audio-python'))
import numpy as np
import librosa
spec = importlib.util.spec_from_file_location('features', Path(__file__).resolve().parents[1] / 'scripts/audio-estimate-features.py')
features = importlib.util.module_from_spec(spec)
spec.loader.exec_module(features)


class FeatureTests(unittest.TestCase):
    def test_missing_evidence_cannot_produce_complete_easy_scores(self):
        frames = 100
        self.assertIsNone(features.complete_estimate(np.zeros(8000), np.zeros(8000), np.ones(frames) * 220,
            np.ones(frames, bool), np.ones(frames), np.ones(frames, bool), 8000, 256,
            {'durationSeconds': 120, 'pitchSpanP5P95Semitones': 12}))

    def test_all_scores_have_finite_observations_and_low_confidence(self):
        dt, duration = .032, 120
        times = np.arange(int(duration / dt)) * dt
        valid = times % 5 < 4
        midi = 60 + np.floor((times % 1) / .2) % 4
        f0 = librosa.midi_to_hz(midi)
        foreground = np.sin(np.arange(8000 * duration) * 2 * np.pi * 220 / 8000).astype(np.float32)
        evidence = {'durationSeconds': duration, 'pitchSpanP5P95Semitones': 3, 'confidentPitchSeconds': float(valid.sum() * dt)}
        with patch.object(librosa.onset, 'onset_strength', return_value=np.ones(len(times))), \
                patch.object(librosa.beat, 'beat_track', return_value=(np.array([120]), np.arange(0, duration, .5))):
            result = features.complete_estimate(foreground, foreground, f0, valid, np.ones(len(times)), valid, 8000, 256, evidence)
        self.assertIsNotNone(result)
        self.assertEqual(set(result['observedFactorProxies']), set(features.IDS))
        self.assertTrue(all(np.isfinite(v) and v >= 0 for v in result['evidence']['proxyMeasurements'].values()))
        self.assertTrue(all(v == 'low' for v in result['confidence'].values()))
        self.assertEqual(result['observedFactorProxies']['range'], 9)
        self.assertGreater(result['evidence']['phraseCount'], 5)


if __name__ == '__main__':
    unittest.main()
