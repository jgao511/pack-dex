#!/usr/bin/env python3
"""Export and parity-check the trained PackDex embedder as raw TFLite.

The scannerAi-only native bridge consumes this explicit tensor contract through
LiteRT Interpreter; it does not rely on MediaPipe task metadata. Quantization is
opt-in and must pass the same trusted-image Keras/TFLite parity gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import pathlib
import random
import time


IMAGE_SIZE = 224


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_atomic(path: pathlib.Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def load_manifest_paths(
    path: pathlib.Path,
    expected_sha256: str,
    allowed_image_root: pathlib.Path,
    catalog_manifest_path: pathlib.Path,
    expected_validation_count: int,
) -> list[str]:
    if not expected_sha256 or sha256_file(path) != expected_sha256:
        raise ValueError("export manifest does not match the exact completed training run")
    catalog_manifest = json.loads(catalog_manifest_path.read_text(encoding="utf-8"))
    catalog_cards = catalog_manifest.get("cards")
    if not isinstance(catalog_cards, list):
        raise ValueError("trusted catalog manifest is missing its cards array")
    catalog_checksum = hashlib.sha256(canonical_json(catalog_cards).encode("utf-8")).hexdigest()
    if catalog_checksum != catalog_manifest.get("cardsSha256"):
        raise ValueError("trusted catalog manifest checksum does not validate")
    catalog_by_id = {str(card.get("cardId") or ""): card for card in catalog_cards}
    if "" in catalog_by_id or len(catalog_by_id) != len(catalog_cards):
        raise ValueError("trusted catalog manifest contains a missing or duplicate cardId")

    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if not row.get("cardId") or row.get("split") not in {"train", "validation"}:
                raise ValueError(f"export manifest line {line_number} has an invalid identity or split")
            rows.append(row)
    row_by_id = {str(row["cardId"]): row for row in rows}
    if len(row_by_id) != len(rows) or set(row_by_id) != set(catalog_by_id):
        raise ValueError("export manifest identities do not exactly cover the trusted catalog")
    if any(row.get("imageUrl") != catalog_by_id[card_id].get("imageUrl") for card_id, row in row_by_id.items()):
        raise ValueError("export manifest image URLs do not match the trusted catalog resolver output")

    allowed_root = allowed_image_root.resolve()
    validation = [row for row in rows if row["split"] == "validation"]
    if len(validation) != expected_validation_count:
        raise ValueError(
            f"export parity expected {expected_validation_count} unseen identities, found {len(validation)}"
        )
    paths = []
    for row in validation:
        image_path = pathlib.Path(row.get("localPath") or "").resolve()
        try:
            image_path.relative_to(allowed_root)
        except ValueError as error:
            raise ValueError(f"export parity image escaped the trusted cache: {image_path}") from error
        if not image_path.is_file() or sha256_file(image_path) != row.get("imageSha256"):
            raise ValueError(f"export parity image is missing or checksum-invalid: {row['cardId']}")
        paths.append(str(image_path))
    return paths


def preprocess(tf, path: str):
    image = tf.io.decode_image(tf.io.read_file(path), channels=0, expand_animations=False)
    image.set_shape([None, None, None])
    image = tf.cast(image, tf.float32) / 255.0
    channels = tf.shape(image)[-1]
    image = tf.case([
        (tf.equal(channels, 1), lambda: tf.repeat(image, 3, axis=-1)),
        (tf.equal(channels, 2), lambda: tf.repeat(image[..., :1], 3, axis=-1) * image[..., 1:2] + (1.0 - image[..., 1:2])),
        (tf.equal(channels, 4), lambda: image[..., :3] * image[..., 3:4] + (1.0 - image[..., 3:4])),
    ], default=lambda: image[..., :3], exclusive=True)
    image.set_shape([None, None, 3])
    image = tf.image.resize(image, [IMAGE_SIZE, IMAGE_SIZE], method="bicubic", antialias=True)
    return tf.clip_by_value(image, 0.0, 1.0)


def interpreter_input(value, detail):
    import numpy as np

    dtype = detail["dtype"]
    if dtype == np.float32:
        return value.astype(np.float32)
    scale, zero_point = detail.get("quantization", (0.0, 0))
    if not scale:
        raise ValueError("quantized TFLite input did not declare a scale")
    limits = np.iinfo(dtype)
    return np.clip(np.round(value / scale + zero_point), limits.min, limits.max).astype(dtype)


def interpreter_output(value, detail):
    import numpy as np

    if value.dtype == np.float32:
        return value.astype(np.float32)
    scale, zero_point = detail.get("quantization", (0.0, 0))
    if not scale:
        raise ValueError("quantized TFLite output did not declare a scale")
    return (value.astype(np.float32) - zero_point) * scale


def normalize_parity_vector(np, value, label: str):
    vector = np.asarray(value, dtype=np.float32)
    norm = float(np.linalg.norm(vector))
    if not np.all(np.isfinite(vector)) or not math.isfinite(norm) or norm <= 1e-12:
        raise ValueError(f"{label} parity vector was non-finite or zero-length")
    return vector / norm


def run_parity(tf, model, tflite_path: pathlib.Path, paths: list[str], samples: int, seed: int) -> dict:
    import numpy as np

    if not paths:
        raise ValueError("no unseen-validation catalog images were available for export parity")
    selected = random.Random(seed).sample(paths, min(samples, len(paths)))
    try:
        from ai_edge_litert.interpreter import Interpreter
    except ImportError:
        Interpreter = tf.lite.Interpreter
    interpreter = Interpreter(model_path=str(tflite_path), num_threads=max(1, min(8, os.cpu_count() or 1)))
    interpreter.allocate_tensors()
    input_detail = interpreter.get_input_details()[0]
    output_detail = interpreter.get_output_details()[0]
    if list(input_detail["shape"]) != [1, IMAGE_SIZE, IMAGE_SIZE, 3]:
        raise ValueError(f"unexpected TFLite input shape: {input_detail['shape'].tolist()}")
    keras_vectors, lite_vectors = [], []
    started = time.monotonic()
    for path in selected:
        image = preprocess(tf, path).numpy()[None, ...]
        keras_vector = model(image, training=False).numpy()[0].astype(np.float32)
        interpreter.set_tensor(input_detail["index"], interpreter_input(image, input_detail))
        interpreter.invoke()
        lite_vector = interpreter_output(interpreter.get_tensor(output_detail["index"]), output_detail)[0]
        keras_vectors.append(normalize_parity_vector(np, keras_vector, "Keras"))
        lite_vectors.append(normalize_parity_vector(np, lite_vector, "TFLite"))
    keras_vectors = np.asarray(keras_vectors)
    lite_vectors = np.asarray(lite_vectors)
    cosines = np.sum(keras_vectors * lite_vectors, axis=1)
    absolute_errors = np.abs(keras_vectors - lite_vectors)
    if not np.all(np.isfinite(cosines)) or not np.all(np.isfinite(absolute_errors)):
        raise ValueError("TFLite parity metrics became non-finite")
    return {
        "samples": len(selected),
        "dimensions": int(lite_vectors.shape[1]),
        "meanCosine": float(np.mean(cosines)),
        "minimumCosine": float(np.min(cosines)),
        "maximumAbsoluteError": float(np.max(absolute_errors)),
        "durationSeconds": time.monotonic() - started,
        "inputDtype": str(input_detail["dtype"].__name__),
        "outputDtype": str(output_detail["dtype"].__name__),
        "inputShape": input_detail["shape"].tolist(),
        "outputShape": output_detail["shape"].tolist(),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="artifacts/scanner-ai/models/packdex-card-embedder.keras")
    parser.add_argument("--training-completion", default="artifacts/scanner-ai/models/training-complete.json")
    parser.add_argument("--manifest", default="artifacts/scanner-ai/generated/training-manifest.jsonl")
    parser.add_argument("--catalog-manifest", default="artifacts/scanner-ai/catalog-manifest.json")
    parser.add_argument("--output", default="mobile-app/android/app/src/scannerAi/assets/scanner-ai/mobilenet_v3_small.tflite")
    parser.add_argument("--metadata-output", default="artifacts/scanner-ai/models/mobilenet_v3_small.model.json")
    parser.add_argument("--runtime-file-name", default="mobilenet_v3_small.tflite")
    parser.add_argument("--model-version", default="packdex-mnv3s-d128-poc-001")
    parser.add_argument("--quantization", choices=["none", "float16"], default="none")
    parser.add_argument("--parity-samples", type=int, default=128)
    parser.add_argument("--minimum-parity-cosine", type=float, default=0.999)
    parser.add_argument("--seed", type=int, default=20260713)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    import tensorflow as tf

    model_path = pathlib.Path(args.model)
    completion_path = pathlib.Path(args.training_completion)
    completion = json.loads(completion_path.read_text(encoding="utf-8"))
    if completion.get("status") != "complete" or completion.get("modelSha256") != sha256_file(model_path):
        raise SystemExit("Keras model is not bound to a successful finite training-completion sentinel")
    report_path = pathlib.Path(str(completion.get("trainingReport") or ""))
    if not report_path.is_file() or completion.get("trainingReportSha256") != sha256_file(report_path):
        raise SystemExit("training-completion sentinel is not bound to an intact training report")
    training_report = json.loads(report_path.read_text(encoding="utf-8"))
    if (
        training_report.get("status") != "complete"
        or training_report.get("runFingerprint") != completion.get("runFingerprint")
        or (training_report.get("model") or {}).get("sha256") != completion.get("modelSha256")
    ):
        raise SystemExit("training report does not validate the completion sentinel and Keras model")
    model = tf.keras.models.load_model(model_path, compile=False)
    input_shape = list(model.input_shape)
    output_shape = list(model.output_shape)
    if input_shape != [None, IMAGE_SIZE, IMAGE_SIZE, 3]:
        raise SystemExit(f"Keras model input contract was unexpected: {input_shape}")
    if len(output_shape) != 2 or output_shape[1] not in {128, 256}:
        raise SystemExit(f"Keras model output contract was unexpected: {output_shape}")

    report_data = training_report.get("data") or {}
    validation_paths = load_manifest_paths(
        pathlib.Path(args.manifest),
        str(report_data.get("trainingManifestSha256") or ""),
        pathlib.Path(str(report_data.get("allowedImageRoot") or "")),
        pathlib.Path(args.catalog_manifest),
        int((training_report.get("sampler") or {}).get("validationIdentities", 0)),
    )
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS]
    if args.quantization == "float16":
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        converter.target_spec.supported_types = [tf.float16]

    output_path = pathlib.Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_name(f".{output_path.name}.tmp")
    temporary.unlink(missing_ok=True)
    temporary.write_bytes(converter.convert())
    try:
        parity = run_parity(tf, model, temporary, validation_paths, args.parity_samples, args.seed)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    if not math.isfinite(parity["minimumCosine"]) or parity["minimumCosine"] < args.minimum_parity_cosine:
        temporary.unlink(missing_ok=True)
        raise SystemExit(
            f"TFLite parity failed: minimum cosine {parity['minimumCosine']:.6f} "
            f"was below {args.minimum_parity_cosine:.6f}"
        )
    converted_sha256 = sha256_file(temporary)
    converted_bytes = temporary.stat().st_size
    os.replace(temporary, output_path)
    metadata = {
        "schemaVersion": 2,
        "model": {
            "file": args.runtime_file_name,
            "version": args.model_version,
            "sha256": converted_sha256,
            "bytes": converted_bytes,
            "architecture": "MobileNetV3 Small metric embedder",
            "quantization": args.quantization,
            "trainingRunFingerprint": completion.get("runFingerprint"),
            "trainingReportSha256": completion.get("trainingReportSha256"),
            "input": {
                "width": IMAGE_SIZE,
                "height": IMAGE_SIZE,
                "channels": 3,
                "dtype": parity["inputDtype"],
                "normalization": "zero-to-one",
            },
            "output": {
                "dimensions": parity["dimensions"],
                "dtype": parity["outputDtype"],
                "l2Normalized": True,
            },
        },
        "sourceKeras": {"sha256": sha256_file(model_path), "bytes": model_path.stat().st_size},
        "parity": parity,
        "runtime": "scannerAi-only raw LiteRT Interpreter tensor contract",
    }
    write_json_atomic(pathlib.Path(args.metadata_output), metadata)
    print(
        f"Wrote {args.quantization} TFLite model to {output_path} "
        f"({output_path.stat().st_size} bytes; minimum parity cosine {parity['minimumCosine']:.6f})"
    )


if __name__ == "__main__":
    main()
