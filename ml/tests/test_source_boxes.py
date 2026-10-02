"""P2-1 — Coordenadas de origen de cada recorte (`crops_source_boxes.csv`).

Cada recorte debe poder ubicarse en su imagen original: la caja COCO [x, y, w, h] y el
rectángulo realmente recortado (floor/ceil). Se genera SIN tocar crops.csv ni el manifiesto.
"""

import csv
import json
import math
import random
from pathlib import Path

import make_crops as mc
import make_source_boxes as msb
import pytest
from PIL import Image
from test_make_crops import _argv, _coco

REPO = Path(__file__).resolve().parents[2]
REAL_BOXES = REPO / "data" / "crops" / "crops_source_boxes.csv"
REAL_CROPS_CSV = REPO / "data" / "crops" / "crops.csv"
REAL_COCO = REPO / "data" / "source" / "coco-dataset.json"
REAL_CROPS_DIR = REPO / "data" / "crops"

FIELDS = [
    "ann_id",
    "image_id",
    "category_id",
    "bbox_x",
    "bbox_y",
    "bbox_w",
    "bbox_h",
    "crop_left",
    "crop_top",
    "crop_right",
    "crop_bottom",
]


def _read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


@pytest.fixture
def dataset(tmp_path: Path) -> dict:
    images_dir = tmp_path / "images"
    images_dir.mkdir()
    Image.new("RGB", (100, 80), "red").save(images_dir / "a.jpg")
    Image.new("RGBA", (100, 80), (0, 0, 255, 128)).save(images_dir / "b.png")
    Image.new("L", (100, 80), 128).save(images_dir / "c.jpg")
    ann_path = tmp_path / "annotations.json"
    ann_path.write_text(json.dumps(_coco()))
    dvc_file = tmp_path / "release.dvc"
    dvc_file.write_text("outs:\n- md5: abc123.dir\n  path: release\n")
    return {"annotations": ann_path, "images_dir": images_dir, "out_dir": tmp_path / "out", "dvc_file": dvc_file}


# ---------------------------------------------------------------------------
# Rectángulo recortado
# ---------------------------------------------------------------------------


def test_crop_bounds_usa_floor_ceil_y_no_sale_de_la_imagen():
    assert mc.crop_bounds([10.6, 20.2, 30.1, 15.5], 100, 80) == (10, 20, 41, 36)
    assert mc.crop_bounds([0, 0, 50.5, 40.2], 100, 80) == (0, 0, 51, 41)
    assert mc.crop_bounds([60, 40, 40.4, 40.4], 100, 80) == (60, 40, 100, 80)  # tope en el borde


def test_crop_box_recorta_exactamente_ese_rectangulo():
    img = Image.new("RGB", (100, 80))
    left, top, right, bottom = mc.crop_bounds([10.6, 20.2, 30.1, 15.5], img.width, img.height)
    assert mc.crop_box(img, [10.6, 20.2, 30.1, 15.5]).size == (right - left, bottom - top)


# ---------------------------------------------------------------------------
# make_crops.py escribe el archivo en generaciones futuras
# ---------------------------------------------------------------------------


def test_make_crops_escribe_crops_source_boxes(dataset):
    assert mc.main(_argv(dataset)) == 0
    out = dataset["out_dir"]
    rows = _read_csv(out / "crops_source_boxes.csv")
    assert list(rows[0]) == FIELDS == mc.SOURCE_BOXES_FIELDS

    crops = _read_csv(out / "crops.csv")
    assert [r["ann_id"] for r in rows] == [r["ann_id"] for r in crops]  # una fila por recorte

    by_ann = {r["ann_id"]: r for r in rows}
    assert by_ann["11"] == {
        "ann_id": "11",
        "image_id": "2",
        "category_id": "1",
        "bbox_x": "0",
        "bbox_y": "0",
        "bbox_w": "50.5",
        "bbox_h": "40.2",
        "crop_left": "0",
        "crop_top": "0",
        "crop_right": "51",
        "crop_bottom": "41",
    }
    # El rectángulo registrado es el tamaño real de cada recorte guardado.
    for crop in crops:
        box = by_ann[crop["ann_id"]]
        with Image.open(out / crop["crop_path"]) as im:
            assert im.size == (
                int(box["crop_right"]) - int(box["crop_left"]),
                int(box["crop_bottom"]) - int(box["crop_top"]),
            )


# ---------------------------------------------------------------------------
# make_source_boxes.py: para recortes ya generados, sin tocar crops.csv
# ---------------------------------------------------------------------------


def test_make_source_boxes_no_modifica_crops_csv_y_coincide_con_make_crops(dataset):
    assert mc.main(_argv(dataset)) == 0
    out = dataset["out_dir"]
    crops_before = (out / "crops.csv").read_bytes()
    expected = (out / "crops_source_boxes.csv").read_bytes()
    (out / "crops_source_boxes.csv").unlink()

    assert msb.main(["--annotations", str(dataset["annotations"]), "--crops-dir", str(out)]) == 0

    assert (out / "crops.csv").read_bytes() == crops_before
    assert (out / "crops_source_boxes.csv").read_bytes() == expected


def test_make_source_boxes_falla_si_el_coco_no_es_el_de_los_recortes(dataset, capsys):
    assert mc.main(_argv(dataset)) == 0
    coco = _coco()
    coco["annotations"] = [a for a in coco["annotations"] if a["id"] != 10]
    dataset["annotations"].write_text(json.dumps(coco))

    code = msb.main(["--annotations", str(dataset["annotations"]), "--crops-dir", str(dataset["out_dir"])])

    assert code == 2
    assert "10" in capsys.readouterr().err
    assert not (dataset["out_dir"] / "crops_source_boxes.csv.tmp").exists()


def test_make_source_boxes_falla_si_cambio_la_clase_o_la_imagen(dataset, capsys):
    assert mc.main(_argv(dataset)) == 0
    coco = _coco()
    next(a for a in coco["annotations"] if a["id"] == 10)["category_id"] = 5
    dataset["annotations"].write_text(json.dumps(coco))
    (dataset["out_dir"] / "crops_source_boxes.csv").unlink()

    assert msb.main(["--annotations", str(dataset["annotations"]), "--crops-dir", str(dataset["out_dir"])]) == 2
    assert not (dataset["out_dir"] / "crops_source_boxes.csv").exists()


# ---------------------------------------------------------------------------
# El archivo versionado del release real
# ---------------------------------------------------------------------------


def test_el_archivo_versionado_tiene_una_fila_por_recorte_de_crops_csv():
    boxes = _read_csv(REAL_BOXES)
    crops = _read_csv(REAL_CROPS_CSV)
    assert list(boxes[0]) == FIELDS
    assert len(boxes) == len(crops) == 1349
    for box, crop in zip(boxes, crops, strict=True):
        assert (box["ann_id"], box["image_id"], box["category_id"]) == (
            crop["ann_id"],
            crop["image_id"],
            crop["category_id"],
        )
        x, y, w, h = (float(box[k]) for k in ("bbox_x", "bbox_y", "bbox_w", "bbox_h"))
        assert int(box["crop_left"]) == max(0, math.floor(x))
        assert int(box["crop_top"]) == max(0, math.floor(y))
        assert int(box["crop_right"]) >= math.ceil(x + w) - 1
        assert int(box["crop_bottom"]) >= math.ceil(y + h) - 1
        assert w * h >= mc.DEFAULT_MIN_AREA  # las cajas menores se descartaron en T03


@pytest.mark.skipif(
    not (REAL_COCO.is_file() and (REAL_CROPS_DIR / "crops").is_dir()),
    reason="necesita los datos de DVC (dvc pull): data/source y data/crops/crops",
)
def test_veinte_recortes_al_azar_coinciden_con_el_coco():
    """Aceptación de P2-1: imagen, clase y tamaño = caja con floor/ceil."""
    coco = json.loads(REAL_COCO.read_text(encoding="utf-8"))
    annotations = {a["id"]: a for a in coco["annotations"]}
    images = {i["id"]: i for i in coco["images"]}
    names = {c["id"]: c["name"] for c in coco["categories"]}
    crops = {r["ann_id"]: r for r in _read_csv(REAL_CROPS_CSV)}

    sample = random.Random(20261002).sample(_read_csv(REAL_BOXES), 20)
    for box in sample:
        ann = annotations[int(box["ann_id"])]
        crop = crops[box["ann_id"]]
        # imagen y clase
        assert int(box["image_id"]) == ann["image_id"]
        assert int(box["category_id"]) == ann["category_id"]
        assert crop["category_name"] == names[ann["category_id"]]
        # caja de origen = la del COCO
        assert [float(box[k]) for k in ("bbox_x", "bbox_y", "bbox_w", "bbox_h")] == [float(v) for v in ann["bbox"]]
        # tamaño del recorte = caja con floor/ceil, acotada a la imagen
        x, y, w, h = (float(v) for v in ann["bbox"])
        img = images[ann["image_id"]]
        left, top = max(0, math.floor(x)), max(0, math.floor(y))
        right, bottom = min(img["width"], math.ceil(x + w)), min(img["height"], math.ceil(y + h))
        assert (int(box["crop_left"]), int(box["crop_top"]), int(box["crop_right"]), int(box["crop_bottom"])) == (
            left,
            top,
            right,
            bottom,
        )
        with Image.open(REAL_CROPS_DIR / crop["crop_path"]) as im:
            assert im.size == (right - left, bottom - top)
