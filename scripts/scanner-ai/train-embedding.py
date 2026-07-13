#!/usr/bin/env python3
"""Train one bounded PackDex MobileNetV3-Small metric embedder.

Every identity is a unique trusted PackDex card ID. Batches contain two
independently augmented views per identity and catalog-derived hard-negative
pairs. Validation identities are completely unseen during optimization. Pixel
holdout fixtures are outside the only allowed image root and cannot enter this
pipeline.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import pathlib
import platform
import random
import time
from dataclasses import dataclass
from typing import Iterable


IMAGE_SIZE = 224
DEFAULT_SEED = 20260713
CATALOG_BOUND_FIELDS = (
    "name", "normalizedName", "nameFamilyTokens", "layoutTokens", "setId", "setName",
    "collectorNumber", "printedTotal", "rarity", "series", "imageUrl",
)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def read_rows(path: pathlib.Path, allowed_image_root: pathlib.Path, verify_checksums: bool = True) -> list[dict]:
    allowed_root = allowed_image_root.resolve()
    rows = []
    seen = set()
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            card_id = str(row.get("cardId") or "")
            if not card_id or card_id in seen:
                raise ValueError(f"manifest line {line_number} has a missing or duplicate cardId")
            seen.add(card_id)
            if row.get("split") not in {"train", "validation"}:
                raise ValueError(f"manifest line {line_number} has invalid split {row.get('split')!r}")
            image_path = pathlib.Path(row.get("localPath") or "").resolve()
            try:
                image_path.relative_to(allowed_root)
            except ValueError as error:
                raise ValueError(f"manifest path is outside the trusted catalog cache: {image_path}") from error
            if not image_path.is_file():
                raise ValueError(f"trusted catalog image is missing: {image_path}")
            if verify_checksums:
                digest = sha256_file(image_path)
                if digest != row.get("imageSha256"):
                    raise ValueError(f"image checksum mismatch for {card_id}")
            row["localPath"] = str(image_path)
            rows.append(row)
    return rows


def bind_rows_to_catalog(rows: list[dict], path: pathlib.Path, allow_partial: bool = False) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    cards = manifest.get("cards")
    if not isinstance(cards, list):
        raise ValueError("trusted catalog manifest is missing its cards array")
    actual_checksum = hashlib.sha256(canonical_json(cards).encode("utf-8")).hexdigest()
    expected_checksum = manifest.get("cardsSha256")
    if not expected_checksum or actual_checksum != expected_checksum:
        raise ValueError("trusted catalog manifest cards checksum does not validate")
    if int(manifest.get("count", -1)) != len(cards):
        raise ValueError("trusted catalog manifest count does not match its cards array")
    catalog_by_id = {str(card.get("cardId") or ""): card for card in cards}
    if "" in catalog_by_id or len(catalog_by_id) != len(cards):
        raise ValueError("trusted catalog manifest contains a missing or duplicate cardId")
    row_by_id = {row["cardId"]: row for row in rows}
    catalog_ids = set(catalog_by_id)
    row_ids = set(row_by_id)
    unknown = sorted(row_ids - catalog_ids)
    missing = sorted(catalog_ids - row_ids)
    if unknown or (missing and not allow_partial):
        raise ValueError(
            f"training identities do not exactly cover the trusted catalog: "
            f"{len(unknown)} unknown, {len(missing)} missing"
        )
    for card_id, row in row_by_id.items():
        trusted = catalog_by_id[card_id]
        mismatched = [field for field in CATALOG_BOUND_FIELDS if row.get(field) != trusted.get(field)]
        if mismatched:
            raise ValueError(f"training row {card_id} differs from trusted catalog fields: {', '.join(mismatched)}")
        negatives = hard_negative_ids(row)
        if card_id in negatives or any(candidate not in row_by_id for candidate in negatives):
            raise ValueError(f"training row {card_id} contains a self or unknown hard-negative identity")
    return {
        "catalogCardsSha256": actual_checksum,
        "catalogManifestSha256": sha256_file(path),
        "catalogIdentityCount": len(cards),
        "trainingIdentityCount": len(rows),
        "partialCatalogExplicitlyAllowed": bool(allow_partial),
    }


def hard_negative_ids(row: dict) -> list[str]:
    values = row.get("hardNegatives") or row.get("hardNegativeIds") or []
    return [str(item.get("cardId")) if isinstance(item, dict) else str(item) for item in values]


def plan_identity_batches(rows: list[dict], identities_per_batch: int, seed: int) -> list[list[str]]:
    """Use each identity once, pairing catalog hard negatives when available."""
    if identities_per_batch < 2:
        raise ValueError("identities_per_batch must be at least 2")
    by_id = {row["cardId"]: row for row in rows}
    rng = random.Random(seed)
    ordered = list(by_id)
    rng.shuffle(ordered)
    remaining = set(ordered)
    batches: list[list[str]] = []
    cursor = 0

    def take_anchor() -> str | None:
        nonlocal cursor
        while cursor < len(ordered):
            value = ordered[cursor]
            cursor += 1
            if value in remaining:
                remaining.remove(value)
                return value
        return None

    while remaining:
        batch = []
        while len(batch) < identities_per_batch and remaining:
            anchor = take_anchor()
            if anchor is None:
                break
            batch.append(anchor)
            candidates = [value for value in hard_negative_ids(by_id[anchor]) if value in remaining]
            if candidates and len(batch) < identities_per_batch:
                # Rotate deterministically across epochs instead of always using rank 0.
                candidate = candidates[rng.randrange(min(4, len(candidates)))]
                remaining.remove(candidate)
                batch.append(candidate)
        if batch:
            batches.append(batch)

    # A one-identity final batch has no negatives; merge it into the preceding batch.
    if len(batches) > 1 and len(batches[-1]) == 1:
        batches[-2].extend(batches.pop())
    return batches


def count_hard_pairs(batches: Iterable[list[str]], by_id: dict[str, dict]) -> tuple[int, int]:
    pairs = 0
    possible = 0
    for batch in batches:
        batch_set = set(batch)
        for card_id in batch:
            possible += 1
            if any(candidate in batch_set for candidate in hard_negative_ids(by_id[card_id])):
                pairs += 1
    return pairs, possible


def split_summary(rows: list[dict], identities_per_batch: int, seed: int, views_per_identity: int = 2) -> dict:
    train = [row for row in rows if row["split"] == "train"]
    validation = [row for row in rows if row["split"] == "validation"]
    train_ids = {row["cardId"] for row in train}
    validation_ids = {row["cardId"] for row in validation}
    overlap = sorted(train_ids.intersection(validation_ids))
    batches = plan_identity_batches(train, identities_per_batch, seed)
    hard_pairs, possible = count_hard_pairs(batches, {row["cardId"]: row for row in train})
    return {
        "identities": len(rows),
        "trainIdentities": len(train),
        "validationIdentities": len(validation),
        "identityOverlap": overlap,
        "trainBatches": len(batches),
        "viewsPerIdentity": views_per_identity,
        "imagesPerFullEpoch": len(train) * views_per_identity,
        "identitiesWithInBatchHardNegative": hard_pairs,
        "hardNegativeCoverage": hard_pairs / possible if possible else 0.0,
    }


class IdentityBatchStream:
    def __init__(self, rows: list[dict], identities_per_batch: int, views: int, seed: int, max_steps: int = 0):
        self.rows = rows
        self.by_id = {row["cardId"]: row for row in rows}
        self.labels = {card_id: index for index, card_id in enumerate(sorted(self.by_id))}
        self.identities_per_batch = identities_per_batch
        self.views = views
        self.seed = seed
        self.max_steps = max_steps
        self.epoch = 0

    @property
    def full_steps(self) -> int:
        return len(plan_identity_batches(self.rows, self.identities_per_batch, self.seed))

    @property
    def steps(self) -> int:
        return min(self.full_steps, self.max_steps) if self.max_steps else self.full_steps

    def __call__(self):
        import numpy as np

        while True:
            epoch_index = self.epoch
            self.epoch += 1
            epoch_seed = self.seed + epoch_index * 1_000_003
            batches = plan_identity_batches(self.rows, self.identities_per_batch, epoch_seed)
            if self.max_steps:
                batches = batches[: self.max_steps]
            rng = random.Random(epoch_seed ^ 0x5A17)
            for batch in batches:
                paths, labels, seeds = [], [], []
                for card_id in batch:
                    for _ in range(self.views):
                        paths.append(self.by_id[card_id]["localPath"])
                        labels.append(self.labels[card_id])
                        seeds.append([rng.randrange(1, 2**31 - 1), rng.randrange(1, 2**31 - 1)])
                yield np.asarray(paths, dtype=str), np.asarray(labels, dtype=np.int32), np.asarray(seeds, dtype=np.int32)


def build_augmenter(tf):
    size = IMAGE_SIZE
    x_grid, y_grid = tf.meshgrid(tf.linspace(-1.0, 1.0, size), tf.linspace(-1.0, 1.0, size))

    def random_value(seed, low, high):
        return tf.random.stateless_uniform([], seed, low, high, dtype=tf.float32)

    def projective(image, seeds, strength):
        angle = random_value(seeds[0], -0.11 * strength, 0.11 * strength)
        scale = random_value(seeds[1], 0.91, 1.10)
        shear = random_value(seeds[2], -0.045 * strength, 0.045 * strength)
        tx = random_value(seeds[3], -10.0 * strength, 10.0 * strength)
        ty = random_value(seeds[4], -10.0 * strength, 10.0 * strength)
        perspective_x = random_value(seeds[5], -0.00028 * strength, 0.00028 * strength)
        perspective_y = random_value(seeds[6], -0.00028 * strength, 0.00028 * strength)
        cosine, sine = tf.cos(angle) * scale, tf.sin(angle) * scale
        center = (size - 1.0) / 2.0
        transform = tf.stack([
            cosine,
            -sine + shear,
            center - cosine * center + (sine - shear) * center + tx,
            sine,
            cosine,
            center - sine * center - cosine * center + ty,
            perspective_x,
            perspective_y,
        ])[None, :]
        return tf.raw_ops.ImageProjectiveTransformV3(
            images=image[None, ...], transforms=transform, output_shape=[size, size],
            interpolation="BILINEAR", fill_mode="REFLECT", fill_value=0.0,
        )[0]

    def distance_background(image, seeds, strength):
        inset = tf.cast(tf.round(random_value(seeds[0], 0.0, 22.0 * strength)), tf.int32)
        inner = size - 2 * inset
        card = tf.image.resize(image, [inner, inner], antialias=True)
        background_color = tf.random.stateless_uniform([1, 1, 3], seeds[1], 0.08, 0.65)
        background = tf.broadcast_to(background_color, [size, size, 3])
        background += tf.random.stateless_normal([size, size, 1], seeds[2], stddev=0.025)
        padded = tf.pad(card, [[inset, inset], [inset, inset], [0, 0]])
        mask = tf.pad(tf.ones([inner, inner, 1]), [[inset, inset], [inset, inset], [0, 0]])
        return padded * mask + background * (1.0 - mask)

    def lighting(image, seeds, strength):
        image = tf.image.stateless_random_brightness(image, max_delta=0.20 * strength, seed=seeds[0])
        image = tf.image.stateless_random_contrast(image, lower=1.0 - 0.30 * strength, upper=1.0 + 0.30 * strength, seed=seeds[1])
        image = tf.image.stateless_random_saturation(image, lower=1.0 - 0.22 * strength, upper=1.0 + 0.20 * strength, seed=seeds[2])
        white_balance = tf.random.stateless_uniform([3], seeds[3], 1.0 - 0.13 * strength, 1.0 + 0.13 * strength)
        image *= white_balance
        shadow_direction = random_value(seeds[4], -1.0, 1.0)
        shadow = 1.0 - random_value(seeds[5], 0.0, 0.32 * strength) * tf.clip_by_value((x_grid * shadow_direction + 1.0) / 2.0, 0.0, 1.0)
        image *= shadow[..., None]
        return image

    def glare_and_sleeve(image, seeds, strength):
        slope = random_value(seeds[0], -0.9, 0.9)
        center = random_value(seeds[1], -1.2, 1.2)
        width = random_value(seeds[2], 0.06, 0.24)
        stripe = tf.exp(-tf.square((x_grid + slope * y_grid - center) / width))
        glare_alpha = random_value(seeds[3], 0.0, 0.26 * strength)
        image += stripe[..., None] * glare_alpha
        sleeve_alpha = random_value(seeds[4], 0.0, 0.055 * strength)
        sleeve_tint = tf.reshape(tf.constant([0.70, 0.86, 1.0], tf.float32), [1, 1, 3])
        image = image * (1.0 - sleeve_alpha) + sleeve_tint * sleeve_alpha
        return image

    def blur_noise_jpeg(image, seeds, strength):
        def defocus():
            return tf.nn.avg_pool2d(image[None, ...], ksize=3, strides=1, padding="SAME")[0]

        image = tf.cond(random_value(seeds[0], 0.0, 1.0) < 0.22 * strength, defocus, lambda: image)
        horizontal = tf.reshape(tf.constant([
            0, 0, 0, 0, 0,
            0, 0, 0, 0, 0,
            .12, .20, .36, .20, .12,
            0, 0, 0, 0, 0,
            0, 0, 0, 0, 0,
        ], tf.float32), [5, 5, 1, 1])
        vertical = tf.transpose(horizontal, [1, 0, 2, 3])
        kernel = tf.cond(random_value(seeds[1], 0.0, 1.0) < 0.5, lambda: horizontal, lambda: vertical)
        kernel = tf.tile(kernel, [1, 1, 3, 1])
        image = tf.cond(
            random_value(seeds[2], 0.0, 1.0) < 0.16 * strength,
            lambda: tf.nn.depthwise_conv2d(image[None, ...], kernel, [1, 1, 1, 1], "SAME")[0],
            lambda: image,
        )
        noise = tf.random.stateless_normal(tf.shape(image), seeds[3], stddev=0.018 * strength)
        image = tf.clip_by_value(image + noise, 0.0, 1.0)
        uint8_image = tf.image.convert_image_dtype(image, tf.uint8, saturate=True)
        uint8_image = tf.image.stateless_random_jpeg_quality(
            uint8_image, min_jpeg_quality=int(55 + 20 * (1.0 - strength)),
            max_jpeg_quality=96, seed=seeds[4],
        )
        return tf.image.convert_image_dtype(uint8_image, tf.float32)

    def edge_obstruction(image, seeds, strength):
        thickness = random_value(seeds[0], 0.015, 0.075) * strength
        edge = tf.random.stateless_uniform([], seeds[1], 0, 4, dtype=tf.int32)
        masks = [x_grid < (-1.0 + 2.0 * thickness), x_grid > (1.0 - 2.0 * thickness),
                 y_grid < (-1.0 + 2.0 * thickness), y_grid > (1.0 - 2.0 * thickness)]
        mask = tf.cast(tf.switch_case(edge, [lambda value=value: value for value in masks]), tf.float32)[..., None]
        color = tf.random.stateless_uniform([1, 1, 3], seeds[2], 0.01, 0.35)
        alpha = random_value(seeds[3], 0.25, 0.78)
        obstructed = image * (1.0 - mask * alpha) + color * mask * alpha
        return tf.cond(random_value(seeds[4], 0.0, 1.0) < 0.22 * strength, lambda: obstructed, lambda: image)

    def decode(path):
        image = tf.io.decode_image(tf.io.read_file(path), channels=0, expand_animations=False)
        image.set_shape([None, None, None])
        image = tf.cast(image, tf.float32) / 255.0
        channels = tf.shape(image)[-1]

        def grayscale():
            return tf.repeat(image, 3, axis=-1)

        def grayscale_alpha():
            gray, alpha = image[..., :1], image[..., 1:2]
            return tf.repeat(gray, 3, axis=-1) * alpha + (1.0 - alpha)

        def rgb_alpha():
            return image[..., :3] * image[..., 3:4] + (1.0 - image[..., 3:4])

        image = tf.case(
            [(tf.equal(channels, 1), grayscale), (tf.equal(channels, 2), grayscale_alpha), (tf.equal(channels, 4), rgb_alpha)],
            default=lambda: image[..., :3], exclusive=True,
        )
        image.set_shape([None, None, 3])
        image = tf.image.resize(image, [size, size], method="bicubic", antialias=True)
        return tf.clip_by_value(image, 0.0, 1.0)

    def augment(path, seed, training=True):
        image = decode(path)
        seeds = tf.random.experimental.stateless_split(seed, 34)
        strength = 1.0 if training else 0.58
        image = distance_background(image, seeds[0:3], strength)
        image = projective(image, seeds[3:10], strength)
        image = lighting(image, seeds[10:16], strength)
        image = glare_and_sleeve(image, seeds[16:21], strength)
        image = edge_obstruction(image, seeds[21:26], strength)
        image = blur_noise_jpeg(image, seeds[26:31], strength)
        return tf.clip_by_value(image, 0.0, 1.0)

    return decode, augment


def make_dataset(tf, stream: IdentityBatchStream, training: bool, deterministic: bool = True):
    _, augment = build_augmenter(tf)
    signature = (
        tf.TensorSpec([None], tf.string),
        tf.TensorSpec([None], tf.int32),
        tf.TensorSpec([None, 2], tf.int32),
    )
    dataset = tf.data.Dataset.from_generator(stream, output_signature=signature)

    def load_batch(paths, labels, seeds):
        images = tf.map_fn(
            lambda item: augment(item[0], item[1], training=training),
            (paths, seeds),
            fn_output_signature=tf.TensorSpec([IMAGE_SIZE, IMAGE_SIZE, 3], tf.float32),
            parallel_iterations=16,
        )
        return images, labels

    dataset = dataset.map(load_batch, num_parallel_calls=tf.data.AUTOTUNE, deterministic=deterministic)
    options = tf.data.Options()
    options.experimental_deterministic = deterministic
    return dataset.with_options(options).prefetch(1)


def build_embedder(tf, dimensions: int, weights: str | None):
    backbone = tf.keras.applications.MobileNetV3Small(
        input_shape=(IMAGE_SIZE, IMAGE_SIZE, 3), include_top=False, weights=weights,
        pooling="avg", include_preprocessing=False,
    )
    inputs = tf.keras.Input(shape=(IMAGE_SIZE, IMAGE_SIZE, 3), dtype=tf.float32, name="card_image")
    # Public model contract is float32 [0,1]; MobileNetV3 without preprocessing expects [-1,1].
    x = tf.keras.layers.Rescaling(2.0, offset=-1.0, name="mobilenet_input")(inputs)
    x = backbone(x)
    x = tf.keras.layers.Dense(256, activation="relu", use_bias=False, name="projection_hidden")(x)
    x = tf.keras.layers.BatchNormalization(name="projection_batch_norm")(x)
    x = tf.keras.layers.Dropout(0.10, name="projection_dropout")(x)
    x = tf.keras.layers.Dense(dimensions, use_bias=False, name="embedding_projection")(x)
    outputs = tf.keras.layers.UnitNormalization(axis=-1, name="embedding")(x)
    return tf.keras.Model(inputs, outputs, name="packdex_mobilenet_v3_small_embedder"), backbone


def supervised_contrastive_loss(tf, labels, embeddings, temperature: float):
    labels = tf.reshape(labels, [-1, 1])
    same = tf.equal(labels, tf.transpose(labels))
    not_self = ~tf.eye(tf.shape(labels)[0], dtype=tf.bool)
    positive = same & not_self
    logits = tf.matmul(embeddings, embeddings, transpose_b=True) / temperature
    logits = logits - tf.reduce_max(tf.where(not_self, logits, tf.constant(-1e9, logits.dtype)), axis=1, keepdims=True)
    exp_logits = tf.exp(logits) * tf.cast(not_self, logits.dtype)
    log_probability = logits - tf.math.log(tf.reduce_sum(exp_logits, axis=1, keepdims=True) + 1e-9)
    positive_count = tf.reduce_sum(tf.cast(positive, logits.dtype), axis=1)
    per_anchor = -tf.reduce_sum(tf.cast(positive, logits.dtype) * log_probability, axis=1) / tf.maximum(positive_count, 1.0)
    valid = positive_count > 0
    return tf.reduce_mean(tf.boolean_mask(per_anchor, valid))


def batch_hard_triplet_loss(tf, labels, embeddings, margin: float):
    labels = tf.reshape(labels, [-1, 1])
    same = tf.equal(labels, tf.transpose(labels))
    not_self = ~tf.eye(tf.shape(labels)[0], dtype=tf.bool)
    positive = same & not_self
    negative = ~same
    distance = 1.0 - tf.matmul(embeddings, embeddings, transpose_b=True)
    hardest_positive = tf.reduce_max(tf.where(positive, distance, tf.constant(-1e9, distance.dtype)), axis=1)
    hardest_negative = tf.reduce_min(tf.where(negative, distance, tf.constant(1e9, distance.dtype)), axis=1)
    valid = tf.reduce_any(positive, axis=1) & tf.reduce_any(negative, axis=1)
    losses = tf.nn.relu(hardest_positive - hardest_negative + margin)
    return tf.reduce_mean(tf.boolean_mask(losses, valid))


def make_metric_model(tf, embedder, temperature: float, triplet_margin: float, triplet_weight: float):
    class MetricModel(tf.keras.Model):
        def __init__(self):
            super().__init__(name="packdex_metric_trainer")
            self.embedder = embedder
            self.loss_tracker = tf.keras.metrics.Mean(name="loss")
            self.supcon_tracker = tf.keras.metrics.Mean(name="supcon_loss")
            self.triplet_tracker = tf.keras.metrics.Mean(name="triplet_loss")

        @property
        def metrics(self):
            return [self.loss_tracker, self.supcon_tracker, self.triplet_tracker]

        def call(self, inputs, training=False):
            return self.embedder(inputs, training=training)

        def compute_losses(self, images, labels, training):
            embeddings = self.embedder(images, training=training)
            supcon = supervised_contrastive_loss(tf, labels, embeddings, temperature)
            triplet = batch_hard_triplet_loss(tf, labels, embeddings, triplet_margin)
            regularization = tf.add_n(self.embedder.losses) if self.embedder.losses else 0.0
            return supcon + triplet_weight * triplet + regularization, supcon, triplet

        def train_step(self, data):
            images, labels = data
            with tf.GradientTape() as tape:
                loss, supcon, triplet = self.compute_losses(images, labels, True)
                tf.debugging.check_numerics(loss, "metric-learning loss became non-finite")
            gradients = tape.gradient(loss, self.embedder.trainable_variables)
            gradient_pairs = []
            for gradient, variable in zip(gradients, self.embedder.trainable_variables):
                if gradient is not None:
                    tf.debugging.check_numerics(gradient, f"gradient became non-finite for {variable.name}")
                    gradient_pairs.append((gradient, variable))
            self.optimizer.apply_gradients(gradient_pairs)
            self.loss_tracker.update_state(loss)
            self.supcon_tracker.update_state(supcon)
            self.triplet_tracker.update_state(triplet)
            return {metric.name: metric.result() for metric in self.metrics}

        def test_step(self, data):
            images, labels = data
            loss, supcon, triplet = self.compute_losses(images, labels, False)
            tf.debugging.check_numerics(loss, "validation loss became non-finite")
            self.loss_tracker.update_state(loss)
            self.supcon_tracker.update_state(supcon)
            self.triplet_tracker.update_state(triplet)
            return {metric.name: metric.result() for metric in self.metrics}

    return MetricModel()


def configure_backbone(tf, backbone, unfreeze_layers: int) -> None:
    backbone.trainable = True
    cutoff = max(0, len(backbone.layers) - unfreeze_layers)
    for index, layer in enumerate(backbone.layers):
        layer.trainable = index >= cutoff and not isinstance(layer, tf.keras.layers.BatchNormalization)


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


def build_callbacks(
    tf,
    embedder,
    optimizer,
    checkpoint_root: pathlib.Path,
    stage: str,
    deadline: float,
    checkpoint_every: int,
    run_fingerprint: str,
    initial_step: int = 0,
):
    checkpoint_dir = checkpoint_root / stage
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    checkpoint = tf.train.Checkpoint(embedder=embedder, optimizer=optimizer)
    manager = tf.train.CheckpointManager(checkpoint, str(checkpoint_dir / "state"), max_to_keep=1)

    class BoundedCheckpoint(tf.keras.callbacks.Callback):
        def __init__(self):
            super().__init__()
            self.global_step = initial_step
            self.wall_time_reached = False
            self.non_finite_reached = False

        def logs_are_finite(self, logs) -> bool:
            for value in (logs or {}).values():
                try:
                    if not math.isfinite(float(value)):
                        return False
                except (TypeError, ValueError):
                    continue
            return True

        def save(self, stage_completed: bool = False):
            prefix = manager.save(checkpoint_number=self.global_step)
            write_json_atomic(checkpoint_root / "resume.json", {
                "schemaVersion": 2,
                "runFingerprint": run_fingerprint,
                "stage": stage,
                "stageCompleted": stage_completed,
                "globalStep": self.global_step,
                "checkpoint": pathlib.Path(prefix).resolve().as_posix(),
                "savedAtUnixSeconds": time.time(),
                "note": "Resume restores model and optimizer state, then restarts this bounded stage.",
            })

        def check_logs(self, logs):
            if not self.logs_are_finite(logs):
                self.non_finite_reached = True
                self.model.stop_training = True

        def on_train_batch_end(self, batch, logs=None):
            self.global_step += 1
            self.check_logs(logs)
            if self.non_finite_reached:
                return
            if checkpoint_every and self.global_step % checkpoint_every == 0:
                self.save()
            if time.monotonic() >= deadline:
                self.wall_time_reached = True
                self.save()
                self.model.stop_training = True

        def on_test_batch_end(self, batch, logs=None):
            self.check_logs(logs)

        def on_train_end(self, logs=None):
            self.check_logs(logs)
            if not self.non_finite_reached:
                self.save()

        def mark_stage_completed(self):
            self.save(stage_completed=True)

    bounded = BoundedCheckpoint()
    return bounded, [
        bounded,
        tf.keras.callbacks.TerminateOnNaN(),
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(checkpoint_dir / "best.weights.h5"), monitor="val_loss", mode="min",
            save_best_only=True, save_weights_only=True,
        ),
        tf.keras.callbacks.EarlyStopping(monitor="val_loss", mode="min", patience=1, restore_best_weights=True),
    ]


def evaluate_unseen_retrieval(tf, embedder, rows: list[dict], batch_size: int, seed: int) -> dict:
    import numpy as np

    decode, augment = build_augmenter(tf)
    paths = [row["localPath"] for row in rows]
    seeds = np.asarray([[seed + index * 2 + 1, seed + index * 2 + 2] for index in range(len(paths))], np.int32)
    path_dataset = tf.data.Dataset.from_tensor_slices(paths)
    reference_dataset = path_dataset.map(decode, num_parallel_calls=tf.data.AUTOTUNE).batch(batch_size).prefetch(1)
    query_dataset = tf.data.Dataset.from_tensor_slices((paths, seeds)).map(
        lambda path, item_seed: augment(path, item_seed, training=False), num_parallel_calls=tf.data.AUTOTUNE,
    ).batch(batch_size).prefetch(1)
    references = embedder.predict(reference_dataset, verbose=0)
    queries = embedder.predict(query_dataset, verbose=0)
    similarities = queries @ references.T
    order = np.argsort(-similarities, axis=1)
    expected = np.arange(len(rows))
    ranks = np.argmax(order == expected[:, None], axis=1) + 1
    positive = similarities[expected, expected]
    masked = similarities.copy()
    masked[expected, expected] = -np.inf
    margin = positive - np.max(masked, axis=1)
    return {
        "identityCount": len(rows),
        "top1": float(np.mean(ranks == 1)),
        "top3": float(np.mean(ranks <= 3)),
        "meanRank": float(np.mean(ranks)),
        "medianRank": float(np.median(ranks)),
        "meanPositiveCosine": float(np.mean(positive)),
        "meanWinnerMargin": float(np.mean(margin)),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="artifacts/scanner-ai/generated/training-manifest.jsonl")
    parser.add_argument("--catalog-manifest", default="artifacts/scanner-ai/catalog-manifest.json")
    parser.add_argument("--allowed-image-root", default="artifacts/scanner-ai/downloads/catalog")
    parser.add_argument("--output", default="artifacts/scanner-ai/models/packdex-card-embedder.keras")
    parser.add_argument("--checkpoint-dir", default="artifacts/scanner-ai/models/checkpoints")
    parser.add_argument("--report", default="artifacts/scanner-ai/reports/training-report.json")
    parser.add_argument("--completion-sentinel", default="artifacts/scanner-ai/models/training-complete.json")
    parser.add_argument("--dimensions", type=int, choices=[128, 256], default=128)
    parser.add_argument("--identities-per-batch", type=int, default=8)
    parser.add_argument("--views-per-identity", type=int, default=2)
    parser.add_argument("--frozen-epochs", type=int, default=1)
    parser.add_argument("--unfrozen-epochs", type=int, default=2)
    parser.add_argument("--unfreeze-layers", type=int, default=40)
    parser.add_argument("--learning-rate", type=float, default=2e-4)
    parser.add_argument("--fine-tune-learning-rate", type=float, default=3e-5)
    parser.add_argument("--weight-decay", type=float, default=1e-5)
    parser.add_argument("--temperature", type=float, default=0.12)
    parser.add_argument("--triplet-margin", type=float, default=0.18)
    parser.add_argument("--triplet-weight", type=float, default=0.5)
    parser.add_argument("--max-wall-minutes", type=float, default=180.0)
    parser.add_argument("--max-steps-per-epoch", type=int, default=0)
    parser.add_argument("--max-validation-steps", type=int, default=0)
    parser.add_argument("--checkpoint-every-steps", type=int, default=500)
    parser.add_argument("--retrieval-batch-size", type=int, default=64)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--weights", choices=["imagenet", "none"], default="imagenet")
    parser.add_argument("--resume", action="store_true")
    integrity = parser.add_mutually_exclusive_group()
    integrity.add_argument("--verify-image-checksums", dest="verify_image_checksums", action="store_true", default=True)
    integrity.add_argument(
        "--skip-image-checksums", dest="verify_image_checksums", action="store_false",
        help="Unsafe smoke-only override; production training verifies every trusted image SHA-256 by default.",
    )
    parser.add_argument(
        "--allow-partial-catalog", action="store_true",
        help="Explicit smoke-only override; production training requires exact trusted-catalog coverage.",
    )
    parser.add_argument("--skip-retrieval-eval", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="Validate identities and paired sampler without importing TensorFlow.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.views_per_identity < 2:
        raise SystemExit("--views-per-identity must be at least 2")
    if args.identities_per_batch < 2:
        raise SystemExit("--identities-per-batch must be at least 2")
    if args.max_wall_minutes <= 0:
        raise SystemExit("--max-wall-minutes must be positive")

    manifest_path = pathlib.Path(args.manifest)
    rows = read_rows(manifest_path, pathlib.Path(args.allowed_image_root), args.verify_image_checksums)
    catalog_binding = bind_rows_to_catalog(rows, pathlib.Path(args.catalog_manifest), args.allow_partial_catalog)
    summary = split_summary(rows, args.identities_per_batch, args.seed, args.views_per_identity)
    if summary["identityOverlap"]:
        raise SystemExit("Training and validation card identities overlap")
    print(json.dumps({**summary, **catalog_binding}, indent=2))
    if args.dry_run:
        return

    # A new or resumed attempt invalidates the prior success marker immediately.
    # The last good model file may remain for recovery, but export must fail closed
    # until this exact run finishes and publishes a new sentinel.
    pathlib.Path(args.completion_sentinel).unlink(missing_ok=True)

    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "1")
    import tensorflow as tf

    tf.keras.utils.set_random_seed(args.seed)
    tf.config.experimental.enable_op_determinism()
    train_rows = [row for row in rows if row["split"] == "train"]
    validation_rows = [row for row in rows if row["split"] == "validation"]
    train_stream = IdentityBatchStream(
        train_rows, args.identities_per_batch, args.views_per_identity, args.seed, args.max_steps_per_epoch,
    )
    validation_stream = IdentityBatchStream(
        validation_rows, args.identities_per_batch, args.views_per_identity, args.seed + 97, args.max_validation_steps,
    )
    train_dataset = make_dataset(tf, train_stream, training=True)
    validation_dataset = make_dataset(tf, validation_stream, training=False)
    weights = None if args.weights.casefold() == "none" else args.weights
    embedder, backbone = build_embedder(tf, args.dimensions, weights)
    checkpoint_dir = pathlib.Path(args.checkpoint_dir)
    training_manifest_sha256 = sha256_file(manifest_path)
    requirements_path = pathlib.Path(__file__).with_name("requirements-training.txt")
    implementation_binding = {
        "trainEmbeddingSha256": sha256_file(pathlib.Path(__file__)),
        "requirementsSha256": sha256_file(requirements_path),
        "pythonVersion": platform.python_version(),
        "tensorflowVersion": tf.__version__,
        "kerasVersion": str(getattr(tf.keras, "__version__", "unknown")),
    }
    run_parameters = {
        key: value for key, value in vars(args).items()
        if key not in {
            "resume", "dry_run", "output", "report", "completion_sentinel", "checkpoint_dir",
            "max_wall_minutes", "checkpoint_every_steps",
        }
    }
    run_fingerprint = hashlib.sha256(canonical_json({
        "parameters": run_parameters,
        "trainingManifestSha256": training_manifest_sha256,
        "catalogCardsSha256": catalog_binding["catalogCardsSha256"],
        "implementation": implementation_binding,
    }).encode("utf-8")).hexdigest()
    resume_info = None
    if args.resume:
        resume_path = checkpoint_dir / "resume.json"
        if not resume_path.is_file():
            raise SystemExit(f"--resume was requested but no stage-aware checkpoint exists at {resume_path}")
        resume_info = json.loads(resume_path.read_text(encoding="utf-8"))
        if resume_info.get("runFingerprint") != run_fingerprint:
            raise SystemExit("resume checkpoint does not match this data and training configuration")
        if resume_info.get("stage") not in {"frozen", "partial-unfreeze"}:
            raise SystemExit("resume checkpoint has an unknown training stage")
        checkpoint_prefix = pathlib.Path(str(resume_info.get("checkpoint") or ""))
        if not pathlib.Path(f"{checkpoint_prefix}.index").is_file():
            raise SystemExit(f"resume checkpoint is incomplete: {checkpoint_prefix}")
        if resume_info.get("stageCompleted"):
            # Carry the completed stage's model state into the next stage (or export).
            status = tf.train.Checkpoint(embedder=embedder).restore(str(checkpoint_prefix))
            status.assert_existing_objects_matched()
            status.expect_partial()
            print(f"Restored completed {resume_info['stage']} model state from {checkpoint_prefix}")

    started = time.monotonic()
    deadline = started + args.max_wall_minutes * 60.0
    stage_histories = []
    wall_reached = False
    stage_order = {"frozen": 0, "partial-unfreeze": 1}

    def should_run_stage(name: str) -> bool:
        if resume_info is None:
            return True
        current = stage_order[name]
        resumed = stage_order[resume_info["stage"]]
        if current < resumed:
            return False
        if current == resumed and resume_info.get("stageCompleted"):
            return False
        return True

    def assert_finite_embedder() -> None:
        for variable in embedder.weights:
            tf.debugging.check_numerics(variable, f"model weight became non-finite: {variable.name}")

    def run_stage(name: str, epochs: int, learning_rate: float):
        nonlocal wall_reached
        if epochs <= 0 or not should_run_stage(name):
            return
        if time.monotonic() >= deadline:
            wall_reached = True
            return
        trainer = make_metric_model(tf, embedder, args.temperature, args.triplet_margin, args.triplet_weight)
        trainer(tf.zeros([1, IMAGE_SIZE, IMAGE_SIZE, 3], tf.float32), training=False)
        optimizer = tf.keras.optimizers.AdamW(learning_rate=learning_rate, weight_decay=args.weight_decay)
        trainer.compile(optimizer=optimizer)
        optimizer.build(embedder.trainable_variables)
        initial_step = 0
        if resume_info and resume_info["stage"] == name and not resume_info.get("stageCompleted"):
            checkpoint = tf.train.Checkpoint(embedder=embedder, optimizer=optimizer)
            status = checkpoint.restore(str(resume_info["checkpoint"]))
            status.assert_existing_objects_matched()
            status.expect_partial()
            initial_step = int(resume_info.get("globalStep", 0))
            print(f"Restored {name} model and optimizer state at global step {initial_step}")
        bounded, callbacks = build_callbacks(
            tf, embedder, optimizer, checkpoint_dir, name, deadline, args.checkpoint_every_steps,
            run_fingerprint, initial_step,
        )
        history = trainer.fit(
            train_dataset,
            validation_data=validation_dataset,
            epochs=epochs,
            steps_per_epoch=train_stream.steps,
            validation_steps=validation_stream.steps,
            callbacks=callbacks,
            verbose=2,
        )
        if bounded.non_finite_reached:
            raise FloatingPointError(f"non-finite metric encountered during {name}; refusing to continue")
        for values in history.history.values():
            if any(not math.isfinite(float(value)) for value in values):
                raise FloatingPointError(f"non-finite training history encountered during {name}")
        assert_finite_embedder()
        wall_reached = wall_reached or bounded.wall_time_reached
        stage_histories.append({"stage": name, "history": history.history})
        if not wall_reached:
            bounded.mark_stage_completed()

    backbone.trainable = False
    run_stage("frozen", args.frozen_epochs, args.learning_rate)
    if not wall_reached:
        configure_backbone(tf, backbone, args.unfreeze_layers)
        run_stage("partial-unfreeze", args.unfrozen_epochs, args.fine_tune_learning_rate)

    retrieval = None
    if not args.skip_retrieval_eval and not wall_reached:
        retrieval = evaluate_unseen_retrieval(tf, embedder, validation_rows, args.retrieval_batch_size, args.seed + 31337)
        if any(not math.isfinite(float(value)) for key, value in retrieval.items() if key != "identityCount"):
            raise FloatingPointError("unseen retrieval metrics became non-finite")
    duration = time.monotonic() - started
    report = {
        "schemaVersion": 2,
        "status": "incomplete-wall-time" if wall_reached else "complete",
        "runFingerprint": run_fingerprint,
        "architecture": "MobileNetV3 Small + 256-unit projection + L2-normalized embedding",
        "dimensions": args.dimensions,
        "objective": {
            "supervisedContrastiveTemperature": args.temperature,
            "batchHardTripletMargin": args.triplet_margin,
            "batchHardTripletWeight": args.triplet_weight,
        },
        "sampler": summary,
        "data": {
            "trainingManifestSha256": training_manifest_sha256,
            "allowedImageRoot": pathlib.Path(args.allowed_image_root).resolve().as_posix(),
            **catalog_binding,
        },
        "implementation": implementation_binding,
        "parameters": vars(args),
        "hardware": {
            "platform": platform.platform(),
            "processor": platform.processor(),
            "tensorflow": tf.__version__,
            "devices": [device.name for device in tf.config.list_physical_devices()],
        },
        "durationSeconds": duration,
        "wallTimeLimitReached": wall_reached,
        "histories": stage_histories,
        "unseenIdentityRetrieval": retrieval,
        "model": None,
    }
    report_path = pathlib.Path(args.report)
    if wall_reached:
        write_json_atomic(report_path, report)
        raise SystemExit(
            f"wall-time limit reached after {duration / 60.0:.1f} minutes; "
            f"resume from {checkpoint_dir / 'resume.json'} (no deployable model was replaced)"
        )

    assert_finite_embedder()
    output_path = pathlib.Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    pending_path = output_path.with_name(f".{output_path.stem}.pending.keras")
    pending_path.unlink(missing_ok=True)
    embedder.save(pending_path)
    os.replace(pending_path, output_path)
    model_sha256 = sha256_file(output_path)
    report["model"] = {
        "path": output_path.resolve().as_posix(),
        "bytes": output_path.stat().st_size,
        "sha256": model_sha256,
    }
    write_json_atomic(report_path, report)
    completion_path = pathlib.Path(args.completion_sentinel)
    write_json_atomic(completion_path, {
        "schemaVersion": 1,
        "status": "complete",
        "runFingerprint": run_fingerprint,
        "modelSha256": model_sha256,
        "trainingReport": report_path.resolve().as_posix(),
        "trainingReportSha256": sha256_file(report_path),
        "completedAtUnixSeconds": time.time(),
    })
    print(f"Saved embedding model to {output_path} in {duration / 60.0:.1f} minutes")


if __name__ == "__main__":
    main()
