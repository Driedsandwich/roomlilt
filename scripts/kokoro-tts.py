"""Synthesize narration clips locally with Kokoro (Apache-2.0 weights) via kokoro-onnx (MIT).

Usage: python scripts/kokoro-tts.py <model.onnx> <voices.bin> <jobs.json>
jobs.json is a list of {"text": str, "voice": str, "speed": float, "out": path-to-wav}.
"""
import json
import sys

import soundfile as sf
from kokoro_onnx import Kokoro


def main() -> None:
    model, voices, jobs_file = sys.argv[1:4]
    with open(jobs_file, encoding="utf-8") as handle:
        jobs = json.load(handle)
    kokoro = Kokoro(model, voices)
    for job in jobs:
        samples, rate = kokoro.create(job["text"], voice=job["voice"], speed=float(job.get("speed", 1.0)), lang="en-us")
        if len(samples) == 0:
            raise SystemExit(f"Kokoro produced no samples for: {job['out']}")
        sf.write(job["out"], samples, rate)
        print(f"{job['out']} {len(samples) / rate:.2f} s", flush=True)


if __name__ == "__main__":
    main()
