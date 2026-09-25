"""T03 — Recortes COCO desde el release DVC aprobado + mapa de clases.

Lee el annotations.json COCO del release del Proyecto 2, descarta cajas
inválidas o diminutas, recorta cada caja válida de las clases incluidas y
genera los artefactos que consume T04:

    <out-dir>/
        crops/<image_id>_<ann_id>.jpg
        crops.csv           crop_path, ann_id, image_id, category_id, category_name, class_index
        classes.json        {"0": "clase_a", "1": "clase_b", ...}
        class_counts.csv    conteos por clase + hash del release
        exclusions.json     cajas descartadas por motivo + clases excluidas
        release_info.json   tag / hash DVC del release usado

Uso:
    python ml/make_crops.py \\
        --annotations data/p2_release/annotations.json \\
        --images-dir data/p2_release/images \\
        --out-dir data/crops \\
        --release-tag v1.0.0 \\
        --dvc-file data/p2_release.dvc

Códigos de salida: 0 = OK, 2 = error de entrada (archivo faltante, JSON
inválido, estructura COCO incompleta, carpeta de salida ya poblada).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import shutil
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from PIL import Image

DEFAULT_MIN_AREA = 32 * 32  # umbral "small" de COCO; alinearlo con quality.yaml del P2
DEFAULT_MIN_IMAGES = 300
JPEG_QUALITY = 95

# Motivos de descarte (se usan como llaves en exclusions.json)
R_MALFORMED = "bbox_malformada"
R_NON_POSITIVE = "ancho_o_alto_no_positivo"
R_OUT_OF_IMAGE = "fuera_de_imagen"
R_TOO_SMALL = "area_menor_al_umbral"
R_UNKNOWN_IMAGE = "imagen_no_registrada"
R_UNKNOWN_CATEGORY = "categoria_desconocida"
R_CROWD = "iscrowd"
R_MISSING_FILE = "archivo_de_imagen_no_encontrado"

CROPS_CSV_FIELDS = [
    "crop_path",
    "ann_id",
    "image_id",
    "category_id",
    "category_name",
    "class_index",
]
COUNTS_CSV_FIELDS = [
    "category_id",
    "category_name",
    "n_imagenes_originales",
    "n_imagenes_con_caja_valida",
    "n_cajas_totales",
    "n_cajas_validas",
    "incluida",
    "class_index",
    "motivo_exclusion",
    "release_tag",
    "annotations_md5",
]


class InputError(Exception):
    """Error de entrada del usuario: se reporta con exit code 2, sin traceback."""


# ---------------------------------------------------------------------------
# Validación de cajas
# ---------------------------------------------------------------------------


def validate_box(
    bbox: Any, img_w: float, img_h: float, min_area: float, tol: float = 1e-6
) -> str | None:
    """Devuelve None si la caja COCO [x, y, w, h] es válida, o el motivo de descarte."""
    if not isinstance(bbox, list | tuple) or len(bbox) != 4:
        return R_MALFORMED
    try:
        x, y, w, h = (float(v) for v in bbox)
    except (TypeError, ValueError):
        return R_MALFORMED
    if not all(math.isfinite(v) for v in (x, y, w, h)):
        return R_MALFORMED
    if w <= 0 or h <= 0:
        return R_NON_POSITIVE
    if x < -tol or y < -tol or x + w > img_w + tol or y + h > img_h + tol:
        return R_OUT_OF_IMAGE
    if w * h < min_area:
        return R_TOO_SMALL
    return None


def classify_annotations(
    coco: dict,
    min_area: float,
    images_dir: Path | None = None,
    skip_crowd: bool = True,
) -> tuple[list[dict], list[tuple[dict, str]]]:
    """Separa anotaciones en válidas y descartadas (con motivo). Orden estable por ann id."""
    images = {img["id"]: img for img in coco["images"]}
    category_ids = {c["id"] for c in coco["categories"]}
    valid: list[dict] = []
    rejected: list[tuple[dict, str]] = []

    for ann in sorted(coco["annotations"], key=lambda a: a["id"]):
        img = images.get(ann.get("image_id"))
        if ann.get("category_id") not in category_ids:
            reason = R_UNKNOWN_CATEGORY
        elif img is None:
            reason = R_UNKNOWN_IMAGE
        elif skip_crowd and ann.get("iscrowd", 0) == 1:
            reason = R_CROWD
        else:
            reason = validate_box(
                ann.get("bbox"), img["width"], img["height"], min_area
            )
            if (
                reason is None
                and images_dir is not None
                and not (images_dir / img["file_name"]).is_file()
            ):
                reason = R_MISSING_FILE

        if reason is None:
            valid.append(ann)
        else:
            rejected.append((ann, reason))
    return valid, rejected


# ---------------------------------------------------------------------------
# Conteos por clase y mapa de clases
# ---------------------------------------------------------------------------


def compute_class_stats(coco: dict, valid: list[dict], min_images: int) -> list[dict]:
    """Conteos por clase. La elegibilidad usa imágenes originales con >= 1 caja válida,
    porque son las únicas que aportan recortes al entrenamiento."""
    images_orig: dict[int, set] = defaultdict(set)
    images_valid: dict[int, set] = defaultdict(set)
    boxes_total: Counter = Counter()
    boxes_valid: Counter = Counter()

    for ann in coco["annotations"]:
        images_orig[ann.get("category_id")].add(ann.get("image_id"))
        boxes_total[ann.get("category_id")] += 1
    for ann in valid:
        images_valid[ann["category_id"]].add(ann["image_id"])
        boxes_valid[ann["category_id"]] += 1

    rows = []
    next_index = 0
    for cat in sorted(coco["categories"], key=lambda c: c["id"]):
        cid = cat["id"]
        n_valid_imgs = len(images_valid[cid])
        included = n_valid_imgs >= min_images
        rows.append(
            {
                "category_id": cid,
                "category_name": cat["name"],
                "n_imagenes_originales": len(images_orig[cid]),
                "n_imagenes_con_caja_valida": n_valid_imgs,
                "n_cajas_totales": boxes_total[cid],
                "n_cajas_validas": boxes_valid[cid],
                "incluida": included,
                "class_index": next_index if included else "",
                "motivo_exclusion": ""
                if included
                else f"{n_valid_imgs} imágenes con caja válida (< {min_images})",
            }
        )
        if included:
            next_index += 1
    return rows


def build_class_map(stats: list[dict]) -> dict[str, str]:
    """Mapa índice→clase contiguo (0..N-1), ordenado por category_id."""
    return {str(r["class_index"]): r["category_name"] for r in stats if r["incluida"]}


# ---------------------------------------------------------------------------
# Recortes
# ---------------------------------------------------------------------------


def crop_box(img: Image.Image, bbox: list[float]) -> Image.Image:
    """Recorta con floor/ceil para no perder píxeles de bordes fraccionarios."""
    x, y, w, h = (float(v) for v in bbox)
    left = max(0, math.floor(x))
    top = max(0, math.floor(y))
    right = min(img.width, math.ceil(x + w))
    bottom = min(img.height, math.ceil(y + h))
    return img.crop((left, top, right, bottom))


def write_crops(
    coco: dict,
    valid: list[dict],
    stats: list[dict],
    images_dir: Path,
    out_dir: Path,
) -> tuple[list[dict], list[tuple[dict, str]]]:
    """Guarda <image_id>_<ann_id>.jpg para las clases incluidas. Abre cada imagen una vez."""
    images = {img["id"]: img for img in coco["images"]}
    included = {r["category_id"]: r for r in stats if r["incluida"]}
    crops_dir = out_dir / "crops"
    crops_dir.mkdir(parents=True, exist_ok=True)

    by_image: dict[int, list[dict]] = defaultdict(list)
    for ann in valid:
        if ann["category_id"] in included:
            by_image[ann["image_id"]].append(ann)

    rows: list[dict] = []
    errors: list[tuple[dict, str]] = []
    for image_id in sorted(by_image):
        path = images_dir / images[image_id]["file_name"]
        try:
            with Image.open(path) as im:
                im = im.convert("RGB")
                for ann in by_image[image_id]:
                    name = f"{image_id}_{ann['id']}.jpg"
                    crop_box(im, ann["bbox"]).save(
                        crops_dir / name, quality=JPEG_QUALITY
                    )
                    stat = included[ann["category_id"]]
                    rows.append(
                        {
                            "crop_path": f"crops/{name}",
                            "ann_id": ann["id"],
                            "image_id": image_id,
                            "category_id": ann["category_id"],
                            "category_name": stat["category_name"],
                            "class_index": stat["class_index"],
                        }
                    )
        except OSError as exc:
            errors.extend(
                (ann, f"imagen_ilegible: {exc}") for ann in by_image[image_id]
            )
    rows.sort(key=lambda r: r["ann_id"])
    return rows, errors


# ---------------------------------------------------------------------------
# Info del release
# ---------------------------------------------------------------------------


def md5_file(path: Path) -> str:
    """MD5 del contenido: coincide con el md5 que DVC registra para un archivo individual."""
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def git_commit(path: Path) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(path), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def build_release_info(
    annotations: Path, release_tag: str, dvc_file: Path | None
) -> dict[str, Any]:
    info: dict[str, Any] = {
        "release_tag": release_tag,
        "annotations_path": annotations.as_posix(),
        "annotations_md5": md5_file(annotations),
        "git_commit_repo_actual": git_commit(annotations.parent),
        "generado_en": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    if dvc_file is not None:
        if not dvc_file.is_file():
            raise InputError(f"No existe el archivo DVC: {dvc_file}")
        # Se guarda tal cual: incluye md5 de la salida y, si vino de `dvc import`,
        # el repo origen y el rev_lock (commit exacto del Proyecto 2).
        info["dvc_file"] = dvc_file.as_posix()
        info["dvc_file_content"] = dvc_file.read_text(encoding="utf-8")
    return info


# ---------------------------------------------------------------------------
# Escritura de artefactos y reporte
# ---------------------------------------------------------------------------


def load_coco(path: Path) -> dict:
    if not path.is_file():
        raise InputError(f"No existe el archivo de anotaciones: {path}")
    try:
        coco = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise InputError(f"annotations.json no es JSON válido: {exc}") from exc
    missing = [k for k in ("images", "annotations", "categories") if k not in coco]
    if missing:
        raise InputError(f"annotations.json no tiene las llaves COCO: {missing}")
    return coco


def _write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def print_report(
    stats: list[dict], rejected: list[tuple[dict, str]], info: dict
) -> None:
    print(f"Release: {info['release_tag']}  annotations md5: {info['annotations_md5']}")
    print("\nConteos por clase")
    header = f"{'idx':>4}  {'clase':<24}{'imgs orig':>10}{'imgs válidas':>14}{'cajas válidas':>15}"
    print(header)
    print("-" * len(header))
    for r in stats:
        idx = r["class_index"] if r["incluida"] else "—"
        print(
            f"{idx!s:>4}  {r['category_name']:<24}{r['n_imagenes_originales']:>10}"
            f"{r['n_imagenes_con_caja_valida']:>14}{r['n_cajas_validas']:>15}"
        )
    print("\nCajas descartadas por motivo")
    for reason, n in sorted(Counter(r for _, r in rejected).items()):
        print(f"  {reason:<36}{n:>6}")
    excluded = [r for r in stats if not r["incluida"]]
    print("\nClases excluidas")
    for r in excluded:
        print(f"  {r['category_name']}: {r['motivo_exclusion']}")
    if not excluded:
        print("  (ninguna)")
    n_included = sum(r["incluida"] for r in stats)
    if n_included < 2:
        print(
            f"\nADVERTENCIA: solo {n_included} clase(s) cumplen el umbral; "
            "un clasificador multiclase necesita al menos 2.",
            file=sys.stderr,
        )


def run(args: argparse.Namespace) -> None:
    out_dir: Path = args.out_dir
    crops_dir = out_dir / "crops"
    if crops_dir.exists() and any(crops_dir.iterdir()):
        if not args.overwrite:
            raise InputError(
                f"{crops_dir} ya tiene archivos; usa --overwrite para regenerar"
            )
        shutil.rmtree(crops_dir)
    if not args.images_dir.is_dir():
        raise InputError(f"No existe la carpeta de imágenes: {args.images_dir}")

    coco = load_coco(args.annotations)
    info = build_release_info(args.annotations, args.release_tag, args.dvc_file)

    valid, rejected = classify_annotations(
        coco, args.min_area, args.images_dir, skip_crowd=not args.keep_crowd
    )
    stats = compute_class_stats(coco, valid, args.min_images)
    rows, crop_errors = write_crops(coco, valid, stats, args.images_dir, out_dir)
    rejected += crop_errors

    for r in stats:
        r["release_tag"] = info["release_tag"]
        r["annotations_md5"] = info["annotations_md5"]

    _write_csv(out_dir / "crops.csv", CROPS_CSV_FIELDS, rows)
    _write_csv(out_dir / "class_counts.csv", COUNTS_CSV_FIELDS, stats)
    (out_dir / "classes.json").write_text(
        json.dumps(build_class_map(stats), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    by_reason: dict[str, list[int]] = defaultdict(list)
    for ann, reason in rejected:
        by_reason[reason].append(ann.get("id"))
    exclusions = {
        "parametros": {
            "min_area": args.min_area,
            "min_images": args.min_images,
            "descartar_iscrowd": not args.keep_crowd,
        },
        "cajas_descartadas": {
            k: {"n": len(v), "ann_ids": v} for k, v in by_reason.items()
        },
        "clases_excluidas": [
            {
                "category_id": r["category_id"],
                "category_name": r["category_name"],
                "motivo": r["motivo_exclusion"],
            }
            for r in stats
            if not r["incluida"]
        ],
    }
    (out_dir / "exclusions.json").write_text(
        json.dumps(exclusions, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (out_dir / "release_info.json").write_text(
        json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print_report(stats, rejected, info)
    print(f"\n{len(rows)} recortes escritos en {crops_dir}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--annotations", type=Path, required=True)
    p.add_argument("--images-dir", type=Path, required=True)
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument(
        "--release-tag", required=True, help="Tag git/DVC del release aprobado"
    )
    p.add_argument(
        "--dvc-file", type=Path, default=None, help="Archivo .dvc del release"
    )
    p.add_argument("--min-area", type=float, default=DEFAULT_MIN_AREA)
    p.add_argument("--min-images", type=int, default=DEFAULT_MIN_IMAGES)
    p.add_argument("--keep-crowd", action="store_true", help="No descartar iscrowd=1")
    p.add_argument("--overwrite", action="store_true")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    try:
        run(args)
    except InputError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except KeyError as exc:
        print(
            f"ERROR: estructura COCO incompleta, falta la llave {exc}", file=sys.stderr
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
