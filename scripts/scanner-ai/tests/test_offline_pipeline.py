from __future__ import annotations

import importlib.util
import hashlib
import json
import pathlib
import struct
import sys
import tempfile
import unittest
import zlib


ROOT = pathlib.Path(__file__).resolve().parents[3]


def load_module(name: str, relative_path: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    assert spec.loader
    spec.loader.exec_module(module)
    return module


dataset = load_module("packdex_build_dataset", "scripts/scanner-ai/build-dataset.py")
training = load_module("packdex_train_embedding", "scripts/scanner-ai/train-embedding.py")
indexing = load_module("packdex_build_index", "scripts/scanner-ai/build-embedding-index.py")
exporting = load_module("packdex_export_tflite", "scripts/scanner-ai/export-tflite.py")


def minimal_png(width=245, height=342):
    def chunk(name, payload):
        return struct.pack(">I", len(payload)) + name + payload + struct.pack(">I", zlib.crc32(name + payload))

    scanlines = b"".join(b"\x00" + b"\x00" * (width * 3) for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">II", width, height) + b"\x08\x02\x00\x00\x00")
        + chunk(b"IDAT", zlib.compress(scanlines))
        + chunk(b"IEND", b"")
    )


class DownloaderValidationTests(unittest.TestCase):
    def test_valid_png_signature_and_dimensions(self):
        info = dataset.validate_image_bytes(minimal_png(), "image/png", 128)
        self.assertEqual((info.format, info.width, info.height), ("png", 245, 342))

    def test_truncated_png_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "truncated"):
            dataset.inspect_image(minimal_png()[:-4])

    def test_trailer_only_png_is_rejected_by_full_decode(self):
        invalid = (
            b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR"
            + struct.pack(">II", 245, 342) + b"\x08\x02\x00\x00\x00"
            + b"\x00\x00\x00\x00" + b"\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        with self.assertRaisesRegex(ValueError, "full decode"):
            dataset.validate_image_bytes(invalid, "image/png", 128)

    def test_non_packdex_and_credentialed_urls_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "non-PackDex"):
            dataset.validate_asset_url("https://example.com/sets/a/cards/1.png")
        with self.assertRaisesRegex(ValueError, "authority"):
            dataset.validate_asset_url("https://user:pass@assets.pack-dex.com/sets/a/cards/1.png")

    def test_unicode_resolver_path_is_percent_encoded(self):
        encoded = dataset.encode_asset_url("https://assets.pack-dex.com/sets/a/cards/Poké_◇.png")
        self.assertEqual(encoded, "https://assets.pack-dex.com/sets/a/cards/Pok%C3%A9_%E2%97%87.png")

    def test_cache_identity_is_bound_to_resolved_source_url(self):
        first = {"cardId": "set-1", "imageUrl": "https://assets.pack-dex.com/sets/a/cards/1.png"}
        second = {"cardId": "set-1", "imageUrl": "https://assets.pack-dex.com/sets/a/cards/1-v2.png"}
        self.assertNotEqual(
            dataset.cache_path_for_card(pathlib.Path("cache"), first),
            dataset.cache_path_for_card(pathlib.Path("cache"), second),
        )


class MetricSamplerTests(unittest.TestCase):
    def test_batches_have_two_identities_and_consume_each_once(self):
        rows = [
            {"cardId": "a", "hardNegatives": [{"cardId": "b"}]},
            {"cardId": "b", "hardNegatives": [{"cardId": "a"}]},
            {"cardId": "c", "hardNegatives": [{"cardId": "d"}]},
            {"cardId": "d", "hardNegatives": [{"cardId": "c"}]},
            {"cardId": "e", "hardNegatives": [{"cardId": "a"}]},
        ]
        batches = training.plan_identity_batches(rows, identities_per_batch=2, seed=7)
        flattened = [card_id for batch in batches for card_id in batch]
        self.assertCountEqual(flattened, [row["cardId"] for row in rows])
        self.assertTrue(all(len(batch) >= 2 for batch in batches))

    def test_split_summary_reports_unseen_identity_invariant(self):
        rows = [
            {"cardId": "train-a", "split": "train", "hardNegatives": [{"cardId": "train-b"}]},
            {"cardId": "train-b", "split": "train", "hardNegatives": [{"cardId": "train-a"}]},
            {"cardId": "validation-a", "split": "validation", "hardNegatives": []},
        ]
        summary = training.split_summary(rows, identities_per_batch=2, seed=11)
        self.assertEqual(summary["identityOverlap"], [])
        self.assertEqual(summary["viewsPerIdentity"], 2)
        self.assertEqual(summary["imagesPerFullEpoch"], 4)

    def test_visual_fingerprint_candidates_are_prioritized(self):
        base = {
            "nameFamilyTokens": [], "layoutTokens": [], "rarity": None, "series": None,
            "printedTotal": None, "collectorNumber": None,
            "visualFingerprint": {"meanRgb": [100.0, 120.0, 140.0], "differenceHash64": "0123456789abcdef"},
        }
        cards = [
            {**base, "cardId": "a", "name": "Alpha", "normalizedName": "alpha", "setId": "one"},
            {**base, "cardId": "b", "name": "Beta", "normalizedName": "beta", "setId": "two"},
        ]
        negatives = dataset.build_hard_negatives(cards, count=1)
        self.assertEqual(negatives["a"][0]["cardId"], "b")
        self.assertIn("same-artwork-fingerprint", negatives["a"][0]["reasons"])
        self.assertIn("similar-colors", negatives["a"][0]["reasons"])


class TrainingIntegrityTests(unittest.TestCase):
    def catalog_fixture(self, directory):
        cards = [
            {
                "cardId": card_id, "name": name, "normalizedName": name.lower(),
                "nameFamilyTokens": [name.lower()], "layoutTokens": [], "setId": "set",
                "setName": "Set", "collectorNumber": number, "printedTotal": 2,
                "rarity": "Common", "series": "Series",
                "imageUrl": f"https://assets.pack-dex.com/sets/set/cards/{number}.png",
            }
            for card_id, name, number in (("set-1", "Alpha", "1"), ("set-2", "Beta", "2"))
        ]
        checksum = hashlib.sha256(training.canonical_json(cards).encode("utf-8")).hexdigest()
        path = pathlib.Path(directory) / "catalog.json"
        path.write_text(json.dumps({"count": 2, "cardsSha256": checksum, "cards": cards}), encoding="utf-8")
        rows = [
            {**card, "split": "train", "hardNegatives": [{"cardId": cards[1 - index]["cardId"]}]}
            for index, card in enumerate(cards)
        ]
        return path, rows

    def test_catalog_binding_requires_exact_coverage_by_default(self):
        with tempfile.TemporaryDirectory() as directory:
            path, rows = self.catalog_fixture(directory)
            binding = training.bind_rows_to_catalog(rows, path)
            self.assertEqual(binding["catalogIdentityCount"], 2)
            with self.assertRaisesRegex(ValueError, "exactly cover"):
                training.bind_rows_to_catalog(rows[:1], path)

    def test_catalog_binding_rejects_mutated_resolver_url(self):
        with tempfile.TemporaryDirectory() as directory:
            path, rows = self.catalog_fixture(directory)
            rows[0]["imageUrl"] = "https://assets.pack-dex.com/sets/set/cards/mutated.png"
            with self.assertRaisesRegex(ValueError, "imageUrl"):
                training.bind_rows_to_catalog(rows, path)


class IndexPrecisionTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("numpy"), "NumPy is installed in the training environment")
    def test_float16_gate_preserves_separated_vectors(self):
        import numpy as np

        matrix = np.eye(8, dtype=np.float32)
        result = indexing.validate_float16(matrix, sample_count=8)
        self.assertEqual(result["top1Agreement"], 1.0)
        self.assertGreaterEqual(result["minimumVectorCosine"], 0.9999)


class ExportIntegrityTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("numpy"), "NumPy is installed in the training environment")
    def test_non_finite_parity_vector_is_rejected(self):
        import numpy as np

        with self.assertRaisesRegex(ValueError, "non-finite"):
            exporting.normalize_parity_vector(np, np.asarray([1.0, np.nan], np.float32), "TFLite")

    def test_parity_manifest_is_bound_to_catalog_root_and_image_sha(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            image_root = root / "images"
            image_root.mkdir()
            images = [image_root / "1.png", image_root / "2.png"]
            for index, image in enumerate(images, 1):
                image.write_bytes(f"trusted-{index}".encode())
            cards = [
                {
                    "cardId": f"set-{index}",
                    "imageUrl": f"https://assets.pack-dex.com/sets/set/cards/{index}.png",
                }
                for index in (1, 2)
            ]
            catalog = root / "catalog.json"
            catalog.write_text(json.dumps({
                "count": len(cards),
                "cardsSha256": hashlib.sha256(exporting.canonical_json(cards).encode()).hexdigest(),
                "cards": cards,
            }), encoding="utf-8")
            rows = [
                {
                    **card,
                    "split": "validation" if index == 0 else "train",
                    "localPath": str(images[index]),
                    "imageSha256": hashlib.sha256(images[index].read_bytes()).hexdigest(),
                }
                for index, card in enumerate(cards)
            ]
            manifest = root / "training.jsonl"
            manifest.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            manifest_sha = hashlib.sha256(manifest.read_bytes()).hexdigest()
            paths = exporting.load_manifest_paths(manifest, manifest_sha, image_root, catalog, 1)
            self.assertEqual(paths, [str(images[0].resolve())])
            images[0].write_bytes(b"mutated")
            with self.assertRaisesRegex(ValueError, "checksum-invalid"):
                exporting.load_manifest_paths(manifest, manifest_sha, image_root, catalog, 1)


if __name__ == "__main__":
    unittest.main()
