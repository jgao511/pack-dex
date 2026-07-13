#!/usr/bin/env python3
"""Build the deterministic binary PackDex catalog embedding index.

The exact deployed TFLite model embeds one clean trusted image per unique card
ID. Vectors and metadata are separate, checksummed artifacts. Float16 is only
written after measured retrieval agreement with the float32 matrix.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import io
import json
import math
import os
import pathlib
import statistics
import time


IMAGE_SIZE = 224


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def write_bytes_atomic(path: pathlib.Path, body: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(body)
    os.replace(temporary, path)


def write_json_atomic(path: pathlib.Path, value: object, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    if compact:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    else:
        body = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False)
    temporary.write_text(body + "\n", encoding="utf-8", newline="\n")
    os.replace(temporary, path)


def load_rows(path: pathlib.Path, allowed_root: pathlib.Path) -> list[dict]:
    root = allowed_root.resolve()
    rows = []
    seen = set()
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            card_id = str(row.get("cardId") or "")
            if not card_id or card_id in seen:
                raise ValueError(f"training manifest contains missing or duplicate card ID: {card_id!r}")
            seen.add(card_id)
            image_path = pathlib.Path(row.get("localPath") or "").resolve()
            try:
                image_path.relative_to(root)
            except ValueError as error:
                raise ValueError(f"image is outside trusted catalog cache: {image_path}") from error
            row["localPath"] = str(image_path)
            rows.append(row)
    rows.sort(key=lambda item: item["cardId"])
    return rows


def prepare_image(row: dict):
    import numpy as np
    from PIL import Image

    path = pathlib.Path(row["localPath"])
    data = path.read_bytes()
    digest = sha256_bytes(data)
    if digest != row.get("imageSha256"):
        raise ValueError(f"trusted image checksum mismatch for {row['cardId']}")
    with Image.open(io.BytesIO(data)) as image:
        if "transparency" in image.info or image.mode in {"RGBA", "LA"}:
            rgba = image.convert("RGBA")
            background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            background.alpha_composite(rgba)
            image = background.convert("RGB")
        else:
            image = image.convert("RGB")
        image = image.resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR)
        return np.asarray(image, dtype=np.float32) / 255.0


def quantize_input(values, detail):
    import numpy as np

    if detail["dtype"] == np.float32:
        return values.astype(np.float32)
    scale, zero_point = detail.get("quantization", (0.0, 0))
    if not scale:
        raise ValueError("quantized model input is missing scale metadata")
    limits = np.iinfo(detail["dtype"])
    return np.clip(np.round(values / scale + zero_point), limits.min, limits.max).astype(detail["dtype"])


def dequantize_output(values, detail):
    import numpy as np

    if values.dtype == np.float32:
        return values.astype(np.float32)
    scale, zero_point = detail.get("quantization", (0.0, 0))
    if not scale:
        raise ValueError("quantized model output is missing scale metadata")
    return (values.astype(np.float32) - zero_point) * scale


def create_interpreter(model_path: pathlib.Path, threads: int):
    try:
        from ai_edge_litert.interpreter import Interpreter
    except ImportError:
        from tensorflow.lite import Interpreter
    interpreter = Interpreter(model_path=str(model_path), num_threads=threads)
    interpreter.allocate_tensors()
    return interpreter


def embed_catalog(model_path: pathlib.Path, rows: list[dict], batch_size: int, workers: int, threads: int):
    import numpy as np

    interpreter = create_interpreter(model_path, threads)
    original_input = interpreter.get_input_details()[0]
    signature = original_input.get("shape_signature", original_input["shape"])
    dynamic_batch = int(signature[0]) == -1
    vectors = []
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers, thread_name_prefix="packdex-index") as executor:
        for offset in range(0, len(rows), batch_size):
            batch_rows = rows[offset : offset + batch_size]
            images = np.stack(list(executor.map(prepare_image, batch_rows)))
            current_batch_size = len(images)
            if current_batch_size != int(interpreter.get_input_details()[0]["shape"][0]):
                if not dynamic_batch:
                    # Fixed-batch models are invoked one image at a time.
                    for image in images:
                        input_detail = interpreter.get_input_details()[0]
                        output_detail = interpreter.get_output_details()[0]
                        interpreter.set_tensor(input_detail["index"], quantize_input(image[None, ...], input_detail))
                        interpreter.invoke()
                        vectors.append(dequantize_output(interpreter.get_tensor(output_detail["index"]), output_detail)[0])
                    continue
                interpreter.resize_tensor_input(original_input["index"], [current_batch_size, IMAGE_SIZE, IMAGE_SIZE, 3], strict=False)
                interpreter.allocate_tensors()
            input_detail = interpreter.get_input_details()[0]
            output_detail = interpreter.get_output_details()[0]
            interpreter.set_tensor(input_detail["index"], quantize_input(images, input_detail))
            interpreter.invoke()
            vectors.extend(dequantize_output(interpreter.get_tensor(output_detail["index"]), output_detail))
            if (offset // batch_size + 1) % 50 == 0 or offset + batch_size >= len(rows):
                print(f"Embedded {min(offset + batch_size, len(rows))}/{len(rows)} trusted cards", flush=True)
    matrix = np.asarray(vectors, dtype=np.float32)
    if matrix.ndim != 2 or matrix.shape[0] != len(rows) or matrix.shape[1] not in {128, 256}:
        raise ValueError(f"unexpected catalog embedding shape: {matrix.shape}")
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    if not np.all(np.isfinite(matrix)) or np.any(norms <= 1e-12):
        raise ValueError("catalog model emitted non-finite or zero-length vectors")
    matrix /= norms
    return matrix, time.monotonic() - started


def validate_float16(float32_matrix, sample_count: int) -> dict:
    import numpy as np

    float16_matrix = float32_matrix.astype("<f2")
    restored = float16_matrix.astype(np.float32)
    restored /= np.maximum(np.linalg.norm(restored, axis=1, keepdims=True), 1e-12)
    indices = np.linspace(0, len(float32_matrix) - 1, min(sample_count, len(float32_matrix)), dtype=int)
    float32_scores = float32_matrix[indices] @ float32_matrix.T
    float16_scores = restored[indices] @ restored.T
    # Exclude the identical source row. Including it makes top-1 agreement a
    # nearly tautological self-match rather than a useful precision diagnostic.
    float32_scores[np.arange(len(indices)), indices] = -np.inf
    float16_scores[np.arange(len(indices)), indices] = -np.inf
    top1_float32 = np.argmax(float32_scores, axis=1)
    top1_float16 = np.argmax(float16_scores, axis=1)
    neighbor_count = min(3, len(float32_matrix) - 1)
    top3_float32 = np.argpartition(-float32_scores, kth=neighbor_count - 1, axis=1)[:, :neighbor_count]
    top3_float16 = np.argpartition(-float16_scores, kth=neighbor_count - 1, axis=1)[:, :neighbor_count]
    top3_agreement = np.mean([
        len(set(left.tolist()).intersection(right.tolist())) / neighbor_count
        for left, right in zip(top3_float32, top3_float16)
    ])
    vector_cosines = np.sum(float32_matrix * restored, axis=1)
    return {
        "samples": len(indices),
        "scope": (
            "clean catalog neighbor-ranking diagnostic with self rows excluded; final model/index selection "
            "requires separate augmented unseen-identity queries"
        ),
        "top1Agreement": float(np.mean(top1_float32 == top1_float16)),
        "meanTop3SetAgreement": float(top3_agreement),
        "meanVectorCosine": float(np.mean(vector_cosines)),
        "minimumVectorCosine": float(np.min(vector_cosines)),
        "maximumAbsoluteComponentError": float(np.max(np.abs(float32_matrix - restored))),
    }


def benchmark_direct_cosine(matrix, query_count: int) -> dict:
    import numpy as np

    indices = np.linspace(0, len(matrix) - 1, min(query_count, len(matrix)), dtype=int)
    timings = []
    # Warm BLAS and page in the matrix before timing individual scans.
    _ = matrix[indices[0]] @ matrix.T
    for index in indices:
        started = time.perf_counter()
        scores = matrix[index] @ matrix.T
        _ = int(np.argmax(scores))
        timings.append((time.perf_counter() - started) * 1000.0)
    timings.sort()
    p95_index = min(len(timings) - 1, math.ceil(len(timings) * 0.95) - 1)
    return {
        "queries": len(timings),
        "meanMs": statistics.fmean(timings),
        "medianMs": statistics.median(timings),
        "p95Ms": timings[p95_index],
        "maxMs": max(timings),
        "implementation": "NumPy exact matrix-vector cosine; no ANN",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="mobile-app/android/app/src/scannerAi/assets/scanner-ai/mobilenet_v3_small.tflite")
    parser.add_argument("--model-metadata", default="artifacts/scanner-ai/models/mobilenet_v3_small.model.json")
    parser.add_argument("--training-manifest", default="artifacts/scanner-ai/generated/training-manifest.jsonl")
    parser.add_argument("--catalog-manifest", default="artifacts/scanner-ai/catalog-manifest.json")
    parser.add_argument("--allowed-image-root", default="artifacts/scanner-ai/downloads/catalog")
    parser.add_argument("--output-dir", default="mobile-app/android/app/src/scannerAi/assets/public/scanner-ai")
    parser.add_argument("--index-version", default="packdex-index-poc-001")
    parser.add_argument("--dtype", choices=["float16", "float32"], default="float16")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--interpreter-threads", type=int, default=8)
    parser.add_argument("--float16-validation-samples", type=int, default=512)
    parser.add_argument("--benchmark-queries", type=int, default=128)
    return parser.parse_args()


def main() -> None:
    import numpy as np

    args = parse_args()
    rows = load_rows(pathlib.Path(args.training_manifest), pathlib.Path(args.allowed_image_root))
    catalog_manifest = json.loads(pathlib.Path(args.catalog_manifest).read_text(encoding="utf-8"))
    catalog_checksum = sha256_bytes(canonical_json(catalog_manifest["cards"]).encode("utf-8"))
    if catalog_checksum != catalog_manifest.get("cardsSha256"):
        raise SystemExit("trusted catalog manifest checksum does not validate")
    catalog_by_id = {card["cardId"]: card for card in catalog_manifest["cards"]}
    if len(rows) != len(catalog_by_id) or [row["cardId"] for row in rows] != sorted(catalog_by_id):
        raise SystemExit("training manifest identities do not exactly match the trusted catalog")
    if any(row.get("imageUrl") != catalog_by_id[row["cardId"]].get("imageUrl") for row in rows):
        raise SystemExit("training manifest image URLs do not match the trusted catalog")
    model_path = pathlib.Path(args.model)
    model_metadata = json.loads(pathlib.Path(args.model_metadata).read_text(encoding="utf-8"))["model"]
    model_sha256 = sha256_file(model_path)
    if model_sha256 != model_metadata.get("sha256"):
        raise SystemExit("deployed TFLite checksum does not match model metadata")
    expected_input = model_metadata.get("input") or {}
    expected_output = model_metadata.get("output") or {}
    if (
        expected_input.get("width") != IMAGE_SIZE
        or expected_input.get("height") != IMAGE_SIZE
        or expected_input.get("channels") != 3
        or expected_input.get("dtype") != "float32"
        or expected_input.get("normalization") != "zero-to-one"
        or expected_output.get("dtype") != "float32"
    ):
        raise SystemExit("deployed model metadata does not match the scannerAi tensor contract")

    matrix, embedding_seconds = embed_catalog(
        model_path, rows, args.batch_size, args.workers, args.interpreter_threads,
    )
    if int(expected_output.get("dimensions", 0)) != int(matrix.shape[1]):
        raise SystemExit("deployed model output dimensions do not match generated embeddings")
    float16_validation = validate_float16(matrix, args.float16_validation_samples)
    if args.dtype == "float16" and float16_validation["minimumVectorCosine"] < 0.9999:
        raise SystemExit(f"float16 storage-precision gate failed: {float16_validation}")

    stored_matrix = matrix.astype("<f2" if args.dtype == "float16" else "<f4")
    vector_body = stored_matrix.tobytes(order="C")
    card_ids = [row["cardId"] for row in rows]
    card_ids_body = ("\n".join(card_ids) + "\n").encode("utf-8")
    metadata_cards = [{
        "cardId": row["cardId"],
        "name": row.get("name"),
        "normalizedName": row.get("normalizedName"),
        "setId": row.get("setId"),
        "setName": row.get("setName"),
        "collectorNumber": row.get("collectorNumber"),
        "printedTotal": row.get("printedTotal"),
        "rarity": row.get("rarity"),
    } for row in rows]
    metadata_payload = {"schemaVersion": 2, "count": len(rows), "cards": metadata_cards}
    metadata_body = (json.dumps(metadata_payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
    output_dir = pathlib.Path(args.output_dir)
    vector_path = output_dir / ("catalog-embeddings.f16" if args.dtype == "float16" else "catalog-embeddings.f32")
    metadata_path = output_dir / "catalog-metadata.json"
    meta_path = output_dir / "catalog-embeddings.meta.json"
    write_bytes_atomic(vector_path, vector_body)
    write_bytes_atomic(metadata_path, metadata_body)
    restored_matrix = stored_matrix.astype(np.float32)
    restored_matrix /= np.maximum(np.linalg.norm(restored_matrix, axis=1, keepdims=True), 1e-12)
    direct_benchmark = benchmark_direct_cosine(restored_matrix, args.benchmark_queries)
    meta = {
        "schemaVersion": 2,
        "indexVersion": args.index_version,
        "count": len(rows),
        "dimensions": int(matrix.shape[1]),
        "dtype": "float16-le" if args.dtype == "float16" else "float32-le",
        "normalized": True,
        "vectorFile": vector_path.name,
        "vectorBytes": len(vector_body),
        "vectorSha256": sha256_bytes(vector_body),
        "cardIds": card_ids,
        "cardIdsSha256": sha256_bytes(card_ids_body),
        "metadataFile": metadata_path.name,
        "metadataSha256": sha256_bytes(metadata_body),
        "source": {"catalogCardsSha256": catalog_manifest.get("cardsSha256")},
        "model": model_metadata,
        "float16Validation": float16_validation,
        "directCosineBenchmark": direct_benchmark,
        "build": {"embeddingSeconds": embedding_seconds, "batchSize": args.batch_size},
    }
    write_json_atomic(meta_path, meta)
    print(
        f"Wrote {len(rows)}x{matrix.shape[1]} {args.dtype} embeddings to {vector_path} "
        f"({len(vector_body)} bytes, {direct_benchmark['medianMs']:.3f} ms median exact search)"
    )


if __name__ == "__main__":
    main()
