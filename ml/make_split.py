"""T04 — Manifiesto 70/20/10 sin fuga, versionado con DVC.

Genera un split train/val/test a partir de los recortes de T03, sin tocar el
split 70/15/15 del Proyecto 2:

1. Agrupa los recortes por imagen original (image_id).
2. Une los grupos de imágenes originales que son duplicados cercanos
   (pHash con distancia de Hamming <= umbral), de forma transitiva.
3. Reparte los grupos con StratifiedGroupKFold (10 partes, semilla fija):
   1 parte test (10 %), 2 partes val (20 %), 7 partes train (70 %).
4. Verifica que no haya fuga y guarda una huella SHA-256 del test.

Salidas en --out-dir:
    manifest.csv          una fila por recorte, con group_id y split
    split_report.csv      conteos por clase y split
    leakage_report.json   parámetros, fuga detectada y huella del test

Uso:
    python ml/make_split.py \\
        --crops-csv data/crops/crops.csv \\
        --annotations data/source/coco-dataset.json \\
        --images-dir data/source/images \\
        --out-dir data/splits \\
        --seed 42

Códigos de salida: 0 = OK, 2 = error de entrada, 3 = se detectó fuga.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import imagehash
import numpy as np
from PIL import Image
from sklearn.model_selection import StratifiedGroupKFold

DEFAULT_SEED = 42
DEFAULT_PHASH_THRESHOLD = 5  # bits de 64; alinearlo con el analizador de duplicados del P2
N_FOLDS = 10
SPLITS = ("train", "val", "test")
REQUIRED_COLUMNS = {"crop_path", "ann_id", "image_id", "category_name"}
MANIFEST_FIELDS = [
    "crop_path",
    "ann_id",
    "image_id",
    "category_id",
    "category_name",
    "class_index",
    "group_id",
    "split",
]


class InputError(Exception):
    """Error de entrada del usuario: se reporta con exit code 2, sin traceback."""


# ---------------------------------------------------------------------------
# Lectura de entradas
# ---------------------------------------------------------------------------


def read_crops(path: Path) -> list[dict]:
    if not path.is_file():
        raise InputError(f"No existe el CSV de recortes: {path}")
    with path.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise InputError(f"Al CSV de recortes le faltan columnas: {sorted(missing)}")
        rows = list(reader)
    if not rows:
        raise InputError(f"El CSV de recortes está vacío: {path}")
    for r in rows:
        r["ann_id"] = int(r["ann_id"])
        r["image_id"] = int(r["image_id"])
    return sorted(rows, key=lambda r: r["ann_id"])


def image_paths(annotations: Path, images_dir: Path, image_ids: set[int]) -> dict[int, Path]:
    """Mapa image_id -> archivo original, solo para las imágenes que tienen recortes."""
    if not annotations.is_file():
        raise InputError(f"No existe el archivo de anotaciones: {annotations}")
    try:
        coco = json.loads(annotations.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise InputError(f"El COCO no es JSON válido: {exc}") from exc
    names = {img["id"]: img["file_name"] for img in coco.get("images", [])}

    unknown = sorted(image_ids - names.keys())
    if unknown:
        raise InputError(f"image_id sin registro en el COCO: {unknown[:10]}")
    paths = {i: images_dir / names[i] for i in sorted(image_ids)}
    missing = [str(p) for p in paths.values() if not p.is_file()]
    if missing:
        raise InputError(f"Faltan {len(missing)} imágenes originales, p. ej. {missing[:3]}")
    return paths


# ---------------------------------------------------------------------------
# Duplicados cercanos y grupos
# ---------------------------------------------------------------------------


def compute_phashes(paths: dict[int, Path]) -> dict[int, int]:
    hashes = {}
    for image_id, path in paths.items():
        with Image.open(path) as im:
            hashes[image_id] = int(str(imagehash.phash(im)), 16)
    return hashes


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def near_duplicate_pairs(hashes: dict[int, int], threshold: int) -> list[tuple[int, int]]:
    """Pares (a, b) con a < b cuya distancia de Hamming es <= threshold."""
    ids = sorted(hashes)
    return [(a, b) for i, a in enumerate(ids) for b in ids[i + 1 :] if hamming(hashes[a], hashes[b]) <= threshold]


class UnionFind:
    def __init__(self, items: list[int]) -> None:
        self.parent = {x: x for x in items}

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            # la raíz es siempre el image_id menor: group_id estable sin importar el orden
            self.parent[max(ra, rb)] = min(ra, rb)


def build_groups(image_ids: set[int], pairs: list[tuple[int, int]]) -> dict[int, str]:
    """image_id -> group_id. El group_id se nombra con el image_id menor del grupo."""
    uf = UnionFind(sorted(image_ids))
    for a, b in pairs:
        uf.union(a, b)
    return {i: f"img{uf.find(i):06d}" for i in image_ids}


# ---------------------------------------------------------------------------
# Split
# ---------------------------------------------------------------------------


def fold_to_split(fold: int) -> str:
    if fold == 0:
        return "test"
    if fold in (1, 2):
        return "val"
    return "train"


def assign_splits(rows: list[dict], group_of: dict[int, str], seed: int) -> dict[str, str]:
    """group_id -> split, con StratifiedGroupKFold estratificado por clase."""
    groups = [group_of[r["image_id"]] for r in rows]
    n_groups = len(set(groups))
    if n_groups < N_FOLDS:
        raise InputError(f"Se necesitan al menos {N_FOLDS} grupos y hay {n_groups}")
    y = [r["category_name"] for r in rows]
    sgkf = StratifiedGroupKFold(n_splits=N_FOLDS, shuffle=True, random_state=seed)
    split_of: dict[str, str] = {}
    for fold, (_, fold_idx) in enumerate(sgkf.split(np.zeros(len(rows)), y, groups)):
        for i in fold_idx:
            split_of[groups[i]] = fold_to_split(fold)
    return split_of


def build_manifest(rows: list[dict], group_of: dict[int, str], split_of: dict[str, str]):
    manifest = []
    for r in rows:
        gid = group_of[r["image_id"]]
        manifest.append(
            {
                "crop_path": r["crop_path"],
                "ann_id": r["ann_id"],
                "image_id": r["image_id"],
                "category_id": r.get("category_id", ""),
                "category_name": r["category_name"],
                "class_index": r.get("class_index", ""),
                "group_id": gid,
                "split": split_of[gid],
            }
        )
    return manifest


# ---------------------------------------------------------------------------
# Verificación de fuga, reportes y huella del test
# ---------------------------------------------------------------------------


def find_leakage(manifest: list[dict], hashes: dict[int, int] | None = None, threshold: int = 0) -> dict:
    """Busca fuga de forma independiente al split. Todo en cero = sin fuga."""
    splits_by_group: dict[str, set] = defaultdict(set)
    splits_by_image: dict[int, set] = defaultdict(set)
    for r in manifest:
        splits_by_group[r["group_id"]].add(r["split"])
        splits_by_image[int(r["image_id"])].add(r["split"])

    groups_leaked = sorted(g for g, s in splits_by_group.items() if len(s) > 1)
    images_leaked = sorted(i for i, s in splits_by_image.items() if len(s) > 1)

    cross_pairs = []
    if hashes is not None:
        split_of_image = {i: next(iter(s)) for i, s in splits_by_image.items() if len(s) == 1}
        for a, b in near_duplicate_pairs({i: hashes[i] for i in split_of_image}, threshold):
            if split_of_image[a] != split_of_image[b]:
                cross_pairs.append([a, b])

    return {
        "grupos_en_varios_splits": groups_leaked,
        "imagenes_en_varios_splits": images_leaked,
        "duplicados_cercanos_entre_splits": cross_pairs,
        "total": len(groups_leaked) + len(images_leaked) + len(cross_pairs),
    }


def fingerprint_test_split(manifest: list[dict]) -> str:
    """SHA-256 de los ann_id de test ordenados: cambia si cambia un solo recorte."""
    ids = sorted(int(r["ann_id"]) for r in manifest if r["split"] == "test")
    return hashlib.sha256("\n".join(map(str, ids)).encode()).hexdigest()


def split_report(manifest: list[dict]) -> list[dict]:
    counts = Counter((r["category_name"], r["split"]) for r in manifest)
    rows = []
    for cls in sorted({r["category_name"] for r in manifest}):
        total = sum(counts[(cls, s)] for s in SPLITS)
        row = {"clase": cls, "total": total}
        for s in SPLITS:
            row[s] = counts[(cls, s)]
            row[f"{s}_pct"] = round(100 * counts[(cls, s)] / total, 1)
        rows.append(row)
    total = len(manifest)
    row = {"clase": "TOTAL", "total": total}
    for s in SPLITS:
        n = sum(1 for r in manifest if r["split"] == s)
        row[s] = n
        row[f"{s}_pct"] = round(100 * n / total, 1)
    rows.append(row)
    return rows


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def print_report(report: list[dict], leak: dict, n_groups: int, n_merged: int, fp: str) -> None:
    header = f"{'clase':<12}{'total':>7}" + "".join(f"{s:>14}" for s in SPLITS)
    print("Conteos por clase y split")
    print(header)
    print("-" * len(header))
    for r in report:
        cells = "".join(f"{r[s]:>7} ({r[f'{s}_pct']:>4}%)" for s in SPLITS)
        print(f"{r['clase']:<12}{r['total']:>7}{cells}")
    print(f"\nGrupos: {n_groups} (uniones por duplicado cercano: {n_merged})")
    print(f"Fuga detectada: {leak['total']}")
    print(f"Huella del test (SHA-256): {fp}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def run(args: argparse.Namespace) -> int:
    rows = read_crops(args.crops_csv)
    image_ids = {r["image_id"] for r in rows}
    paths = image_paths(args.annotations, args.images_dir, image_ids)

    hashes = compute_phashes(paths)
    pairs = near_duplicate_pairs(hashes, args.phash_threshold)
    group_of = build_groups(image_ids, pairs)
    split_of = assign_splits(rows, group_of, args.seed)
    manifest = build_manifest(rows, group_of, split_of)

    leak = find_leakage(manifest, hashes, args.phash_threshold)
    report = split_report(manifest)
    fp = fingerprint_test_split(manifest)
    n_groups = len(set(group_of.values()))

    args.out_dir.mkdir(parents=True, exist_ok=True)
    _write_csv(args.out_dir / "manifest.csv", manifest)
    _write_csv(args.out_dir / "split_report.csv", report)
    info = {
        "semilla": args.seed,
        "phash_umbral": args.phash_threshold,
        "proporciones": {"train": 0.7, "val": 0.2, "test": 0.1},
        "metodo": f"StratifiedGroupKFold(n_splits={N_FOLDS}, shuffle=True)",
        "crops_csv_md5": md5_file(args.crops_csv),
        "n_recortes": len(manifest),
        "n_imagenes": len(image_ids),
        "n_grupos": n_groups,
        "pares_duplicados_cercanos": [list(p) for p in pairs],
        "fuga": leak,
        "test_huella_sha256": fp,
        "test_custodia": args.test_custodian,
    }
    (args.out_dir / "leakage_report.json").write_text(
        json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print_report(report, leak, n_groups, len(image_ids) - n_groups, fp)

    if leak["total"]:
        print("ERROR: se detectó fuga entre splits; revisa leakage_report.json", file=sys.stderr)
        return 3
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--crops-csv", type=Path, required=True)
    p.add_argument("--annotations", type=Path, required=True)
    p.add_argument("--images-dir", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--seed", type=int, default=DEFAULT_SEED)
    p.add_argument("--phash-threshold", type=int, default=DEFAULT_PHASH_THRESHOLD)
    p.add_argument("--test-custodian", default="Alejandra")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return run(args)
    except InputError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
