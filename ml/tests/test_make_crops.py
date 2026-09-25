import csv
import json
from pathlib import Path

import pytest
from PIL import Image

import make_crops as mc

# ---------------------------------------------------------------------------
# Fixture: dataset COCO sintético pequeño
# ---------------------------------------------------------------------------
#  cat (id 1): cajas válidas en imágenes 1 y 2           -> incluida con min_images=2
#  dog (id 2): caja válida solo en imagen 3              -> excluida
#  bird (id 3): aparece en 2 imágenes pero solo con cajas inválidas -> excluida
#  fish (id 4): sin anotaciones                          -> excluida
#  car (id 5): cajas válidas en imágenes 2 y 3           -> incluida


def _coco() -> dict:
    return {
        "images": [
            {"id": 1, "file_name": "a.jpg", "width": 100, "height": 80},
            {"id": 2, "file_name": "b.png", "width": 100, "height": 80},
            {"id": 3, "file_name": "c.jpg", "width": 100, "height": 80},
            {"id": 4, "file_name": "no_existe.jpg", "width": 100, "height": 80},
        ],
        "categories": [
            {"id": 1, "name": "cat"},
            {"id": 2, "name": "dog"},
            {"id": 3, "name": "bird"},
            {"id": 4, "name": "fish"},
            {"id": 5, "name": "car"},
        ],
        "annotations": [
            {"id": 10, "image_id": 1, "category_id": 1, "bbox": [10, 10, 40, 30]},
            {"id": 11, "image_id": 2, "category_id": 1, "bbox": [0, 0, 50.5, 40.2]},
            {"id": 12, "image_id": 3, "category_id": 2, "bbox": [5, 5, 40, 40]},
            {"id": 13, "image_id": 1, "category_id": 3, "bbox": [0, 0, 0, 10]},
            {"id": 14, "image_id": 2, "category_id": 3, "bbox": [90, 70, 20, 20]},
            {"id": 15, "image_id": 2, "category_id": 5, "bbox": [60, 40, 35, 35]},
            {"id": 16, "image_id": 3, "category_id": 5, "bbox": [50, 30, 40, 40]},
            {"id": 17, "image_id": 3, "category_id": 5, "bbox": [1, 1, 3, 3]},
            {"id": 18, "image_id": 4, "category_id": 5, "bbox": [0, 0, 40, 40]},
            {"id": 19, "image_id": 99, "category_id": 1, "bbox": [0, 0, 40, 40]},
            {"id": 20, "image_id": 1, "category_id": 42, "bbox": [0, 0, 40, 40]},
            {
                "id": 21,
                "image_id": 1,
                "category_id": 1,
                "bbox": [0, 0, 40, 40],
                "iscrowd": 1,
            },
        ],
    }


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
    return {
        "annotations": ann_path,
        "images_dir": images_dir,
        "out_dir": tmp_path / "out",
        "dvc_file": dvc_file,
    }


def _argv(ds: dict, *extra: str) -> list[str]:
    return [
        "--annotations", str(ds["annotations"]),
        "--images-dir", str(ds["images_dir"]),
        "--out-dir", str(ds["out_dir"]),
        "--release-tag", "v1.0.0",
        "--dvc-file", str(ds["dvc_file"]),
        "--min-area", "100",
        "--min-images", "2",
        *extra,
    ]  # fmt: skip


def _read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ---------------------------------------------------------------------------
# validate_box
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("bbox", "expected"),
    [
        ([10, 10, 20, 20], None),
        ([0, 0, 100, 80], None),  # exactamente la imagen completa
        ([10, 10, 0, 20], mc.R_NON_POSITIVE),
        ([10, 10, 20, -5], mc.R_NON_POSITIVE),
        ([-1, 10, 20, 20], mc.R_OUT_OF_IMAGE),
        ([90, 10, 20, 20], mc.R_OUT_OF_IMAGE),
        ([10, 70, 20, 20], mc.R_OUT_OF_IMAGE),
        ([10, 10, 5, 5], mc.R_TOO_SMALL),
        ([10, 10, 20], mc.R_MALFORMED),
        (None, mc.R_MALFORMED),
        ([10, "x", 20, 20], mc.R_MALFORMED),
        ([10, float("nan"), 20, 20], mc.R_MALFORMED),
    ],
)
def test_validate_box(bbox, expected):
    assert mc.validate_box(bbox, 100, 80, min_area=100) == expected


def test_area_exactamente_en_el_umbral_es_valida():
    assert mc.validate_box([0, 0, 10, 10], 100, 80, min_area=100) is None


# ---------------------------------------------------------------------------
# classify_annotations
# ---------------------------------------------------------------------------


def test_classify_motivos(dataset):
    valid, rejected = mc.classify_annotations(_coco(), 100, dataset["images_dir"])
    reasons = {ann["id"]: r for ann, r in rejected}
    assert [a["id"] for a in valid] == [10, 11, 12, 15, 16]
    assert reasons == {
        13: mc.R_NON_POSITIVE,
        14: mc.R_OUT_OF_IMAGE,
        17: mc.R_TOO_SMALL,
        18: mc.R_MISSING_FILE,
        19: mc.R_UNKNOWN_IMAGE,
        20: mc.R_UNKNOWN_CATEGORY,
        21: mc.R_CROWD,
    }


def test_keep_crowd_conserva_iscrowd():
    valid, _ = mc.classify_annotations(_coco(), 100, skip_crowd=False)
    assert 21 in {a["id"] for a in valid}


# ---------------------------------------------------------------------------
# Conteos y mapa de clases
# ---------------------------------------------------------------------------


def test_elegibilidad_y_mapa_contiguo(dataset):
    coco = _coco()
    valid, _ = mc.classify_annotations(coco, 100, dataset["images_dir"])
    stats = {r["category_name"]: r for r in mc.compute_class_stats(coco, valid, 2)}

    assert stats["cat"]["incluida"] and stats["car"]["incluida"]
    assert not stats["dog"]["incluida"]
    assert not stats["fish"]["incluida"]
    assert mc.build_class_map(list(stats.values())) == {"0": "cat", "1": "car"}


def test_elegibilidad_usa_cajas_validas_no_originales(dataset):
    coco = _coco()
    valid, _ = mc.classify_annotations(coco, 100, dataset["images_dir"])
    bird = next(
        r
        for r in mc.compute_class_stats(coco, valid, 2)
        if r["category_name"] == "bird"
    )
    assert bird["n_imagenes_originales"] == 2
    assert bird["n_imagenes_con_caja_valida"] == 0
    assert not bird["incluida"]
    assert "0 imágenes" in bird["motivo_exclusion"]


# ---------------------------------------------------------------------------
# Recortes
# ---------------------------------------------------------------------------


def test_crop_box_usa_floor_ceil():
    img = Image.new("RGB", (100, 80))
    assert mc.crop_box(img, [0, 0, 50.5, 40.2]).size == (51, 41)
    assert mc.crop_box(img, [10.7, 10.2, 20, 20]).size == (21, 21)


# ---------------------------------------------------------------------------
# End-to-end (CLI)
# ---------------------------------------------------------------------------


def test_main_genera_todos_los_artefactos(dataset, capsys):
    assert mc.main(_argv(dataset)) == 0
    out = dataset["out_dir"]

    for name in (
        "crops.csv",
        "classes.json",
        "class_counts.csv",
        "exclusions.json",
        "release_info.json",
    ):
        assert (out / name).is_file(), name

    crops = sorted(p.name for p in (out / "crops").iterdir())
    assert crops == [
        "1_10.jpg",
        "2_11.jpg",
        "2_15.jpg",
        "3_16.jpg",
    ]  # dog (12) excluida
    with Image.open(out / "crops" / "1_10.jpg") as im:
        assert im.size == (40, 30)
        assert im.mode == "RGB"

    rows = _read_csv(out / "crops.csv")
    assert list(rows[0]) == mc.CROPS_CSV_FIELDS
    assert [r["ann_id"] for r in rows] == ["10", "11", "15", "16"]
    assert rows[0] == {
        "crop_path": "crops/1_10.jpg",
        "ann_id": "10",
        "image_id": "1",
        "category_id": "1",
        "category_name": "cat",
        "class_index": "0",
    }

    assert json.loads((out / "classes.json").read_text()) == {"0": "cat", "1": "car"}

    info = json.loads((out / "release_info.json").read_text())
    assert info["release_tag"] == "v1.0.0"
    assert info["annotations_md5"] == mc.md5_file(dataset["annotations"])
    assert "abc123.dir" in info["dvc_file_content"]

    counts = _read_csv(out / "class_counts.csv")
    assert {r["annotations_md5"] for r in counts} == {info["annotations_md5"]}
    assert {r["release_tag"] for r in counts} == {"v1.0.0"}

    excl = json.loads((out / "exclusions.json").read_text())
    assert excl["cajas_descartadas"][mc.R_TOO_SMALL]["ann_ids"] == [17]
    assert {c["category_name"] for c in excl["clases_excluidas"]} == {
        "dog",
        "bird",
        "fish",
    }

    stdout = capsys.readouterr().out
    assert "Conteos por clase" in stdout
    assert "Clases excluidas" in stdout


def test_main_es_deterministico(dataset, tmp_path):
    assert mc.main(_argv(dataset)) == 0
    first = (dataset["out_dir"] / "crops.csv").read_text()
    first_crop = (dataset["out_dir"] / "crops" / "1_10.jpg").read_bytes()
    assert mc.main(_argv(dataset, "--overwrite")) == 0
    assert (dataset["out_dir"] / "crops.csv").read_text() == first
    assert (dataset["out_dir"] / "crops" / "1_10.jpg").read_bytes() == first_crop


def test_no_sobrescribe_sin_flag(dataset, capsys):
    assert mc.main(_argv(dataset)) == 0
    assert mc.main(_argv(dataset)) == 2
    assert "--overwrite" in capsys.readouterr().err


def test_advierte_si_hay_menos_de_dos_clases(dataset, capsys):
    assert mc.main(_argv(dataset, "--min-images", "3")) == 0
    assert "ADVERTENCIA" in capsys.readouterr().err


@pytest.mark.parametrize(
    ("contenido", "mensaje"),
    [
        (None, "No existe el archivo de anotaciones"),
        ("{no es json", "no es JSON válido"),
        ('{"images": []}', "llaves COCO"),
    ],
)
def test_errores_de_entrada_exit_2(dataset, capsys, contenido, mensaje):
    if contenido is None:
        dataset["annotations"].unlink()
    else:
        dataset["annotations"].write_text(contenido)
    assert mc.main(_argv(dataset)) == 2
    assert mensaje in capsys.readouterr().err


def test_dvc_file_inexistente_exit_2(dataset, capsys):
    dataset["dvc_file"] = dataset["dvc_file"].with_name("nope.dvc")
    assert mc.main(_argv(dataset)) == 2
    assert "archivo DVC" in capsys.readouterr().err
