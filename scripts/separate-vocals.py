"""CPU MDX vocal inference with NumPy/librosa transforms.

Model parameters and stem identity are verified against the publisher's
hash-indexed metadata. Neural stems still contain leakage and backing voices.
"""
from pathlib import Path
import hashlib
import json
import sys
import subprocess
import os
import time
import numpy as np
import librosa
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
backend = os.environ.get('MELODYMETER_VOCAL_BACKEND', 'cpu')
sys.path.insert(0, str(ROOT / ('artifacts/audio-dml' if backend == 'dml' else 'artifacts/audio-neural')))
import onnxruntime as ort


def separate(path, max_seconds=900):
    model = ROOT / 'artifacts/audio-models/UVR-MDX-NET-Voc_FT.onnx'
    tail = 10000 * 1024
    with model.open('rb') as handle:
        handle.seek(max(0, model.stat().st_size - tail))
        identity = hashlib.md5(handle.read()).hexdigest()
    config = json.loads((model.parent / 'model-data.json').read_text())[identity]
    if config['primary_stem'] != 'Vocals':
        raise ValueError('Model must predict the vocals stem.')
    options = ort.SessionOptions()
    options.intra_op_num_threads = max(1, min(8, int(os.environ.get('MELODYMETER_VOCAL_THREADS', '2'))))
    options.inter_op_num_threads = 1
    options.enable_mem_pattern = backend != 'dml'
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    providers = ['DmlExecutionProvider', 'CPUExecutionProvider'] if backend == 'dml' else ['CPUExecutionProvider']
    session = ort.InferenceSession(str(model), sess_options=options, providers=providers)
    if backend == 'dml' and session.get_providers()[0] != 'DmlExecutionProvider':
        raise ValueError('Requested graphics backend could not activate.')
    nfft, bins, frames = config['mdx_n_fft_scale_set'], config['mdx_dim_f_set'], 2 ** config['mdx_dim_t_set']
    hop, sr = 1024, 44100
    length = hop * (frames - 1)
    trim, stride = nfft // 2, length - nfft
    decoded = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-i', str(path),
                              '-t', str(max_seconds), '-f', 'f32le', '-ac', '2', '-ar', str(sr), 'pipe:1'],
                             capture_output=True, timeout=60, check=True)
    mix = np.frombuffer(decoded.stdout, dtype='<f4').reshape(-1, 2).T.copy()
    padded = np.pad(mix, ((0, 0), (trim, length)))
    output = np.zeros_like(mix)
    for position in range(0, mix.shape[1], stride):
        samples = padded[:, position:position + length]
        spectrum = librosa.stft(samples, n_fft=nfft, hop_length=hop, window='hann', center=True, pad_mode='reflect')
        inputs = np.stack([spectrum[0].real, spectrum[0].imag, spectrum[1].real, spectrum[1].imag])[:, :bins, :].astype(np.float32)
        inputs[:, :3, :] = 0
        predicted = session.run(None, {session.get_inputs()[0].name: inputs[None]})[0][0]
        restored = np.zeros_like(spectrum)
        restored[0, :bins] = predicted[0] + 1j * predicted[1]
        restored[1, :bins] = predicted[2] + 1j * predicted[3]
        waveform = librosa.istft(restored, hop_length=hop, window='hann', center=True, length=length)
        count = min(stride, mix.shape[1] - position)
        output[:, position:position + count] = waveform[:, trim:trim + count] * config['compensate']
        if position // stride % 20 == 0:
            print(f'Vocal separation: {round(100 * (position + count) / mix.shape[1])}%', file=sys.stderr, flush=True)
    vocals = librosa.resample(output.mean(axis=0), orig_sr=sr, target_sr=8000)
    y = librosa.resample(mix.mean(axis=0), orig_sr=sr, target_sr=8000)
    return y, vocals, {'model': model.name, 'modelMetadataHash': identity, 'sampleRate': sr, 'backend': session.get_providers()[0]}
