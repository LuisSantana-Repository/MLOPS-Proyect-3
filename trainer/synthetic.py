"""Dataset sintético con el mismo formato de T03/T04, para --smoke y pruebas sin datos reales."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw

SHAPES = ("circle", "square", "triangle")
DEFAULT_PER_SPLIT = {"train": 12, "val": 4, "test": 4}


def _draw(shape: str, size: int, rng: np.random.Generator) -> Image.Image:
    background = tuple(int(c) for c in rng.integers(0, 90, 3))
    color = tuple(int(c) for c in rng.integers(150, 256, 3))
    img = Image.new("RGB", (size, size), background)
    draw = ImageDraw.Draw(img)
    half = int(rng.integers(size // 5, size // 3))
    cx, cy = (int(v) for v in rng.integers(half + 2, size - half - 2, 2))
    box = (cx - half, cy - half, cx + half, cy + half)
    if shape == "circle":
        draw.ellipse(box, fill=color)
    elif shape == "square":
        draw.rectangle(box, fill=color)
    else:
        draw.polygon([(cx, cy - half), (cx - half, cy + half), (cx + half, cy + half)], fill=color)
    return img


def make_synthetic_dataset(
    root: str | Path,
    per_split: dict[str, int] | None = None,
    classes: tuple[str, ...] = SHAPES,
    size: int = 64,
    seed: int = 0,
) -> tuple[Path, Path]:
    """Escribe recortes, manifest.csv y classes.json; devuelve (manifest, classes)."""
    root = Path(root)
    (root / "crops").mkdir(parents=True, exist_ok=True)
    per_split = per_split or DEFAULT_PER_SPLIT
    rng = np.random.default_rng(seed)
    rows = []
    ann_id = 0
    for split, count in per_split.items():
        for category_id, name in enumerate(classes):
            for _ in range(count):
                ann_id += 1
                rel = Path("crops") / f"{ann_id}_{ann_id}.jpg"
                _draw(name, size, rng).save(root / rel, quality=95)
                rows.append(
                    {
                        "crop_path": rel.as_posix(),
                        "ann_id": ann_id,
                        "image_id": ann_id,
                        "category_id": category_id,
                        "category_name": name,
                        "split": split,
                        "group_id": ann_id,
                    }
                )
    manifest = root / "manifest.csv"
    pd.DataFrame(rows).to_csv(manifest, index=False)
    classes_path = root / "classes.json"
    classes_path.write_text(json.dumps({str(i): c for i, c in enumerate(classes)}, indent=2), encoding="utf-8")
    return manifest, classes_path
