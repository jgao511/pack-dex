#!/usr/bin/env python3
"""Build a deterministic scanner-AI training manifest from trusted PackDex assets.

This script intentionally uses only URLs already emitted from the PackDex catalog manifest.
It does not know about, load, or augment the locked Pixel holdout photos.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import random
import urllib.request
from collections import defaultdict


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, output_path: pathlib.Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        return
    with urllib.request.urlopen(url, timeout=30) as response:
        output_path.write_bytes(response.read())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="artifacts/scanner-ai/catalog-manifest.json")
    parser.add_argument("--cache-dir", default="artifacts/scanner-ai/downloads/catalog")
    parser.add_argument("--output", default="artifacts/scanner-ai/generated/training-manifest.jsonl")
    parser.add_argument("--seed", type=int, default=20260712)
    parser.add_argument("--download", action="store_true", help="Download trusted Cloudflare card images into the gitignored cache.")
    args = parser.parse_args()

    manifest = json.loads(pathlib.Path(args.manifest).read_text(encoding="utf-8"))
    cache_dir = pathlib.Path(args.cache_dir)
    output_path = pathlib.Path(args.output)
    rng = random.Random(args.seed)
    rows = []

    cards = sorted(manifest["cards"], key=lambda item: item["cardId"])
    by_name = defaultdict(list)
    by_set = defaultdict(list)
    for item in cards:
        by_name[item["name"].casefold()].append(item["cardId"])
        by_set[item["setId"]].append(item["cardId"])
    for card in cards:
        same_name = [card_id for card_id in by_name[card["name"].casefold()] if card_id != card["cardId"]]
        same_set = [card_id for card_id in by_set[card["setId"]] if card_id != card["cardId"]]
        hard_negative_ids = (same_name + same_set)[:24]
        extension = pathlib.Path(card["imageUrl"].split("?")[0]).suffix or ".png"
        image_path = cache_dir / f"{card['cardId']}{extension}"
        if args.download:
            download(card["imageUrl"], image_path)
        checksum = sha256_file(image_path) if image_path.exists() else None
        for augmentation_index in range(12):
            rows.append({
                "cardId": card["cardId"],
                "name": card["name"],
                "setId": card["setId"],
                "setName": card["setName"],
                "collectorNumber": card["collectorNumber"],
                "imageUrl": card["imageUrl"],
                "localPath": str(image_path).replace("\\", "/"),
                "sha256": checksum,
                "split": "val" if augmentation_index == 0 else "train",
                "augmentationIndex": augmentation_index,
                "augmentationSeed": rng.randrange(1_000_000_000),
                "hardNegativeIds": hard_negative_ids,
            })

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(json.dumps(row, sort_keys=True) for row in rows) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} rows to {output_path}")


if __name__ == "__main__":
    main()
