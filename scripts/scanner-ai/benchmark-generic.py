#!/usr/bin/env python3
"""Build and benchmark the exact generic MediaPipe MobileNetV3 baseline.

This script is deliberately offline after the trusted catalog cache exists. It
embeds every clean catalog image with the exact bundled TFLite model, writes a
deterministically ordered float16 index, creates one seeded camera-like view for
each unseen validation identity, and compares full-catalog retrieval with exact
name-first narrowing. It never discovers or reads Pixel holdout fixtures.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import pathlib
import platform
import statistics
import time
from datetime import datetime, timezone

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

try:
    from ai_edge_litert.interpreter import Interpreter
except ImportError:  # pragma: no cover - fallback for standard TensorFlow envs
    from tensorflow.lite import Interpreter


IMAGE_SIZE = 224
DEFAULT_SEED = 20260713
HOLDOUT_MARKERS = ("pixel-real", "local-pixel", "img_66")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return float(ordered[lower])
    return float(ordered[lower] * (upper - position) + ordered[upper] * (position - lower))


def summarize_numbers(values: list[float]) -> dict:
    return {
        "count": len(values),
        "min": min(values) if values else None,
        "mean": statistics.fmean(values) if values else None,
        "median": statistics.median(values) if values else None,
        "p95": percentile(values, 0.95),
        "max": max(values) if values else None,
    }


def load_manifest(path: pathlib.Path) -> list[dict]:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows.sort(key=lambda row: row["cardId"])
    if not rows or len({row["cardId"] for row in rows}) != len(rows):
        raise SystemExit("Training manifest must contain unique trusted card identities")
    files_by_parent: dict[pathlib.Path, set[str]] = {}
    for parent in {pathlib.Path(row["localPath"]).parent for row in rows}:
        if not parent.is_dir():
            raise SystemExit(f"Catalog cache directory is missing: {parent}")
        files_by_parent[parent] = {child.name for child in parent.iterdir()}
    for row in rows:
        serialized = " ".join(str(row.get(key, "")) for key in ("cardId", "name", "imageUrl", "localPath")).casefold()
        if any(marker in serialized for marker in HOLDOUT_MARKERS):
            raise SystemExit(f"Locked Pixel holdout reference appeared in training manifest: {row['cardId']}")
        if not str(row.get("imageUrl", "")).startswith("https://assets.pack-dex.com/sets/"):
            raise SystemExit(f"Non-PackDex image URL in training manifest: {row['cardId']}")
        local_path = pathlib.Path(row["localPath"])
        if local_path.name not in files_by_parent[local_path.parent]:
            raise SystemExit(f"Cached catalog image is missing: {row['localPath']}")
    return rows


class TfliteEmbedder:
    def __init__(self, model_path: pathlib.Path, threads: int, batch_size: int):
        self.interpreter = Interpreter(model_path=str(model_path), num_threads=threads)
        inputs = self.interpreter.get_input_details()
        if len(inputs) != 1:
            raise SystemExit("Generic embedder must have one input and one output tensor")
        self.input = inputs[0]
        if tuple(self.input["shape"][-3:]) != (IMAGE_SIZE, IMAGE_SIZE, 3):
            raise SystemExit(f"Unexpected model input shape: {self.input['shape']}")
        self.batch_size = batch_size
        self.interpreter.resize_tensor_input(self.input["index"], [batch_size, IMAGE_SIZE, IMAGE_SIZE, 3], strict=False)
        self.interpreter.allocate_tensors()
        self.input = self.interpreter.get_input_details()[0]
        outputs = self.interpreter.get_output_details()
        if len(outputs) != 1:
            raise SystemExit("Generic embedder must have one output tensor")
        self.output = outputs[0]
        if self.input["dtype"] != np.float32 or self.output["dtype"] != np.float32:
            raise SystemExit("Official generic baseline is expected to use float32 input/output")
        self.dimensions = int(self.output["shape"][-1])

    def embed_batch(self, images: list[Image.Image]) -> np.ndarray:
        if not images or len(images) > self.batch_size:
            raise ValueError("Embedding batch must be non-empty and no larger than the configured batch")
        tensor = np.zeros((self.batch_size, IMAGE_SIZE, IMAGE_SIZE, 3), dtype=np.float32)
        for index, image in enumerate(images):
            prepared = image.convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BICUBIC)
            tensor[index] = np.asarray(prepared, dtype=np.float32) / 255.0
        self.interpreter.set_tensor(self.input["index"], tensor)
        self.interpreter.invoke()
        vectors = np.asarray(self.interpreter.get_tensor(self.output["index"])[: len(images)], dtype=np.float32)
        magnitudes = np.linalg.norm(vectors, axis=1, keepdims=True)
        if not np.all(np.isfinite(magnitudes)) or np.any(magnitudes <= 0):
            raise ValueError("Model returned a non-finite or empty embedding")
        return vectors / magnitudes


def open_rgb(path: str) -> Image.Image:
    with Image.open(path) as source:
        source.load()
        return source.convert("RGB")


def stable_rng(seed: int, card_id: str) -> np.random.Generator:
    digest = hashlib.sha256(f"{seed}:{card_id}".encode("utf-8")).digest()
    return np.random.default_rng(int.from_bytes(digest[:8], "big"))


def camera_like_view(image: Image.Image, seed: int, card_id: str) -> Image.Image:
    """Create one bounded, realistic validation view without identity-specific rules."""
    rng = stable_rng(seed, card_id)
    target_width, target_height = 500, 700
    background_rgb = tuple(int(value) for value in rng.integers(25, 205, size=3))
    canvas = Image.new("RGB", (580, 800), background_rgb)

    # Add low-frequency background/lighting variation around the card.
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for _ in range(5):
        x = int(rng.integers(-100, canvas.width))
        y = int(rng.integers(-100, canvas.height))
        radius = int(rng.integers(100, 380))
        tone = 255 if rng.random() < 0.5 else 0
        draw.ellipse((x, y, x + radius, y + radius), fill=(tone, tone, tone, int(rng.integers(5, 22))))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB")

    scale = float(rng.uniform(0.88, 1.01))
    card = image.resize((max(1, int(target_width * scale)), max(1, int(target_height * scale))), Image.Resampling.LANCZOS)
    card = ImageEnhance.Brightness(card).enhance(float(rng.uniform(0.72, 1.25)))
    card = ImageEnhance.Contrast(card).enhance(float(rng.uniform(0.78, 1.25)))
    card = ImageEnhance.Color(card).enhance(float(rng.uniform(0.82, 1.16)))
    channels = np.asarray(card, dtype=np.float32)
    channels *= np.asarray(rng.uniform(0.90, 1.10, size=3), dtype=np.float32)[None, None, :]
    card = Image.fromarray(np.clip(channels, 0, 255).astype(np.uint8), "RGB")
    card = card.rotate(float(rng.uniform(-4.5, 4.5)), resample=Image.Resampling.BICUBIC, expand=True)
    x = (canvas.width - card.width) // 2 + int(rng.integers(-18, 19))
    y = (canvas.height - card.height) // 2 + int(rng.integers(-22, 23))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x + 8, y + 10, x + card.width + 8, y + card.height + 10), radius=12, fill=(0, 0, 0, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=9))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow)
    canvas.alpha_composite(card.convert("RGBA"), (x, y))

    # Sleeve/glare band and occasional slight edge obstruction.
    glare = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    glare_draw = ImageDraw.Draw(glare)
    band_x = int(rng.integers(30, 420))
    band_width = int(rng.integers(24, 80))
    glare_draw.polygon(
        [(band_x, 20), (band_x + band_width, 20), (band_x + band_width + 150, 780), (band_x + 150, 780)],
        fill=(255, 255, 255, int(rng.integers(12, 42))),
    )
    if rng.random() < 0.35:
        side = "left" if rng.random() < 0.5 else "right"
        width = int(rng.integers(5, 18))
        box = (40, 90, 40 + width, 720) if side == "left" else (540 - width, 90, 540, 720)
        glare_draw.rectangle(box, fill=(*background_rgb, 150))
    canvas = Image.alpha_composite(canvas, glare).convert("RGB")

    left = (canvas.width - target_width) // 2 + int(rng.integers(-10, 11))
    top = (canvas.height - target_height) // 2 + int(rng.integers(-12, 13))
    canvas = canvas.crop((left, top, left + target_width, top + target_height))
    if rng.random() < 0.65:
        canvas = canvas.filter(ImageFilter.GaussianBlur(radius=float(rng.uniform(0.15, 1.05))))
    buffer = io.BytesIO()
    canvas.save(buffer, format="JPEG", quality=int(rng.integers(48, 91)), optimize=False)
    buffer.seek(0)
    with Image.open(buffer) as compressed:
        output = compressed.convert("RGB")
    noise = rng.normal(0, float(rng.uniform(1.0, 5.5)), size=(target_height, target_width, 1))
    array = np.asarray(output, dtype=np.float32) + noise
    return Image.fromarray(np.clip(array, 0, 255).astype(np.uint8), "RGB")


def cache_key(model_sha256: str, card_ids: list[str], suffix: str) -> str:
    body = f"{model_sha256}\n{suffix}\n" + "\n".join(card_ids)
    return sha256_bytes(body.encode("utf-8"))


def build_embeddings(embedder: TfliteEmbedder, rows: list[dict], output: pathlib.Path,
                     metadata_path: pathlib.Path, key: str, transform, progress_every: int) -> tuple[np.ndarray, float]:
    if output.is_file() and metadata_path.is_file():
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("cacheKey") == key:
            vectors = np.load(output)
            if vectors.shape == (len(rows), embedder.dimensions):
                print(f"Reused {len(rows)} embeddings from {output}")
                return np.asarray(vectors, dtype=np.float32), 0.0

    output.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    vectors = np.empty((len(rows), embedder.dimensions), dtype=np.float32)
    reported = 0
    for offset in range(0, len(rows), embedder.batch_size):
        batch_rows = rows[offset : offset + embedder.batch_size]
        images = [transform(open_rgb(row["localPath"]), row) for row in batch_rows]
        vectors[offset : offset + len(batch_rows)] = embedder.embed_batch(images)
        completed = offset + len(batch_rows)
        if progress_every and (completed - reported >= progress_every or completed == len(rows)):
            print(f"Embedded {completed}/{len(rows)}", flush=True)
            reported = completed
    duration = time.perf_counter() - started
    temporary = output.with_suffix(output.suffix + ".tmp")
    with temporary.open("wb") as handle:
        np.save(handle, vectors, allow_pickle=False)
    temporary.replace(output)
    metadata_path.write_text(json.dumps({"cacheKey": key, "count": len(rows), "dimensions": embedder.dimensions}, indent=2) + "\n", encoding="utf-8")
    return vectors, duration


def top_positions(scores: np.ndarray, card_ids: list[str], limit: int = 3) -> list[int]:
    count = min(limit, len(scores))
    if count == 0:
        return []
    positions = np.argpartition(scores, -count)[-count:]
    return sorted((int(position) for position in positions), key=lambda position: (-float(scores[position]), card_ids[position]))


def rank_of_expected(scores: np.ndarray, expected_position: int, card_ids: list[str]) -> int:
    expected_score = float(scores[expected_position])
    strictly_better = int(np.count_nonzero(scores > expected_score + 1e-7))
    tied_before = sum(
        1 for position in np.flatnonzero(np.abs(scores - expected_score) <= 1e-7)
        if card_ids[int(position)] < card_ids[expected_position]
    )
    return strictly_better + tied_before + 1


def evaluate_retrieval(catalog: np.ndarray, catalog_f16: np.ndarray, rows: list[dict], queries: np.ndarray,
                       card_ids: list[str], batch_size: int) -> tuple[list[dict], dict]:
    position_by_id = {card_id: position for position, card_id in enumerate(card_ids)}
    name_positions: dict[str, list[int]] = {}
    for position, row in enumerate(rows):
        name_positions.setdefault(str(row.get("normalizedName") or row.get("name") or ""), []).append(position)
    query_rows = [row for row in rows if row.get("split") == "validation"]
    if len(query_rows) != len(queries):
        raise ValueError("Query embedding count does not match unseen validation rows")
    items = []
    matrix_started = time.perf_counter()
    for offset in range(0, len(queries), batch_size):
        batch = queries[offset : offset + batch_size]
        float_scores = batch @ catalog.T
        f16_scores = batch @ catalog_f16.T
        for local_index, row in enumerate(query_rows[offset : offset + len(batch)]):
            scores = float_scores[local_index]
            scores_f16 = f16_scores[local_index]
            expected_position = position_by_id[row["cardId"]]
            full_top = top_positions(scores, card_ids)
            f16_top = top_positions(scores_f16, card_ids)
            pool = name_positions[str(row.get("normalizedName") or row.get("name") or "")]
            pool_scores = scores[pool]
            pool_ids = [card_ids[position] for position in pool]
            pool_order = top_positions(pool_scores, pool_ids)
            narrowed_positions = [pool[position] for position in pool_order]
            narrowed_rank = rank_of_expected(pool_scores, pool.index(expected_position), pool_ids)
            top_score = float(scores[full_top[0]]) if full_top else None
            second_score = float(scores[full_top[1]]) if len(full_top) > 1 else None
            items.append({
                "expectedCardId": row["cardId"],
                "normalizedName": row.get("normalizedName"),
                "candidatePoolSize": len(pool),
                "fullCatalogRank": rank_of_expected(scores, expected_position, card_ids),
                "narrowedRank": narrowed_rank,
                "cosineSimilarity": float(scores[expected_position]),
                "topCardId": card_ids[full_top[0]] if full_top else None,
                "narrowedTopCardId": card_ids[narrowed_positions[0]] if narrowed_positions else None,
                "topMargin": top_score - second_score if top_score is not None and second_score is not None else None,
                "float16FullRank": rank_of_expected(scores_f16, expected_position, card_ids),
                "float16TopCardId": card_ids[f16_top[0]] if f16_top else None,
            })
    matrix_seconds = time.perf_counter() - matrix_started
    return items, {"batchedCosineSeconds": matrix_seconds}


def accuracy_summary(items: list[dict]) -> dict:
    count = len(items)
    ratio = lambda hits: hits / count if count else 0.0
    return {
        "queryCount": count,
        "aiOnlyFullCatalog": {
            "top1": sum(item["fullCatalogRank"] == 1 for item in items),
            "top1Accuracy": ratio(sum(item["fullCatalogRank"] == 1 for item in items)),
            "top3": sum(item["fullCatalogRank"] <= 3 for item in items),
            "top3Accuracy": ratio(sum(item["fullCatalogRank"] <= 3 for item in items)),
        },
        "exactNameNarrowed": {
            "top1": sum(item["narrowedRank"] == 1 for item in items),
            "top1Accuracy": ratio(sum(item["narrowedRank"] == 1 for item in items)),
            "top3": sum(item["narrowedRank"] <= 3 for item in items),
            "top3Accuracy": ratio(sum(item["narrowedRank"] <= 3 for item in items)),
        },
        "float16FullCatalog": {
            "top1": sum(item["float16FullRank"] == 1 for item in items),
            "top3": sum(item["float16FullRank"] <= 3 for item in items),
            "topWinnerChanged": sum(item["topCardId"] != item["float16TopCardId"] for item in items),
        },
        "candidatePoolSizes": summarize_numbers([item["candidatePoolSize"] for item in items]),
        "expectedCosine": summarize_numbers([item["cosineSimilarity"] for item in items]),
        "winnerMargins": summarize_numbers([item["topMargin"] for item in items if item["topMargin"] is not None]),
    }


def write_index(index_dir: pathlib.Path, vectors: np.ndarray, rows: list[dict], model_path: pathlib.Path,
                model_info: dict, manifest_sha256: str) -> dict:
    index_dir.mkdir(parents=True, exist_ok=True)
    vector_path = index_dir / "catalog-embeddings.f16"
    metadata_path = index_dir / "catalog-embeddings.meta.json"
    catalog_metadata_path = index_dir / "catalog-metadata.json"
    card_ids = [row["cardId"] for row in rows]
    vector_bytes = np.asarray(vectors, dtype="<f2").tobytes(order="C")
    vector_path.write_bytes(vector_bytes)
    model_sha256 = sha256_file(model_path)
    index_version = f"generic-{manifest_sha256[:12]}-{model_sha256[:12]}-f16"
    catalog_metadata = {
        "schemaVersion": 2,
        "count": len(rows),
        "cards": [{
            "cardId": row["cardId"],
            "name": row.get("name"),
            "normalizedName": row.get("normalizedName"),
            "setId": row.get("setId"),
            "setName": row.get("setName"),
            "collectorNumber": row.get("collectorNumber"),
            "printedTotal": row.get("printedTotal"),
            "rarity": row.get("rarity"),
        } for row in rows],
    }
    catalog_metadata_bytes = (json.dumps(
        catalog_metadata, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
    ) + "\n").encode("utf-8")
    catalog_metadata_path.write_bytes(catalog_metadata_bytes)
    model_version = "mediapipe-mobilenet-v3-small-float32-latest"
    model_contract = {
        "file": model_path.name,
        "version": model_version,
        "sha256": model_sha256,
        "bytes": model_path.stat().st_size,
        "architecture": model_info["name"],
        "quantization": "none",
        "input": {
            "width": int(model_info["input"]["width"]),
            "height": int(model_info["input"]["height"]),
            "channels": int(model_info["input"]["channels"]),
            "dtype": "float32",
            "normalization": "zero-to-one",
        },
        "output": {
            "dimensions": int(model_info["output"]["dimensions"]),
            "dtype": "float32",
            "l2Normalized": True,
        },
    }
    metadata = {
        "schemaVersion": 2,
        "indexVersion": index_version,
        "modelVersion": model_version,
        "model": model_contract,
        "source": {"catalogCardsSha256": manifest_sha256},
        "count": len(rows),
        "dimensions": int(vectors.shape[1]),
        "dtype": "float16-le",
        "normalized": True,
        "vectorFile": vector_path.name,
        "vectorSha256": sha256_bytes(vector_bytes),
        "cardIdsSha256": sha256_bytes(("\n".join(card_ids) + "\n").encode("utf-8")),
        "metadataFile": catalog_metadata_path.name,
        "metadataSha256": sha256_bytes(catalog_metadata_bytes),
        "cardIds": card_ids,
    }
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return {**metadata, "vectorBytes": len(vector_bytes), "metadataBytes": metadata_path.stat().st_size}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="artifacts/scanner-ai/generated/training-manifest.jsonl")
    parser.add_argument("--catalog-manifest", default="artifacts/scanner-ai/catalog-manifest.json")
    parser.add_argument("--model", default="mobile-app/android/app/src/scannerAi/assets/scanner-ai/mobilenet_v3_small.tflite")
    parser.add_argument("--model-info", default="scripts/scanner-ai/official-baseline-model.json")
    parser.add_argument("--cache-dir", default="artifacts/scanner-ai/cache/generic-baseline")
    parser.add_argument("--index-dir", default="artifacts/scanner-ai/generated/generic-baseline")
    parser.add_argument("--report", default="artifacts/scanner-ai/reports/generic-full-catalog-benchmark.json")
    parser.add_argument("--query-limit", type=int, default=0)
    parser.add_argument("--index-only", action="store_true", help="Reuse/build clean embeddings and write deploy-compatible index artifacts without query evaluation.")
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--inference-batch-size", type=int, default=32)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--progress-every", type=int, default=500)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest_path = pathlib.Path(args.manifest)
    catalog_manifest_path = pathlib.Path(args.catalog_manifest)
    model_path = pathlib.Path(args.model)
    model_info = json.loads(pathlib.Path(args.model_info).read_text(encoding="utf-8"))
    expected_model_sha = model_info.get("sha256")
    model_sha = sha256_file(model_path)
    if expected_model_sha and model_sha != expected_model_sha:
        raise SystemExit(f"Generic baseline model checksum mismatch: {model_sha}")
    catalog_manifest = json.loads(catalog_manifest_path.read_text(encoding="utf-8"))
    manifest_sha = catalog_manifest.get("cardsSha256") or sha256_file(catalog_manifest_path)
    rows = load_manifest(manifest_path)
    validation_rows = [row for row in rows if row.get("split") == "validation"]
    if args.query_limit:
        validation_rows = validation_rows[: args.query_limit]
    embedder = TfliteEmbedder(model_path, args.threads, args.inference_batch_size)
    if embedder.dimensions != int(model_info.get("output", {}).get("dimensions", embedder.dimensions)):
        raise SystemExit("Model output dimensions do not match official baseline metadata")

    cache_dir = pathlib.Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    card_ids = [row["cardId"] for row in rows]
    clean_key = cache_key(model_sha, card_ids, "clean-v1")
    clean_vectors, clean_seconds = build_embeddings(
        embedder, rows, cache_dir / "clean.npy", cache_dir / "clean.meta.json", clean_key,
        lambda image, _row: image, args.progress_every,
    )
    index_metadata = write_index(
        pathlib.Path(args.index_dir), clean_vectors, rows, model_path, model_info, manifest_sha,
    )
    if args.index_only:
        print(json.dumps({key: value for key, value in index_metadata.items() if key != "cardIds"}, indent=2))
        print(f"Wrote generic index to {args.index_dir}")
        return
    query_ids = [row["cardId"] for row in validation_rows]
    query_key = cache_key(model_sha, query_ids, f"camera-like-v1:{args.seed}")
    query_vectors, query_seconds = build_embeddings(
        embedder, validation_rows, cache_dir / f"queries-{args.seed}-{len(validation_rows)}.npy",
        cache_dir / f"queries-{args.seed}-{len(validation_rows)}.meta.json", query_key,
        lambda image, row: camera_like_view(image, args.seed, row["cardId"]), args.progress_every,
    )

    # evaluate_retrieval expects the complete manifest followed by its selected
    # unseen rows; temporarily preserve only the queried validation set marker.
    query_id_set = set(query_ids)
    evaluation_rows = [{**row, "split": "validation" if row["cardId"] in query_id_set else "train"} for row in rows]
    rounded_vectors = clean_vectors.astype(np.float16).astype(np.float32)
    items, retrieval_timing = evaluate_retrieval(
        clean_vectors, rounded_vectors, evaluation_rows, query_vectors, card_ids, args.batch_size,
    )

    direct_timings = []
    for query in query_vectors[: min(200, len(query_vectors))]:
        started = time.perf_counter()
        _ = clean_vectors @ query
        direct_timings.append((time.perf_counter() - started) * 1000)
    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "generic-official-mobilenetv3-full-catalog",
        "holdoutUsed": False,
        "source": "trusted PackDex catalog cache only",
        "model": {
            "name": model_info["name"],
            "sha256": model_sha,
            "bytes": model_path.stat().st_size,
            "dimensions": embedder.dimensions,
        },
        "catalog": {"count": len(rows), "manifestSha256": manifest_sha},
        "validation": {
            "split": "deterministic unseen identities",
            "queryCount": len(validation_rows),
            "augmentation": "seeded bounded camera-like transform v1",
            "seed": args.seed,
        },
        "summary": accuracy_summary(items),
        "index": {key: value for key, value in index_metadata.items() if key != "cardIds"},
        "timing": {
            "cleanEmbeddingSeconds": clean_seconds,
            "queryEmbeddingSeconds": query_seconds,
            **retrieval_timing,
            "directFullCatalogSearchMs": summarize_numbers(direct_timings),
        },
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "numpy": np.__version__,
        },
        "items": items,
    }
    report_path = pathlib.Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))
    print(f"Wrote generic index to {args.index_dir}")
    print(f"Wrote benchmark to {report_path}")


if __name__ == "__main__":
    main()
