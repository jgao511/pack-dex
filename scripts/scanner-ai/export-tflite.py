#!/usr/bin/env python3
"""Export the PackDex embedding model to a quantized LiteRT/TFLite artifact."""

from __future__ import annotations

import argparse
import pathlib

import tensorflow as tf


def representative_dataset():
    for _ in range(128):
        yield [tf.random.uniform([1, 224, 224, 3], 0, 1, dtype=tf.float32)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="artifacts/scanner-ai/models/packdex-card-embedder.keras")
    parser.add_argument("--output", default="artifacts/scanner-ai/models/packdex-card-embedder-int8.tflite")
    args = parser.parse_args()

    model = tf.keras.models.load_model(args.model)
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = representative_dataset
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.uint8
    converter.inference_output_type = tf.float32
    output_path = pathlib.Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(converter.convert())
    print(f"Wrote quantized model to {output_path} ({output_path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
