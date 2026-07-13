#!/usr/bin/env python3
"""Generate the compact catalog embedding index consumed by scanner-test AI POC."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib

import numpy as np
import tensorflow as tf


def preprocess(path: str) -> np.ndarray:
    image = tf.io.decode_image(tf.io.read_file(path), channels=3, expand_animations=False)
    image = tf.image.resize(image, [224, 224], method="bicubic")
    return (tf.cast(image, tf.float32).numpy() / 255.0)[None, ...]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="artifacts/scanner-ai/models/packdex-card-embedder.keras")
    parser.add_argument("--training-manifest", default="artifacts/scanner-ai/generated/training-manifest.jsonl")
    parser.add_argument("--output", default="mobile-app/android/app/src/scannerAi/assets/scanner-ai/catalog-embeddings.json")
    parser.add_argument("--version", default="poc-001")
    args = parser.parse_args()

    model = tf.keras.models.load_model(args.model)
    rows = [json.loads(line) for line in pathlib.Path(args.training_manifest).read_text(encoding="utf-8").splitlines() if line.strip()]
    cards = []
    for row in sorted(rows, key=lambda item: item["cardId"]):
        path = pathlib.Path(row["localPath"])
        if not path.exists():
            continue
        embedding = model.predict(preprocess(str(path)), verbose=0)[0].astype(np.float32)
        embedding = embedding / max(np.linalg.norm(embedding), 1e-12)
        cards.append({
            "cardId": row["cardId"],
            "embedding": [round(float(value), 6) for value in embedding.tolist()],
        })

    payload = {
        "schemaVersion": 1,
        "modelVersion": args.version,
        "indexVersion": args.version,
        "dimensions": len(cards[0]["embedding"]) if cards else 0,
        "cards": cards,
    }
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    payload["sha256"] = hashlib.sha256(body.encode("utf-8")).hexdigest()
    output_path = pathlib.Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    print(f"Wrote {len(cards)} embeddings to {output_path}")


if __name__ == "__main__":
    main()
