#!/usr/bin/env python3
"""Train the PackDex scanner-AI embedding model.

Colab/local usage:
  python scripts/scanner-ai/train-embedding.py --manifest artifacts/scanner-ai/generated/training-manifest.jsonl

The model is an embedding network, not an 18k-way classifier. New cards are
added by regenerating catalog embeddings with the exported model.
"""

from __future__ import annotations

import argparse
import json
import pathlib

import tensorflow as tf


IMAGE_SIZE = 224


def load_rows(path: pathlib.Path, split: str):
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows = [row for row in rows if row["split"] == split and row.get("localPath")]
    labels = {card_id: index for index, card_id in enumerate(sorted({row["cardId"] for row in rows}))}
    return rows, labels


def decode_image(path, label):
    image = tf.io.decode_image(tf.io.read_file(path), channels=3, expand_animations=False)
    image = tf.image.resize(image, [IMAGE_SIZE, IMAGE_SIZE], method="bicubic")
    image = tf.cast(image, tf.float32) / 255.0
    image = tf.image.random_brightness(image, 0.18)
    image = tf.image.random_contrast(image, 0.72, 1.28)
    image = tf.clip_by_value(image, 0.0, 1.0)
    return image, label


def make_dataset(rows, labels, batch_size, training):
    paths = [row["localPath"] for row in rows]
    y = [labels[row["cardId"]] for row in rows]
    dataset = tf.data.Dataset.from_tensor_slices((paths, y))
    if training:
        dataset = dataset.shuffle(min(len(paths), 8192), seed=20260712, reshuffle_each_iteration=True)
    return dataset.map(decode_image, num_parallel_calls=tf.data.AUTOTUNE).batch(batch_size).prefetch(tf.data.AUTOTUNE)


def build_model(dimensions: int):
    backbone = tf.keras.applications.MobileNetV3Small(
        input_shape=(IMAGE_SIZE, IMAGE_SIZE, 3),
        include_top=False,
        weights="imagenet",
        pooling="avg",
        include_preprocessing=False,
    )
    inputs = tf.keras.Input(shape=(IMAGE_SIZE, IMAGE_SIZE, 3), name="card_image")
    x = backbone(inputs, training=True)
    x = tf.keras.layers.Dense(512, activation="relu")(x)
    outputs = tf.keras.layers.Dense(dimensions, name="embedding")(x)
    outputs = tf.keras.layers.Lambda(lambda value: tf.math.l2_normalize(value, axis=1), name="l2_normalized")(outputs)
    return tf.keras.Model(inputs, outputs)


def supervised_contrastive_loss(labels, embeddings, temperature=0.12):
    labels = tf.reshape(labels, [-1, 1])
    mask = tf.cast(tf.equal(labels, tf.transpose(labels)), tf.float32)
    logits = tf.matmul(embeddings, embeddings, transpose_b=True) / temperature
    logits = logits - tf.reduce_max(logits, axis=1, keepdims=True)
    logits_mask = 1.0 - tf.eye(tf.shape(labels)[0])
    mask = mask * logits_mask
    exp_logits = tf.exp(logits) * logits_mask
    log_prob = logits - tf.math.log(tf.reduce_sum(exp_logits, axis=1, keepdims=True) + 1e-12)
    positive_count = tf.reduce_sum(mask, axis=1)
    mean_log_prob_pos = tf.reduce_sum(mask * log_prob, axis=1) / tf.maximum(positive_count, 1.0)
    valid = tf.cast(positive_count > 0, tf.float32)
    return -tf.reduce_sum(mean_log_prob_pos * valid) / tf.maximum(tf.reduce_sum(valid), 1.0)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="artifacts/scanner-ai/generated/training-manifest.jsonl")
    parser.add_argument("--output", default="artifacts/scanner-ai/models/packdex-card-embedder.keras")
    parser.add_argument("--dimensions", type=int, default=256)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--epochs", type=int, default=12)
    args = parser.parse_args()

    manifest_path = pathlib.Path(args.manifest)
    train_rows, labels = load_rows(manifest_path, "train")
    val_rows, _ = load_rows(manifest_path, "val")
    if not train_rows:
        raise SystemExit("No downloaded training rows found. Run build-dataset.py --download first.")

    model = build_model(args.dimensions)
    model.compile(
        optimizer=tf.keras.optimizers.AdamW(learning_rate=2e-4, weight_decay=1e-5),
        loss=supervised_contrastive_loss,
    )
    model.fit(
        make_dataset(train_rows, labels, args.batch_size, True),
        validation_data=make_dataset(val_rows, labels, args.batch_size, False) if val_rows else None,
        epochs=args.epochs,
    )

    output_path = pathlib.Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    model.save(output_path)
    print(f"Saved embedding model to {output_path}")


if __name__ == "__main__":
    main()
