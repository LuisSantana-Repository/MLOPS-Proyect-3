"""P2-1 — Coordenadas de origen de los recortes YA generados.

Escribe `<crops-dir>/crops_source_boxes.csv` a partir de `crops.csv` y del COCO del
release, **sin modificar** `crops.csv`, los recortes ni el manifiesto:

    ann_id, image_id, category_id, bbox_x, bbox_y, bbox_w, bbox_h,
    crop_left, crop_top, crop_right, crop_bottom

`bbox_*` es la caja COCO de origen; `crop_*` es el rectángulo que recortó T03
(floor/ceil, acotado a la imagen). `ml/make_crops.py` ya escribe este archivo en
generaciones nuevas; este script es para los recortes congelados del release actual.

Uso:
    python ml/make_source_boxes.py \\
        --annotations data/source/coco-dataset.json --crops-dir data/crops

Códigos de salida: 0 = OK, 2 = el COCO no corresponde a los recortes (o falta un archivo).
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from make_crops import SOURCE_BOXES_CSV, SOURCE_BOXES_FIELDS, InputError, _write_csv, load_coco, source_box_rows


def run(annotations: Path, crops_dir: Path) -> int:
    crops_csv = crops_dir / "crops.csv"
    if not crops_csv.is_file():
        raise InputError(f"No existe {crops_csv}")
    with crops_csv.open(encoding="utf-8") as f:
        crop_rows = list(csv.DictReader(f))
    rows = source_box_rows(load_coco(annotations), crop_rows)  # valida antes de escribir
    _write_csv(crops_dir / SOURCE_BOXES_CSV, SOURCE_BOXES_FIELDS, rows)
    return len(rows)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--annotations", type=Path, required=True, help="COCO del release (coco-dataset.json)")
    p.add_argument("--crops-dir", type=Path, required=True, help="Carpeta con crops.csv (data/crops)")
    args = p.parse_args(argv)
    try:
        n = run(args.annotations, args.crops_dir)
    except InputError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except KeyError as exc:
        print(f"ERROR: estructura COCO incompleta, falta la llave {exc}", file=sys.stderr)
        return 2
    print(f"{n} cajas de origen escritas en {args.crops_dir / SOURCE_BOXES_CSV}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
