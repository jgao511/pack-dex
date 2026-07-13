#!/usr/bin/env python3
"""Cache and validate trusted PackDex card images for metric learning.

Only URLs emitted by export-catalog-manifest.mjs are accepted. Downloads are
resumable, bounded, atomically installed, and validated for HTTP status,
content type, image signature, dimensions, byte size, and SHA-256. The locked
Pixel fixtures are neither discovered nor referenced by this script.
"""

from __future__ import annotations

import argparse
import bisect
import concurrent.futures
import hashlib
import io
import json
import os
import pathlib
import re
import struct
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable


DEFAULT_SEED = 20260713
ALLOWED_HOST = "assets.pack-dex.com"
ALLOWED_PATH_PREFIX = "/sets/"


@dataclass(frozen=True)
class ImageInfo:
    format: str
    mime_type: str
    width: int
    height: int


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: object) -> str:
    # Matches export-catalog-manifest.mjs canonicalJson for JSON-safe values.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def read_u24le(data: bytes) -> int:
    return data[0] | (data[1] << 8) | (data[2] << 16)


def inspect_image(data: bytes) -> ImageInfo:
    """Read PNG/JPEG/WebP/GIF dimensions without trusting file extensions."""
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        if not data.endswith(b"IEND\xaeB`\x82"):
            raise ValueError("PNG payload was truncated before IEND")
        width, height = struct.unpack(">II", data[16:24])
        return ImageInfo("png", "image/png", width, height)

    if data.startswith(b"\xff\xd8"):
        if not data.rstrip(b"\x00\r\n\t ").endswith(b"\xff\xd9"):
            raise ValueError("JPEG payload was truncated before EOI")
        offset = 2
        sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
        while offset + 4 <= len(data):
            while offset < len(data) and data[offset] != 0xFF:
                offset += 1
            while offset < len(data) and data[offset] == 0xFF:
                offset += 1
            if offset >= len(data):
                break
            marker = data[offset]
            offset += 1
            if marker in {0x01, 0xD8, 0xD9}:
                continue
            if offset + 2 > len(data):
                break
            segment_length = struct.unpack(">H", data[offset : offset + 2])[0]
            if segment_length < 2 or offset + segment_length > len(data):
                break
            if marker in sof_markers and segment_length >= 7:
                height, width = struct.unpack(">HH", data[offset + 3 : offset + 7])
                return ImageInfo("jpeg", "image/jpeg", width, height)
            offset += segment_length
        raise ValueError("JPEG did not contain a valid size marker")

    if len(data) >= 30 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        if int.from_bytes(data[4:8], "little") + 8 > len(data):
            raise ValueError("WebP RIFF length exceeded the payload")
        chunk = data[12:16]
        if chunk == b"VP8X":
            width = 1 + read_u24le(data[24:27])
            height = 1 + read_u24le(data[27:30])
        elif chunk == b"VP8 " and len(data) >= 30 and data[23:26] == b"\x9d\x01\x2a":
            width = struct.unpack("<H", data[26:28])[0] & 0x3FFF
            height = struct.unpack("<H", data[28:30])[0] & 0x3FFF
        elif chunk == b"VP8L" and len(data) >= 25 and data[20] == 0x2F:
            bits = int.from_bytes(data[21:25], "little")
            width = 1 + (bits & 0x3FFF)
            height = 1 + ((bits >> 14) & 0x3FFF)
        else:
            raise ValueError("WebP did not contain a supported size header")
        return ImageInfo("webp", "image/webp", width, height)

    if len(data) >= 10 and data[:6] in {b"GIF87a", b"GIF89a"}:
        if data[-1] != 0x3B:
            raise ValueError("GIF payload was truncated before its trailer")
        width, height = struct.unpack("<HH", data[6:10])
        return ImageInfo("gif", "image/gif", width, height)

    raise ValueError("payload is not a recognized PNG, JPEG, WebP, or GIF image")


def normalize_image_content_type(value: str | None) -> str:
    content_type = str(value or "").split(";", 1)[0].strip().lower()
    return {
        "image/jpg": "image/jpeg",
        "image/pjpeg": "image/jpeg",
        "image/x-png": "image/png",
    }.get(content_type, content_type)


def validate_image_bytes(data: bytes, advertised_content_type: str | None, min_dimension: int) -> ImageInfo:
    if not data:
        raise ValueError("image payload was empty")
    content_type = normalize_image_content_type(advertised_content_type)
    if content_type and not content_type.startswith("image/"):
        raise ValueError(f"HTTP Content-Type was not an image: {content_type}")
    info = inspect_image(data)
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as decoded:
            decoded.load()
            decoded_size = decoded.size
    except ImportError as error:
        raise RuntimeError("Pillow is required for fail-closed full image decoding") from error
    except Exception as error:  # Pillow exposes format-specific exception classes.
        raise ValueError(f"image failed full decode: {error}") from error
    if decoded_size != (info.width, info.height):
        raise ValueError(
            f"decoded dimensions {decoded_size[0]}x{decoded_size[1]} did not match "
            f"the signed header {info.width}x{info.height}"
        )
    # A few trusted Cloudflare objects carry a stale image/png header while
    # containing a valid JPEG. Preserve that mismatch in the cache report, but
    # trust the independently validated signature and dimensions rather than
    # discarding a catalog identity.
    if info.width < min_dimension or info.height < min_dimension:
        raise ValueError(f"image dimensions {info.width}x{info.height} were below {min_dimension}px")
    if info.width > 16_384 or info.height > 16_384:
        raise ValueError(f"image dimensions {info.width}x{info.height} were unexpectedly large")
    return info


def validate_asset_url(url: str) -> None:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != ALLOWED_HOST or not parsed.path.startswith(ALLOWED_PATH_PREFIX):
        raise ValueError(f"refusing non-PackDex catalog asset URL: {url}")
    if parsed.username or parsed.password or parsed.port not in {None, 443}:
        raise ValueError(f"refusing URL with unexpected authority: {url}")


def encode_asset_url(url: str) -> str:
    """Percent-encode Unicode resolver paths for urllib without changing identity."""
    parsed = urllib.parse.urlsplit(url)
    encoded_path = urllib.parse.quote(urllib.parse.unquote(parsed.path), safe="/~!$&'()*+,;=:@")
    encoded_query = urllib.parse.quote(urllib.parse.unquote(parsed.query), safe="!$&'()*+,;=:@/?")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, encoded_path, encoded_query, parsed.fragment))


def cache_path_for_card(cache_dir: pathlib.Path, card: dict) -> pathlib.Path:
    parsed = urllib.parse.urlsplit(card["imageUrl"])
    extension = pathlib.PurePosixPath(parsed.path).suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", extension):
        extension = ".image"
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "-", str(card["cardId"])).strip("-.") or "card"
    source_suffix = hashlib.sha256(f"{card['cardId']}\0{card['imageUrl']}".encode("utf-8")).hexdigest()[:12]
    return cache_dir / f"{safe_id}-{source_suffix}{extension}"


def legacy_cache_path_for_card(cache_dir: pathlib.Path, card: dict) -> pathlib.Path:
    """Locate pre-source-binding cache names for one-time atomic migration."""
    parsed = urllib.parse.urlsplit(card["imageUrl"])
    extension = pathlib.PurePosixPath(parsed.path).suffix.lower()
    if not re.fullmatch(r"\.[a-z0-9]{1,8}", extension):
        extension = ".image"
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "-", str(card["cardId"])).strip("-.") or "card"
    identity_suffix = hashlib.sha256(str(card["cardId"]).encode("utf-8")).hexdigest()[:10]
    return cache_dir / f"{safe_id}-{identity_suffix}{extension}"


def result_for_bytes(card: dict, path: pathlib.Path, data: bytes, status: str, content_type: str | None,
                     http_status: int | None, attempts: int, min_dimension: int) -> dict:
    info = validate_image_bytes(data, content_type, min_dimension)
    normalized_content_type = normalize_image_content_type(content_type)
    return {
        "cardId": card["cardId"],
        "imageUrl": card["imageUrl"],
        "localPath": path.as_posix(),
        "status": status,
        "httpStatus": http_status,
        "contentType": content_type or info.mime_type,
        "contentTypeMismatch": bool(normalized_content_type and normalized_content_type != info.mime_type),
        "format": info.format,
        "width": info.width,
        "height": info.height,
        "bytes": len(data),
        "sha256": sha256_bytes(data),
        "attempts": attempts,
        "error": None,
    }


def read_response_bounded(response, max_bytes: int) -> bytes:
    content_length = response.headers.get("Content-Length")
    if content_length and int(content_length) > max_bytes:
        raise ValueError(f"Content-Length {content_length} exceeded {max_bytes} bytes")
    chunks = []
    size = 0
    while True:
        chunk = response.read(min(1024 * 1024, max_bytes + 1 - size))
        if not chunk:
            break
        chunks.append(chunk)
        size += len(chunk)
        if size > max_bytes:
            raise ValueError(f"image payload exceeded {max_bytes} bytes")
    return b"".join(chunks)


def cache_card(card: dict, cache_dir: pathlib.Path, download_enabled: bool, timeout: float,
               retries: int, max_bytes: int, min_dimension: int) -> dict:
    path = cache_path_for_card(cache_dir, card)
    try:
        validate_asset_url(card["imageUrl"])
    except Exception as error:  # noqa: BLE001 - serialized in a bounded report
        return {"cardId": card.get("cardId"), "imageUrl": card.get("imageUrl"), "localPath": path.as_posix(),
                "status": "failed", "attempts": 0, "error": str(error)}

    legacy_path = legacy_cache_path_for_card(cache_dir, card)
    if not path.exists() and legacy_path.exists():
        try:
            data = legacy_path.read_bytes()
            result_for_bytes(card, path, data, "cached", None, None, 0, min_dimension)
            if download_enabled:
                path.parent.mkdir(parents=True, exist_ok=True)
                os.replace(legacy_path, path)
        except Exception:
            pass

    if path.exists():
        try:
            data = path.read_bytes()
            return result_for_bytes(card, path, data, "cached", None, None, 0, min_dimension)
        except Exception as error:
            # A partial/corrupt cache entry is replaced atomically when downloads are enabled.
            if not download_enabled:
                return {"cardId": card["cardId"], "imageUrl": card["imageUrl"], "localPath": path.as_posix(),
                        "status": "failed", "attempts": 0,
                        "error": f"existing cache file failed image validation: {type(error).__name__}: {error}"}

    if not download_enabled:
        return {"cardId": card["cardId"], "imageUrl": card["imageUrl"], "localPath": path.as_posix(),
                "status": "missing", "attempts": 0, "error": "not downloaded (pass --download)"}

    path.parent.mkdir(parents=True, exist_ok=True)
    last_error = None
    for attempt in range(1, retries + 2):
        temporary_path = None
        try:
            request = urllib.request.Request(
                encode_asset_url(card["imageUrl"]),
                headers={"Accept": "image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1", "User-Agent": "PackDex-scanner-ai-cache/1"},
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                validate_asset_url(response.geturl())
                http_status = int(getattr(response, "status", response.getcode()))
                if http_status != 200:
                    raise ValueError(f"HTTP status was {http_status}, expected 200")
                content_type = response.headers.get("Content-Type")
                if not content_type or not content_type.lower().startswith("image/"):
                    raise ValueError(f"HTTP Content-Type was not an image: {content_type!r}")
                data = read_response_bounded(response, max_bytes)
            result = result_for_bytes(card, path, data, "downloaded", content_type, http_status, attempt, min_dimension)
            with tempfile.NamedTemporaryFile(prefix=f".{path.name}.", suffix=".part", dir=path.parent, delete=False) as handle:
                temporary_path = pathlib.Path(handle.name)
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, path)
            return result
        except Exception as error:  # noqa: BLE001 - retries and report preserve the cause
            last_error = error
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
            if attempt <= retries:
                time.sleep(min(0.5 * (2 ** (attempt - 1)), 2.0))

    return {
        "cardId": card["cardId"],
        "imageUrl": card["imageUrl"],
        "localPath": path.as_posix(),
        "status": "failed",
        "attempts": retries + 1,
        "error": f"{type(last_error).__name__}: {last_error}",
    }


def bounded_neighbors(values: Iterable[str], card_id: str, limit: int) -> list[str]:
    ordered = sorted(values)
    if len(ordered) <= limit + 1:
        return [value for value in ordered if value != card_id]
    center = bisect.bisect_left(ordered, card_id)
    result = []
    offset = 1
    while len(result) < limit and offset < len(ordered):
        for index in (center - offset, center + offset):
            if 0 <= index < len(ordered) and ordered[index] != card_id:
                result.append(ordered[index])
                if len(result) == limit:
                    break
        offset += 1
    return result


def collector_features(value: object) -> tuple[str, int | None, int | None]:
    normalized = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    match = re.match(r"([A-Z]*)(\d+)", normalized)
    if not match:
        return normalized, None, None
    number = int(match.group(2))
    return match.group(1), number, number // 10


def add_visual_fingerprints(cards: list[dict], result_by_id: dict[str, dict], workers: int) -> list[dict]:
    """Add small trusted-image fingerprints for color/reprint negative mining."""
    try:
        from PIL import Image, ImageStat
    except ImportError:
        print("Pillow unavailable: visual hard-negative fingerprints were skipped", flush=True)
        return cards

    def fingerprint(card: dict) -> tuple[str, dict | None, str | None]:
        card_id = card["cardId"]
        path = pathlib.Path(result_by_id[card_id]["localPath"])
        try:
            with Image.open(path) as image:
                image.load()
                if "transparency" in image.info or image.mode in {"RGBA", "LA"}:
                    rgba = image.convert("RGBA")
                    background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
                    background.alpha_composite(rgba)
                    rgb = background.convert("RGB")
                else:
                    rgb = image.convert("RGB")
                mean_rgb = [round(value, 2) for value in ImageStat.Stat(rgb.resize((32, 32))).mean]
                gray = list(rgb.convert("L").resize((9, 8), Image.Resampling.BILINEAR).tobytes())
            difference_hash = 0
            for row in range(8):
                for column in range(8):
                    difference_hash = (
                        (difference_hash << 1) | int(gray[row * 9 + column] > gray[row * 9 + column + 1])
                    )
            return card_id, {"meanRgb": mean_rgb, "differenceHash64": f"{difference_hash:016x}"}, None
        except Exception as error:  # A race/mutation after validation must not abort every identity.
            return card_id, None, f"visual fingerprint decode failed: {type(error).__name__}: {error}"

    fingerprints = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(workers, 16), thread_name_prefix="packdex-fingerprint") as executor:
        for card_id, value, error in executor.map(fingerprint, cards):
            if error:
                result_by_id[card_id]["status"] = "failed"
                result_by_id[card_id]["error"] = error
            else:
                fingerprints[card_id] = value
    return [{**card, "visualFingerprint": fingerprints[card["cardId"]]} for card in cards if card["cardId"] in fingerprints]


def build_hard_negatives(cards: list[dict], count: int) -> dict[str, list[dict]]:
    by_id = {card["cardId"]: card for card in cards}
    indexes: dict[str, defaultdict[str, list[str]]] = {
        name: defaultdict(list) for name in (
            "name", "set", "rarity", "series", "family", "layout", "printedTotal", "collectorBucket", "color", "artHash"
        )
    }
    for card in cards:
        card_id = card["cardId"]
        indexes["name"][str(card.get("normalizedName") or card.get("name") or "").casefold()].append(card_id)
        indexes["set"][str(card.get("setId") or "")].append(card_id)
        indexes["rarity"][str(card.get("rarity") or "").casefold()].append(card_id)
        indexes["series"][str(card.get("series") or "").casefold()].append(card_id)
        indexes["printedTotal"][str(card.get("printedTotal") or "")].append(card_id)
        prefix, _, bucket = collector_features(card.get("collectorNumber"))
        indexes["collectorBucket"][f"{prefix}:{bucket}"].append(card_id)
        visual = card.get("visualFingerprint") or {}
        mean_rgb = visual.get("meanRgb") or []
        if len(mean_rgb) == 3:
            indexes["color"][":".join(str(min(7, int(value) // 32)) for value in mean_rgb)].append(card_id)
        art_hash = str(visual.get("differenceHash64") or "")
        if art_hash:
            indexes["artHash"][art_hash[:3]].append(card_id)
        for token in card.get("nameFamilyTokens") or []:
            indexes["family"][str(token).casefold()].append(card_id)
        for token in card.get("layoutTokens") or []:
            indexes["layout"][str(token).casefold()].append(card_id)

    output: dict[str, list[dict]] = {}
    for card in cards:
        card_id = card["cardId"]
        candidate_ids: set[str] = set()
        name_key = str(card.get("normalizedName") or card.get("name") or "").casefold()
        set_key = str(card.get("setId") or "")
        rarity_key = str(card.get("rarity") or "").casefold()
        series_key = str(card.get("series") or "").casefold()
        total_key = str(card.get("printedTotal") or "")
        prefix, number, bucket = collector_features(card.get("collectorNumber"))
        candidate_ids.update(bounded_neighbors(indexes["name"][name_key], card_id, 128))
        candidate_ids.update(bounded_neighbors(indexes["set"][set_key], card_id, 96))
        candidate_ids.update(bounded_neighbors(indexes["rarity"][rarity_key], card_id, 24))
        candidate_ids.update(bounded_neighbors(indexes["series"][series_key], card_id, 16))
        candidate_ids.update(bounded_neighbors(indexes["printedTotal"][total_key], card_id, 24))
        candidate_ids.update(bounded_neighbors(indexes["collectorBucket"][f"{prefix}:{bucket}"], card_id, 32))
        visual = card.get("visualFingerprint") or {}
        mean_rgb = visual.get("meanRgb") or []
        art_hash = str(visual.get("differenceHash64") or "")
        if len(mean_rgb) == 3:
            color_key = ":".join(str(min(7, int(value) // 32)) for value in mean_rgb)
            candidate_ids.update(bounded_neighbors(indexes["color"][color_key], card_id, 64))
        if art_hash:
            candidate_ids.update(bounded_neighbors(indexes["artHash"][art_hash[:3]], card_id, 64))
        for token in card.get("nameFamilyTokens") or []:
            candidate_ids.update(bounded_neighbors(indexes["family"][str(token).casefold()], card_id, 48))
        for token in card.get("layoutTokens") or []:
            candidate_ids.update(bounded_neighbors(indexes["layout"][str(token).casefold()], card_id, 48))

        scored = []
        family = {str(value).casefold() for value in card.get("nameFamilyTokens") or []}
        layout = {str(value).casefold() for value in card.get("layoutTokens") or []}
        for candidate_id in candidate_ids:
            candidate = by_id[candidate_id]
            reasons = []
            score = 0
            candidate_name = str(candidate.get("normalizedName") or candidate.get("name") or "").casefold()
            if name_key and candidate_name == name_key:
                score += 120
                reasons.append("same-name")
            overlap = family.intersection(str(value).casefold() for value in candidate.get("nameFamilyTokens") or [])
            if overlap:
                score += min(54, 18 * len(overlap))
                reasons.append("same-name-family")
            if set_key and candidate.get("setId") == card.get("setId"):
                score += 55
                reasons.append("same-set")
            candidate_layout = {str(value).casefold() for value in candidate.get("layoutTokens") or []}
            if layout and layout.intersection(candidate_layout):
                score += 28
                reasons.append("same-layout")
            if rarity_key and str(candidate.get("rarity") or "").casefold() == rarity_key:
                score += 18
                reasons.append("same-rarity")
            if series_key and str(candidate.get("series") or "").casefold() == series_key:
                score += 8
                reasons.append("same-series")
            candidate_prefix, candidate_number, candidate_bucket = collector_features(candidate.get("collectorNumber"))
            if number is not None and candidate_number == number:
                score += 24
                reasons.append("same-collector-number")
            elif bucket is not None and prefix == candidate_prefix and bucket == candidate_bucket:
                score += 10
                reasons.append("near-collector-number")
            if total_key and str(candidate.get("printedTotal") or "") == total_key:
                score += 12
                reasons.append("same-printed-total")
            candidate_visual = candidate.get("visualFingerprint") or {}
            candidate_rgb = candidate_visual.get("meanRgb") or []
            if len(mean_rgb) == 3 and len(candidate_rgb) == 3:
                color_distance_squared = sum((float(left) - float(right)) ** 2 for left, right in zip(mean_rgb, candidate_rgb))
                if color_distance_squared <= 32.0**2:
                    score += 22
                    reasons.append("similar-colors")
            candidate_hash = str(candidate_visual.get("differenceHash64") or "")
            if art_hash and candidate_hash:
                hamming_distance = (int(art_hash, 16) ^ int(candidate_hash, 16)).bit_count()
                if hamming_distance == 0:
                    score += 90
                    reasons.append("same-artwork-fingerprint")
                elif hamming_distance <= 8:
                    score += 45
                    reasons.append("similar-artwork-fingerprint")
            if score:
                scored.append({"cardId": candidate_id, "score": score, "reasons": reasons})
        scored.sort(key=lambda item: (-item["score"], item["cardId"]))
        output[card_id] = scored[:count]
    return output


def write_json_atomic(path: pathlib.Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False) + "\n"
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(body, encoding="utf-8")
    os.replace(temporary, path)


def write_jsonl_atomic(path: pathlib.Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    os.replace(temporary, path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="artifacts/scanner-ai/catalog-manifest.json")
    parser.add_argument("--cache-dir", default="artifacts/scanner-ai/downloads/catalog")
    parser.add_argument("--output", default="artifacts/scanner-ai/generated/training-manifest.jsonl")
    parser.add_argument("--cache-report", default="artifacts/scanner-ai/reports/catalog-image-cache.json")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--validation-fraction", type=float, default=0.10)
    parser.add_argument("--views-per-identity", type=int, default=2)
    parser.add_argument("--hard-negative-count", type=int, default=32)
    parser.add_argument("--download", action="store_true", help="Download trusted PackDex card images into the ignored cache.")
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--max-bytes", type=int, default=20 * 1024 * 1024)
    parser.add_argument("--min-dimension", type=int, default=128)
    parser.add_argument("--limit", type=int, default=0, help="Bound downloads to the first N cards for a smoke run; 0 means all.")
    parser.add_argument("--progress-every", type=int, default=250)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not 0 < args.validation_fraction < 0.5:
        raise SystemExit("--validation-fraction must be greater than 0 and less than 0.5")
    if args.views_per_identity < 2:
        raise SystemExit("--views-per-identity must be at least 2 for supervised contrastive learning")
    if not 1 <= args.workers <= 64:
        raise SystemExit("--workers must be between 1 and 64")

    manifest_path = pathlib.Path(args.manifest)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest_cards = manifest["cards"]
    expected_checksum = manifest.get("cardsSha256") or manifest.get("checksum")
    if not expected_checksum:
        raise SystemExit("Catalog manifest is missing its required cards SHA-256")
    actual_checksum = sha256_bytes(canonical_json(manifest_cards).encode("utf-8"))
    if expected_checksum != actual_checksum:
        raise SystemExit(f"Catalog manifest checksum mismatch: expected {expected_checksum}, got {actual_checksum}")
    cards = sorted(manifest_cards, key=lambda item: item["cardId"])
    if int(manifest.get("count", len(cards))) != len(cards):
        raise SystemExit("Catalog manifest count does not match cards array")
    if len({card["cardId"] for card in cards}) != len(cards):
        raise SystemExit("Catalog manifest contains duplicate card IDs")

    selected_cards = cards[: args.limit] if args.limit else cards
    started_at = time.monotonic()
    results = []
    cache_dir = pathlib.Path(args.cache_dir)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers, thread_name_prefix="packdex-cache") as executor:
        futures = {
            executor.submit(
                cache_card, card, cache_dir, args.download, args.timeout, args.retries, args.max_bytes, args.min_dimension
            ): card["cardId"]
            for card in selected_cards
        }
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
            completed += 1
            if args.progress_every and (completed % args.progress_every == 0 or completed == len(futures)):
                valid_so_far = sum(item["status"] in {"cached", "downloaded"} for item in results)
                print(f"Validated {completed}/{len(futures)} images ({valid_so_far} valid)", flush=True)

    results.sort(key=lambda item: item["cardId"])
    result_by_id = {item["cardId"]: item for item in results}
    valid_cards = [card for card in selected_cards if result_by_id[card["cardId"]]["status"] in {"cached", "downloaded"}]
    valid_cards = add_visual_fingerprints(valid_cards, result_by_id, args.workers)
    hard_negatives = build_hard_negatives(valid_cards, args.hard_negative_count)
    validation_count = max(1, round(len(valid_cards) * args.validation_fraction)) if valid_cards else 0
    split_order = sorted(
        (card["cardId"] for card in valid_cards),
        key=lambda card_id: hashlib.sha256(f"{args.seed}:{card_id}".encode("utf-8")).digest(),
    )
    validation_ids = set(split_order[:validation_count])

    training_rows = []
    for card in valid_cards:
        cached = result_by_id[card["cardId"]]
        training_rows.append({
            **card,
            "localPath": cached["localPath"],
            "imageSha256": cached["sha256"],
            "imageWidth": cached["width"],
            "imageHeight": cached["height"],
            "split": "validation" if card["cardId"] in validation_ids else "train",
            "viewsPerIdentity": args.views_per_identity,
            "hardNegatives": hard_negatives[card["cardId"]],
        })

    output_path = pathlib.Path(args.output)
    write_jsonl_atomic(output_path, training_rows)
    valid_count = len(valid_cards)
    failed = [item for item in results if item["status"] == "failed"]
    missing = [item for item in results if item["status"] == "missing"]
    report = {
        "schemaVersion": 2,
        "source": "trusted-packdex-catalog-via-existing-asset-resolver",
        "catalogCardsSha256": actual_checksum,
        "parameters": {
            "seed": args.seed,
            "validationFraction": args.validation_fraction,
            "viewsPerIdentity": args.views_per_identity,
            "hardNegativeCount": args.hard_negative_count,
            "workers": args.workers,
            "timeoutSeconds": args.timeout,
            "retries": args.retries,
            "maxBytes": args.max_bytes,
            "minDimension": args.min_dimension,
            "limit": args.limit or None,
        },
        "counts": {
            "catalog": len(cards),
            "selected": len(selected_cards),
            "valid": valid_count,
            "downloaded": sum(item["status"] == "downloaded" for item in results),
            "cached": sum(item["status"] == "cached" for item in results),
            "failed": len(failed),
            "missing": len(missing),
            "trainIdentities": valid_count - validation_count,
            "validationIdentities": validation_count,
        },
        "totalBytes": sum(int(item.get("bytes", 0)) for item in results),
        "durationSeconds": round(time.monotonic() - started_at, 3),
        "items": results,
    }
    write_json_atomic(pathlib.Path(args.cache_report), report)
    print(
        f"Wrote {len(training_rows)} unique identities to {output_path}: "
        f"{valid_count - validation_count} train, {validation_count} unseen validation; "
        f"{len(failed)} failed, {len(missing)} missing"
    )


if __name__ == "__main__":
    main()
