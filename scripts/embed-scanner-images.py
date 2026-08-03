import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from ai_edge_litert.interpreter import Interpreter


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--jobs", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--batch-size", type=int, default=32)
    return parser.parse_args()


def load_image(file_path):
    with Image.open(file_path) as image:
        rgb = image.convert("RGB").resize((224, 224), Image.Resampling.BILINEAR)
        return np.asarray(rgb, dtype=np.float32) / 255.0


def main():
    args = parse_args()
    jobs = json.loads(Path(args.jobs).read_text(encoding="utf-8"))
    interpreter = Interpreter(model_path=args.model)
    input_details = interpreter.get_input_details()[0]
    output_details = interpreter.get_output_details()[0]
    vectors = []

    for start in range(0, len(jobs), max(1, args.batch_size)):
        batch_jobs = jobs[start : start + max(1, args.batch_size)]
        batch = np.stack([load_image(job["imagePath"]) for job in batch_jobs])
        interpreter.resize_tensor_input(input_details["index"], batch.shape, strict=False)
        interpreter.allocate_tensors()
        input_details = interpreter.get_input_details()[0]
        output_details = interpreter.get_output_details()[0]
        interpreter.set_tensor(input_details["index"], batch)
        interpreter.invoke()
        output = np.asarray(interpreter.get_tensor(output_details["index"]), dtype=np.float32)
        magnitudes = np.linalg.norm(output, axis=1, keepdims=True)
        if not np.all(np.isfinite(output)) or np.any(magnitudes <= 0):
            raise RuntimeError("Model returned a non-finite or zero-magnitude embedding.")
        vectors.append(output / magnitudes)

    matrix = np.concatenate(vectors, axis=0) if vectors else np.empty((0, 128), dtype=np.float32)
    if matrix.shape != (len(jobs), 128):
        raise RuntimeError(f"Unexpected output shape {matrix.shape}; expected {(len(jobs), 128)}.")
    matrix.astype("<f2").tofile(args.output)


if __name__ == "__main__":
    main()
