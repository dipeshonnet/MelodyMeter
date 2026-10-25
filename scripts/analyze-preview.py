"""Partial measurements or explicitly low-confidence full-recording estimates.

Input is an AAC/MP3 stream on stdin. No preview audio is saved to disk.
The foreground separation is approximate: instruments can remain in it.
"""
import sys
import os
from pathlib import Path
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('NUMBA_NUM_THREADS', '2')

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'artifacts/audio-python'))
import json
import subprocess
import numpy as np
import librosa
import imageio_ffmpeg

SR, HOP = 8000, 256


def analyze(data, full_recording=False, complete=False, neural=False):
    file_input = isinstance(data, Path)
    decoded = subprocess.run([
        imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-i', str(data) if file_input else 'pipe:0',
        '-t', '900' if full_recording else '95', '-f', 'f32le', '-ac', '1', '-ar', str(SR), 'pipe:1',
    ], input=None if file_input else data, capture_output=True, timeout=45, check=True)
    y = np.frombuffer(decoded.stdout, dtype='<f4').copy()
    duration = len(y) / SR
    if duration < 15 or not np.isfinite(y).all() or np.max(np.abs(y)) < 0.001:
        return {'status': 'insufficient_audio', 'durationSeconds': duration}
    if neural:
        from importlib.util import spec_from_file_location, module_from_spec
        spec = spec_from_file_location('vocal_separator', Path(__file__).with_name('separate-vocals.py'))
        separator = module_from_spec(spec)
        spec.loader.exec_module(separator)
        y, foreground, model = separator.separate(data)
    else:
        foreground = separate_foreground(y, full_recording)
    energy_fraction = float(np.sum(foreground ** 2) / max(np.sum(y ** 2), 1e-12))
    return analyze_pitch(y, foreground, duration, energy_fraction, full_recording, complete,
                         model if neural else None)


def separate_foreground(y, full_recording):
    spectrum = librosa.stft(y, n_fft=1024, hop_length=HOP)
    magnitude, phase = librosa.magphase(spectrum)
    # REPET-SIM nearest neighbours in NumPy: avoid optional sklearn DLLs.
    exclusion = int(2 * SR / HOP)
    background = np.empty_like(magnitude)
    window = int(30 * SR / HOP) if full_recording else magnitude.shape[1]
    for start in range(0, magnitude.shape[1], window):
        local = magnitude[:, start:start + window]
        if local.shape[1] < 2 * exclusion + 20:
            background[:, start:start + window] = local
            continue
        normalized = local / np.maximum(np.linalg.norm(local, axis=0), 1e-12)
        similarity = normalized.T @ normalized
        for frame in range(similarity.shape[0]):
            similarity[frame, max(0, frame - exclusion):frame + exclusion + 1] = -np.inf
        neighbours = np.argpartition(similarity, -20, axis=1)[:, -20:]
        for frame in range(local.shape[1]):
            background[:, start + frame] = np.median(local[:, neighbours[frame]], axis=1)
    background = np.minimum(magnitude, background)
    mask = librosa.util.softmask(magnitude - background, 4 * background, power=2)
    foreground = librosa.istft(mask * magnitude * phase, hop_length=HOP, length=len(y))
    return foreground


def analyze_pitch(y, foreground, duration, energy_fraction, full_recording, complete, model=None):
    f0, voiced, probability = librosa.pyin(
        foreground, sr=SR, fmin=65, fmax=1000, frame_length=1024, hop_length=HOP,
        resolution=0.25 if complete else 0.1)
    rms = librosa.feature.rms(y=foreground, frame_length=1024, hop_length=HOP)[0]
    valid = voiced & (probability >= 0.75) & (rms > max(np.max(rms) * 0.08, 0.0001))
    coverage = float(np.mean(valid))
    evidence = {
        'durationSeconds': round(duration, 2),
        'confidentPitchSeconds': round(float(np.sum(valid) * HOP / SR), 2),
        'confidentPitchFraction': round(coverage, 3),
        'trackedPitchSeconds': round(float(np.sum(voiced) * HOP / SR), 2),
        'trackedPitchProbabilityMedian': round(float(np.median(probability[voiced])), 3) if np.any(voiced) else 0,
        'foregroundEnergyFraction': round(energy_fraction, 3),
        'method': 'MDX neural vocal separation followed by pYIN; lead singer unverified' if model else 'REPET-SIM foreground approximation followed by pYIN; not verified lead vocals',
        **({'separationModel': model} if model else {}),
        **({'pitchResolutionSemitones': .25} if complete else {}),
    }
    estimate_valid = voiced & (probability >= 0.35) & (rms > max(np.max(rms) * 0.08, 0.0001)) if complete else valid
    if (np.sum(valid) * HOP / SR < 2 and not complete) or energy_fraction < 0.015 or np.sum(estimate_valid) * HOP / SR < 2:
        return {'status': 'insufficient_pitch_evidence', 'evidence': evidence}
    midi = librosa.hz_to_midi(f0[estimate_valid])
    span = float(np.percentile(midi, 95) - np.percentile(midi, 5))
    notes = np.full(len(f0), np.nan)
    notes[valid] = np.round(librosa.hz_to_midi(f0[valid]))
    # Only contiguous confident frames count; never jump across an unvoiced gap.
    steps = np.abs(np.diff(notes))
    transitions = steps[np.isfinite(steps) & (steps >= 1)]
    leaps = float(np.percentile(transitions, 90)) if len(transitions) else 0.0
    longest = current = 0
    for i in range(len(notes)):
        if np.isfinite(notes[i]):
            current = current + 1 if i and notes[i] == notes[i - 1] else 1
            longest = max(longest, current)
        else:
            current = 0
    held = longest * HOP / SR
    def ease(value, thresholds):
        return [9, 8, 6, 4, 2][sum(value > t for t in thresholds)]
    # A partial excerpt can describe sampled pitch span without claiming that
    # the whole lead range has been captured. Other proxies need their own
    # evidence; absent observations must not be treated as easy singing.
    factors = {'range': ease(span, [7, 12, 17, 24])}
    if held >= 1.5:
        factors['sustain'] = ease(held, [1.5, 3, 5, 8])
    evidence.update({'pitchSpanP5P95Semitones': round(span, 2),
                     'adjacentPitchStepP90Semitones': round(leaps, 2),
                     'longestStablePitchSeconds': round(held, 2)})
    if full_recording and complete:
        from importlib.util import spec_from_file_location, module_from_spec
        spec = spec_from_file_location('estimate_features', Path(__file__).with_name('audio-estimate-features.py'))
        features = module_from_spec(spec)
        spec.loader.exec_module(features)
        evidence.update({'estimatePitchSeconds': round(float(np.sum(estimate_valid) * HOP / SR), 2), 'estimatePitchProbabilityThreshold': .35})
        estimated = features.complete_estimate(y, foreground, f0, voiced, probability, estimate_valid, SR, HOP, evidence)
        if estimated:
            return estimated
    return {'status': 'partial_excerpt_only',
            'observedFactorProxies': factors, 'evidence': evidence,
            'unassessedFactors': [f for f in ['pace', 'range', 'jumps', 'sustain', 'breath', 'rhythm', 'runs', 'stamina', 'changes'] if f not in factors],
            'limitations': ['Unvalidated heuristic thresholds; requires listening review.',
                           'Foreground can include instruments, backing vocals, and octave errors.',
                           'Pitch proxies alone do not establish a complete nine-factor singing rating.']}


if __name__ == '__main__':
    try:
        data = Path(sys.argv[sys.argv.index('--file') + 1]) if '--file' in sys.argv else sys.stdin.buffer.read()
        print(json.dumps(analyze(data, '--full-recording' in sys.argv, '--complete-estimates' in sys.argv, '--neural-vocals' in sys.argv), allow_nan=False))
    except Exception as error:
        print(json.dumps({'status': 'analysis_failed', 'error': str(error)[:300]}))
        sys.exit(1)
