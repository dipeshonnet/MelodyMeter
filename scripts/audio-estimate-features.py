"""Nine explicitly provisional acoustic proxies, not a listening assessment.

Pitch events are foreground events, not verified notes of the lead singer.
No lexical/syllable analysis is performed. Do not call these validated vocals.
"""
import numpy as np
from scipy.ndimage import median_filter, binary_closing
import librosa

IDS = ['pace', 'range', 'jumps', 'sustain', 'breath', 'rhythm', 'runs', 'stamina', 'changes']


def complete_estimate(y, foreground, f0, voiced, probability, valid, sr, hop, evidence):
    dt = hop / sr
    seconds = float(np.sum(valid) * dt)
    if seconds < 10 or seconds / evidence['durationSeconds'] < .03:
        return None  # Missing pitch evidence must not become an easy score.
    midi = np.full(len(f0), np.nan)
    midi[valid] = librosa.hz_to_midi(f0[valid])
    # Median filtering removes single-frame fluctuations; never fill an unknown pitch.
    filtered = median_filter(np.nan_to_num(midi, nan=-999), size=5)
    notes = np.where(valid & (filtered > 0), np.round(filtered), np.nan)
    events = []
    start = 0
    for end in range(1, len(notes) + 1):
        if end == len(notes) or not (np.isfinite(notes[start]) and notes[end] == notes[start]):
            if np.isfinite(notes[start]) and (end - start) * dt >= .096:
                events.append((start * dt, end * dt, float(notes[start])))
            start = end
    if len(events) < 20:
        return None
    connected = [(a, b) for a, b in zip(events, events[1:]) if b[0] - a[1] <= .16]
    if len(connected) < 10:
        return None
    jumps = [abs(b[2] - a[2]) for a, b in connected if b[2] != a[2]]
    if len(jumps) < 10:
        return None
    rms = librosa.feature.rms(y=foreground, frame_length=1024, hop_length=hop)[0]
    if len(rms) < len(valid):
        return None
    rms = rms[:len(valid)]
    activity = voiced & (probability >= .5) & (rms > max(float(np.max(rms)) * .08, .0001))
    # Brief detector gaps are not breathing opportunities.
    activity = binary_closing(activity, structure=np.ones(max(1, round(.35 / dt))))
    edges = np.diff(np.r_[False, activity, False].astype(int))
    starts, ends = np.where(edges == 1)[0], np.where(edges == -1)[0]
    phrases = (ends - starts) * dt
    phrases = phrases[phrases >= .5]
    if len(phrases) < 5:
        return None
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop, units='time')
    if len(beats) < 16:
        return None
    beat_seconds = float(np.median(np.diff(beats)))
    # Note entrances away from the quarter/eighth grid are a timing proxy only.
    event_starts = np.array([e[0] for e in events])
    distances = np.abs((event_starts - beats[0] + beat_seconds / 4) % (beat_seconds / 2) - beat_seconds / 4)
    off_grid = float(np.mean(distances > beat_seconds * .12))
    rates, blocks = [], []
    for t in np.arange(0, evidence['durationSeconds'], 10):
        coverage = np.sum(valid[int(t / dt):int((t + 10) / dt)]) * dt
        if coverage >= 2:
            rates.append(float(np.sum((event_starts >= t) & (event_starts < t + 10))) / coverage)
    for t in np.arange(0, evidence['durationSeconds'], 30):
        values = midi[int(t / dt):int((t + 30) / dt)]
        values = values[np.isfinite(values)]
        if len(values) * dt >= 2:
            blocks.append((t, float(np.median(values)), float(np.percentile(values, 95) - np.percentile(values, 5))))
    if len(rates) < 3 or len(blocks) < 3:
        return None
    changes = sum(abs(b[1] - a[1]) >= 3 or abs(b[2] - a[2]) >= 5
                  for a, b in zip(blocks, blocks[1:]) if b[0] - a[0] <= 30.01)
    comparisons = sum(b[0] - a[0] <= 30.01 for a, b in zip(blocks, blocks[1:]))
    if comparisons < 2:
        return None
    # Count distinct rapid directional passages, rather than overlapping triples
    # or alternating vibrato fluctuations. Syllable identity remains unknown.
    clusters, run_steps, direction = 0, 0, 0
    for a, b in zip(events, events[1:]):
        step = b[2] - a[2]
        fast = b[0] - a[1] <= .16 and b[0] - a[0] <= .25 and 0 < abs(step) <= 4
        sign = np.sign(step)
        if fast and (not direction or direction == sign):
            run_steps += 1
            direction = sign
        else:
            clusters += int(run_steps >= 3)
            run_steps, direction = (1, sign) if fast else (0, 0)
    clusters += int(run_steps >= 3)
    measured = {
        'pace': round(float(np.percentile(rates, 90)), 3),
        'range': evidence['pitchSpanP5P95Semitones'],
        'jumps': round(float(np.percentile(jumps, 90)), 3),
        'sustain': round(max(e[1] - e[0] for e in events), 3),
        'breath': round(float(np.percentile(phrases, 90)), 3),
        'rhythm': round(off_grid, 3),
        'runs': round(clusters / (seconds / 60), 3),
        'stamina': round(float(np.sum(activity) * dt / 60), 3),
        'changes': round(changes / comparisons, 3),
    }
    thresholds = {'pace': [1, 2, 3, 4], 'range': [7, 12, 17, 24], 'jumps': [2, 4, 7, 10],
                  'sustain': [1.5, 3, 5, 8], 'breath': [3, 5, 8, 12], 'rhythm': [.15, .3, .45, .6],
                  'runs': [1, 3, 8, 15], 'stamina': [1, 2, 3, 4], 'changes': [.15, .3, .5, .75]}
    factors = {k: [9, 8, 6, 4, 2][sum(measured[k] > t for t in thresholds[k])] for k in IDS}
    reasons = {
        'pace': f"Foreground pitch-event rate reached {measured['pace']}/second in supported windows; this estimates note speed, not words or syllables.",
        'range': f"The low-confidence foreground pitch span was {measured['range']} semitones (5th–95th percentiles). Instruments and octave errors can widen it.",
        'jumps': f"The 90th-percentile connected foreground pitch change was {measured['jumps']} semitones. Changes across uncertain gaps are excluded.",
        'sustain': f"The longest smoothed low-confidence foreground pitch event lasted {measured['sustain']} seconds; its singer identity is unverified.",
        'breath': f"The 90th-percentile detected foreground phrase lasted {measured['breath']} seconds. Detector gaps were bridged; this does not measure actual breaths.",
        'rhythm': f"{round(measured['rhythm'] * 100)}% of pitch-event entrances fell away from an estimated eighth-note grid ({round(60 / beat_seconds)} BPM). Beat alignment is uncertain.",
        'runs': f"Rapid small-step pitch clusters occurred at {measured['runs']}/tracked minute. No syllables were analyzed, so melismatic runs are not verified.",
        'stamina': f"Detected foreground pitch activity totalled {measured['stamina']} minutes. This is an activity-load proxy, not physiological effort.",
        'changes': f"{changes} of {comparisons} supported adjacent 30-second blocks changed pitch centre or spread substantially; song-section labels were not verified.",
    }
    return {'status': 'complete_audio_estimate', 'observedFactorProxies': factors, 'reasons': reasons,
            'confidence': {k: 'low' for k in IDS},
            'evidence': {**evidence, 'proxyMeasurements': measured, 'pitchEventCount': len(events),
                         'phraseCount': int(len(phrases)), 'supportedBlockCount': len(blocks),
                         'beatCount': int(len(beats)), 'estimatedBpm': round(60 / beat_seconds, 2)},
            'limitations': ['Unvalidated heuristic difficulty bands; not listening-reviewed.',
                           'Foreground separation does not identify the lead singer; instruments, backing vocals and octave errors can affect every score.',
                           'Pitch-event estimates use a lower pYIN probability threshold (0.35) than confident pitch reporting (0.75). Words, syllables, actual breaths and physiological effort are not measured. All nine factors have low confidence.']}
