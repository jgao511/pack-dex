#!/usr/bin/env python3
"""Build validation-only query embeddings with the exact deployed TFLite model.

The 1,875 identities come exclusively from the deterministic `validation`
split of the trusted catalog training manifest. Camera-like views are generated
in memory and are never written to disk. Locked Pixel fixtures are neither
discovered nor accepted as inputs.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import pathlib
import sys
import time
from datetime import datetime, timezone

import numpy as np
from PIL import Image

try:
    from ai_edge_litert.interpreter import Interpreter
except ImportError:  # pragma: no cover - supported TensorFlow fallback
    from tensorflow.lite import Interpreter


GENERATOR_VERSION = "packdex-validation-query-embeddings-v1"
DEFAULT_VALIDATION_COUNT = 1875
LOCKED_MARKERS = ("local-pixel", "pixel-real", "img_66")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_bytes(path: pathlib.Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(value)
    temporary.replace(path)


def atomic_write_json(path: pathlib.Path, value: dict) -> None:
    atomic_write_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def load_camera_view_builder(script_path: pathlib.Path):
    spec = importlib.util.spec_from_file_location("packdex_scanner_ai_generic_benchmark", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load deterministic validation view builder: {script_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.camera_like_view


def load_validation_rows(manifest_path: pathlib.Path, allowed_root: pathlib.Path) -> tuple[list[dict], str]:
    manifest_bytes = manifest_path.read_bytes()
    rows = [json.loads(line) for line in manifest_bytes.decode("utf-8").splitlines() if line.strip()]
    validation = [row for row in rows if row.get("split") == "validation"]
    validation.sort(key=lambda row: row["cardId"])
    if not validation or len({row["cardId"] for row in validation}) != len(validation):
        raise ValueError("Validation manifest identities must be non-empty and unique")
    resolved_root = allowed_root.resolve()
    for row in validation:
        serialized = " ".join(str(row.get(key, "")) for key in ("cardId", "name", "imageUrl", "localPath")).casefold()
        if any(marker in serialized for marker in LOCKED_MARKERS):
            raise ValueError(f"Locked fixture marker appeared in validation input: {row['cardId']}")
        image_path = pathlib.Path(row["localPath"]).resolve()
        try:
            image_path.relative_to(resolved_root)
        except ValueError as error:
            raise ValueError(f"Validation image escaped the trusted catalog cache: {image_path}") from error
        if not image_path.is_file():
            raise ValueError(f"Validation catalog image is missing: {image_path}")
    return validation, sha256_bytes(manifest_bytes)


class ExactTfliteEmbedder:
    def __init__(self, model_path: pathlib.Path, model_contract: dict, batch_size: int, threads: int):
        self.interpreter = Interpreter(model_path=str(model_path), num_threads=threads)
        inputs = self.interpreter.get_input_details()
        outputs = self.interpreter.get_output_details()
        if len(inputs) != 1 or len(outputs) != 1:
            raise ValueError("Validation embedder requires exactly one input and one output tensor")
        self.input = inputs[0]
        self.output = outputs[0]
        input_contract = model_contract.get("input") or {}
        output_contract = model_contract.get("output") or {}
        self.width = int(input_contract.get("width", 0))
        self.height = int(input_contract.get("height", 0))
        self.channels = int(input_contract.get("channels", 0))
        self.dimensions = int(output_contract.get("dimensions", 0))
        self.normalization = str(input_contract.get("normalization", ""))
        if (self.width, self.height, self.channels) != (224, 224, 3):
            raise ValueError("Deployed model metadata must declare float32 NHWC [1,224,224,3]")
        if input_contract.get("dtype") != "float32" or output_contract.get("dtype") != "float32":
            raise ValueError("Validation calibration supports only the deployed float32 tensor contract")
        if self.normalization not in {"zero-to-one", "minus-one-to-one"}:
            raise ValueError(f"Unsupported deployed input normalization: {self.normalization}")
        if self.dimensions <= 0:
            raise ValueError("Deployed model output dimensions are missing")
        self.batch_size = batch_size
        self.interpreter.resize_tensor_input(self.input["index"], [batch_size, self.height, self.width, self.channels], strict=False)
        self.interpreter.allocate_tensors()
        self.input = self.interpreter.get_input_details()[0]
        self.output = self.interpreter.get_output_details()[0]
        if self.input["dtype"] != np.float32 or self.output["dtype"] != np.float32:
            raise ValueError("Actual TFLite input/output tensors must be float32")
        if tuple(int(value) for value in self.input["shape"]) != (batch_size, self.height, self.width, self.channels):
            raise ValueError(f"Actual TFLite input shape does not match metadata: {self.input['shape']}")
        if int(self.output["shape"][-1]) != self.dimensions:
            raise ValueError("Actual TFLite output dimensions do not match metadata")

    def embed(self, images: list[Image.Image]) -> np.ndarray:
        if not images or len(images) > self.batch_size:
            raise ValueError("Embedding batch is empty or too large")
        tensor = np.zeros((self.batch_size, self.height, self.width, self.channels), dtype=np.float32)
        for index, image in enumerate(images):
            prepared = image.convert("RGB").resize((self.width, self.height), Image.Resampling.BILINEAR)
            values = np.asarray(prepared, dtype=np.float32)
            tensor[index] = values / 255.0 if self.normalization == "zero-to-one" else (values - 127.5) / 127.5
        self.interpreter.set_tensor(self.input["index"], tensor)
        self.interpreter.invoke()
        vectors = np.asarray(self.interpreter.get_tensor(self.output["index"])[: len(images)], dtype=np.float32)
        magnitudes = np.linalg.norm(vectors, axis=1, keepdims=True)
        if not np.all(np.isfinite(vectors)) or not np.all(np.isfinite(magnitudes)) or np.any(magnitudes <= 0):
            raise ValueError("TFLite returned a non-finite or zero validation embedding")
        return vectors / magnitudes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="artifacts/scanner-ai/generated/training-manifest.jsonl")
    parser.add_argument("--catalog-manifest", default="artifacts/scanner-ai/catalog-manifest.json")
    parser.add_argument("--allowed-image-root", default="artifacts/scanner-ai/downloads/catalog")
    parser.add_argument("--model", default="mobile-app/android/app/src/scannerAi/assets/scanner-ai/mobilenet_v3_small.tflite")
    parser.add_argument("--index-metadata", default="mobile-app/android/app/src/scannerAi/assets/public/scanner-ai/catalog-embeddings.meta.json")
    parser.add_argument("--output", default="artifacts/scanner-ai/generated/validation-queries.meta.json")
    parser.add_argument("--view-builder", default="scripts/scanner-ai/benchmark-generic.py")
    parser.add_argument("--seed", type=int, default=20260713)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--threads", type=int, default=8)
    parser.add_argument("--expected-count", type=int, default=DEFAULT_VALIDATION_COUNT)
    parser.add_argument("--full-catalog-limit", type=int, default=20)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--allow-partial", action="store_true")
    parser.add_argument("--progress-every", type=int, default=100)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest_path = pathlib.Path(args.manifest)
    catalog_manifest_path = pathlib.Path(args.catalog_manifest)
    model_path = pathlib.Path(args.model)
    index_metadata_path = pathlib.Path(args.index_metadata)
    output_path = pathlib.Path(args.output)
    vector_path = output_path.with_name("validation-queries.f32")
    rows, training_manifest_sha256 = load_validation_rows(manifest_path, pathlib.Path(args.allowed_image_root))
    if args.limit:
        if not args.allow_partial:
            raise SystemExit("--limit requires --allow-partial and may not be used for a freeze calibration")
        rows = rows[: args.limit]
    if not args.allow_partial and len(rows) != args.expected_count:
        raise SystemExit(f"Expected exactly {args.expected_count} unseen validation identities, found {len(rows)}")

    index_metadata_bytes = index_metadata_path.read_bytes()
    index_metadata = json.loads(index_metadata_bytes)
    model_contract = index_metadata.get("model") or {}
    model_sha256 = sha256_file(model_path)
    declared_model_sha256 = model_contract.get("fileSha256") or model_contract.get("sha256")
    if not declared_model_sha256 or declared_model_sha256 != model_sha256:
        raise SystemExit("Exact deployed TFLite bytes do not match index metadata")
    if int(index_metadata.get("dimensions", 0)) != int((model_contract.get("output") or {}).get("dimensions", 0)):
        raise SystemExit("Index dimensions do not match the deployed model contract")
    index_vector_name = index_metadata.get("vectorFile", "catalog-embeddings.f16")
    if (
        not isinstance(index_vector_name, str)
        or not index_vector_name
        or pathlib.Path(index_vector_name).is_absolute()
        or pathlib.Path(index_vector_name).name != index_vector_name
        or "/" in index_vector_name
        or "\\" in index_vector_name
    ):
        raise SystemExit("Index metadata vectorFile must be a sibling filename")
    index_vector_path = index_metadata_path.with_name(index_vector_name)
    index_vector_sha256 = sha256_file(index_vector_path)
    if index_metadata.get("vectorSha256") != index_vector_sha256:
        raise SystemExit("Deployed index vector bytes do not match index metadata")
    card_ids = [str(value) for value in index_metadata.get("cardIds") or []]
    if len(card_ids) != int(index_metadata.get("count", 0)) or len(set(card_ids)) != len(card_ids):
        raise SystemExit("Deployed index card IDs are incomplete or duplicated")
    catalog_manifest = json.loads(catalog_manifest_path.read_text(encoding="utf-8"))
    catalog_cards_sha256 = catalog_manifest.get("cardsSha256")
    declared_catalog_sha256 = (index_metadata.get("source") or {}).get("catalogCardsSha256") or (index_metadata.get("catalog") or {}).get("manifestSha256")
    if not catalog_cards_sha256 or catalog_cards_sha256 != declared_catalog_sha256:
        raise SystemExit("Index metadata does not match the trusted catalog manifest")

    camera_like_view = load_camera_view_builder(pathlib.Path(args.view_builder))
    embedder = ExactTfliteEmbedder(model_path, model_contract, args.batch_size, args.threads)
    vectors = np.empty((len(rows), embedder.dimensions), dtype=np.float32)
    started = time.perf_counter()
    for offset in range(0, len(rows), args.batch_size):
        batch_rows = rows[offset : offset + args.batch_size]
        views: list[Image.Image] = []
        for row in batch_rows:
            with Image.open(row["localPath"]) as source:
                source.load()
                views.append(camera_like_view(source.convert("RGB"), args.seed, row["cardId"]))
        vectors[offset : offset + len(batch_rows)] = embedder.embed(views)
        for view in views:
            view.close()
        completed = offset + len(batch_rows)
        if args.progress_every and (completed % args.progress_every < len(batch_rows) or completed == len(rows)):
            print(f"Embedded validation queries {completed}/{len(rows)}", flush=True)

    vector_bytes = np.asarray(vectors, dtype="<f4").tobytes(order="C")
    expected_ids = [row["cardId"] for row in rows]
    index_matrix = np.fromfile(index_vector_path, dtype="<f2").astype(np.float32)
    if index_matrix.size != len(card_ids) * embedder.dimensions:
        raise SystemExit("Deployed index vector shape does not match metadata")
    index_matrix = index_matrix.reshape((len(card_ids), embedder.dimensions))
    full_catalog_candidates: list[list[dict]] = []
    rank_started = time.perf_counter()
    limit = max(2, min(args.full_catalog_limit, len(card_ids)))
    for offset in range(0, len(vectors), args.batch_size):
        score_batch = vectors[offset : offset + args.batch_size] @ index_matrix.T
        for scores in score_batch:
            provisional = np.argpartition(-scores, limit - 1)[:limit]
            cutoff = float(np.min(scores[provisional]))
            tied = np.flatnonzero(scores >= cutoff - 1e-7)
            ordered = sorted((int(position) for position in tied), key=lambda position: (-float(scores[position]), card_ids[position]))[:limit]
            full_catalog_candidates.append([
                {"cardId": card_ids[position], "visualScore": float(scores[position])}
                for position in ordered
            ])
    expected_ranks = [
        next((rank for rank, candidate in enumerate(candidates, start=1) if candidate["cardId"] == expected_id), None)
        for expected_id, candidates in zip(expected_ids, full_catalog_candidates, strict=True)
    ]
    top1_correct = sum(rank == 1 for rank in expected_ranks)
    top3_correct = sum(rank is not None and rank <= 3 for rank in expected_ranks)
    found_within_limit = sum(rank is not None for rank in expected_ranks)
    reciprocal_rank_at_limit = sum(1.0 / rank for rank in expected_ranks if rank is not None) / len(expected_ranks)
    metadata = {
        "schemaVersion": 1,
        "kind": "packdex-scanner-ai-validation-queries",
        "generatorVersion": GENERATOR_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "split": "deterministic-unseen-identities",
        "seed": args.seed,
        "viewTransform": "benchmark-generic.py camera_like_view v1; in-memory only; PIL bilinear model resize",
        "count": len(rows),
        "dimensions": embedder.dimensions,
        "dtype": "float32-le",
        "normalized": True,
        "vectorFile": vector_path.name,
        "vectorSha256": sha256_bytes(vector_bytes),
        "expectedIds": expected_ids,
        "expectedIdsSha256": sha256_bytes(("\n".join(expected_ids) + "\n").encode("utf-8")),
        "trainingManifestSha256": training_manifest_sha256,
        "catalogCardsSha256": catalog_cards_sha256,
        "indexMetadataSha256": sha256_bytes(index_metadata_bytes),
        "indexVectorSha256": index_vector_sha256,
        "indexVersion": index_metadata.get("indexVersion"),
        "modelVersion": model_contract.get("version") or index_metadata.get("modelVersion"),
        "modelFileSha256": model_sha256,
        "processingSeconds": time.perf_counter() - started,
        "fullCatalogRankingSeconds": time.perf_counter() - rank_started,
        "fullCatalogRetrieval": {
            "candidateLimit": limit,
            "top1Correct": top1_correct,
            "top1Accuracy": top1_correct / len(expected_ranks),
            "top3Correct": top3_correct,
            "top3Accuracy": top3_correct / len(expected_ranks),
            "foundWithinCandidateLimit": found_within_limit,
            "reciprocalRankAtCandidateLimit": reciprocal_rank_at_limit,
        },
        "fullCatalogCandidates": full_catalog_candidates,
        "partial": bool(args.allow_partial),
        "lockedPixelInputsUsed": False,
    }
    atomic_write_bytes(vector_path, vector_bytes)
    atomic_write_json(output_path, metadata)
    print(f"Wrote {len(rows)} validation-only query embeddings to {vector_path}")
    print(f"Wrote query metadata to {output_path}")
    print(
        f"Full-catalog validation top-1 {top1_correct}/{len(rows)} ({top1_correct / len(rows):.4%}); "
        f"top-3 {top3_correct}/{len(rows)} ({top3_correct / len(rows):.4%})"
    )


if __name__ == "__main__":
    main()
