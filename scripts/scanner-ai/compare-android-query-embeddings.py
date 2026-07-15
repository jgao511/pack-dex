#!/usr/bin/env python3
"""Compare Android scanner query vectors with frozen float32 TFLite output."""

from __future__ import annotations

import argparse
import json
import math
import pathlib

import numpy as np
from PIL import Image
import tensorflow as tf


def normalized(value: np.ndarray) -> np.ndarray:
    value = np.asarray(value, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(value))
    if not np.all(np.isfinite(value)) or norm <= 1e-12:
        raise ValueError("embedding was non-finite or zero-length")
    return value / norm


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--diagnostics", default="artifacts/scanner-ai/reports/consumed-pixel-diagnostics-stream/diagnostics-with-embeddings.json")
    parser.add_argument("--model", default="artifacts/scanner-ai/models/packdex-mnv3s-d128-float32.tflite")
    parser.add_argument("--output", default="artifacts/scanner-ai/reports/consumed-pixel-diagnostics-stream/android-python-embedding-parity.json")
    args = parser.parse_args()
    diagnostics_path = pathlib.Path(args.diagnostics).resolve()
    values = json.loads(diagnostics_path.read_text(encoding="utf-8"))
    if len(values) != 3:
        raise ValueError("parity is restricted to exactly the three authorized diagnostics")
    interpreter = tf.lite.Interpreter(model_path=str(pathlib.Path(args.model).resolve()))
    interpreter.allocate_tensors()
    input_detail = interpreter.get_input_details()[0]
    output_detail = interpreter.get_output_details()[0]
    if tuple(input_detail["shape"].tolist()) != (1, 224, 224, 3) or input_detail["dtype"] != np.float32:
        raise ValueError("unexpected frozen float32 TFLite input contract")
    rows = []
    for index, item in enumerate(values):
        fixture = ["IMG_6652.jpeg", "IMG_6658.jpeg", "IMG_6663.jpeg"][index]
        model_file = item.get("diagnosticFiles", {}).get("model")
        if not model_file:
            raise ValueError(f"{fixture} did not include an exported model input")
        image_path = diagnostics_path.parent / pathlib.Path(fixture).stem / model_file
        image = np.asarray(Image.open(image_path).convert("RGB"), dtype=np.float32) / 255.0
        if image.shape != (224, 224, 3):
            raise ValueError(f"{fixture} model input was not native 224x224 RGB")
        interpreter.set_tensor(input_detail["index"], image[None, ...])
        interpreter.invoke()
        python_vector = normalized(interpreter.get_tensor(output_detail["index"])[0])
        android_vector = normalized(np.asarray(item.get("queryEmbedding"), dtype=np.float32))
        cosine = float(np.dot(android_vector, python_vector))
        max_abs = float(np.max(np.abs(android_vector - python_vector)))
        rows.append({"fixture": fixture, "modelInput": str(image_path.relative_to(diagnostics_path.parent)).replace("\\", "/"), "dimensions": int(android_vector.size), "cosine": cosine, "maxAbsoluteError": max_abs, "androidL2Norm": float(np.linalg.norm(android_vector)), "pythonL2Norm": float(np.linalg.norm(python_vector))})
    passed = all(row["dimensions"] == 128 and row["cosine"] >= 0.99999 and row["maxAbsoluteError"] <= 0.001 for row in rows)
    result = {"schemaVersion": 1, "purpose": "Android native LiteRT versus Python frozen float32 TFLite parity on exported native 224x224 scanner inputs", "model": str(pathlib.Path(args.model)), "criteria": {"minimumCosine": 0.99999, "maximumAbsoluteError": 0.001}, "passed": passed, "rows": rows}
    output = pathlib.Path(args.output); output.parent.mkdir(parents=True, exist_ok=True); output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    if not passed:
        raise SystemExit("Android/Python embedding parity failed")


if __name__ == "__main__":
    main()
