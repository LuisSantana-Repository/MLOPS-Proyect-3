import csv
import json
from pathlib import Path

import make_split as ms
import numpy as np
import pytest
from PIL import Image

# ---------------------------------------------------------------------------
# Fixture: 40 imágenes distintas + una cadena de duplicados cercanos
# ---------------------------------------------------------------------------
#  Imágenes 1..40: ruido aleatorio distinto (pHash muy diferente entre sí).
#  Imagen 41: la 1 redimensionada y más clara  -> duplicado cercano de la 1.
#  Imagen 42: la 41 redimensionada otra vez    -> duplicado de la 41 (y de la 1).
#  Las tres deben quedar en el mismo grupo y en el mismo split.

N_DISTINCT = 40
DUP_CHAIN = (1, 41, 42)


def _noise_image(seed: int) -> Image.Image:
    rng = np.random.default_rng(seed)
    small = (rng.random((16, 16)) * 255).astype("uint8")
    return Image.fromarray(small).resize((128, 128), Image.NEAREST).convert("RGB")


def _write_dataset(root: Path) -> dict:
    images_dir = root / "images"
    images_dir.mkdir()
    coco_images = []
    for i in range(1, N_DISTINCT + 1):
        _noise_image(i).save(images_dir / f"{i}.png")
        coco_images.append({"id": i, "file_name": f"{i}.png", "width": 128, "height": 128})
    dup = _noise_image(1).resize((120, 120)).point(lambda v: min(255, v + 8))
    dup.save(images_dir / "41.png")
    dup.resize((110, 110)).save(images_dir / "42.png")
    coco_images += [
        {"id": 41, "file_name": "41.png", "width": 120, "height": 120},
        {"id": 42, "file_name": "42.png", "width": 110, "height": 110},
    ]
    annotations = root / "coco.json"
    annotations.write_text(json.dumps({"images": coco_images}))

    rows, ann_id = [], 100
    for i in [*range(1, N_DISTINCT + 1), 41, 42]:
        classes = ["person", "car"] if i % 5 == 0 else ["person" if i % 2 else "car"]
        for cls in classes:
            rows.append(
                {
                    "crop_path": f"crops/{i}_{ann_id}.jpg",
                    "ann_id": ann_id,
                    "image_id": i,
                    "category_id": 1 if cls == "person" else 3,
                    "category_name": cls,
                    "class_index": 0 if cls == "person" else 1,
                }
            )
            ann_id += 1
    crops_csv = root / "crops.csv"
    with crops_csv.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    return {"crops_csv": crops_csv, "annotations": annotations, "images_dir": images_dir}


@pytest.fixture
def dataset(tmp_path: Path) -> dict:
    return _write_dataset(tmp_path)


def _argv(ds: dict, out_dir: Path, *extra: str) -> list[str]:
    return [
        "--crops-csv", str(ds["crops_csv"]),
        "--annotations", str(ds["annotations"]),
        "--images-dir", str(ds["images_dir"]),
        "--out-dir", str(out_dir),
        *extra,
    ]  # fmt: skip


def _read_manifest(out_dir: Path) -> list[dict]:
    with (out_dir / "manifest.csv").open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _ids_by_split(manifest: list[dict]) -> dict[str, list[str]]:
    return {s: sorted(r["ann_id"] for r in manifest if r["split"] == s) for s in ms.SPLITS}


# ---------------------------------------------------------------------------
# Duplicados cercanos y grupos
# ---------------------------------------------------------------------------


def test_hamming():
    assert ms.hamming(0b1011, 0b0010) == 2
    assert ms.hamming(5, 5) == 0


def test_near_duplicate_pairs_respeta_umbral():
    hashes = {1: 0b0000, 2: 0b0011, 3: 0b1111}
    assert ms.near_duplicate_pairs(hashes, 2) == [(1, 2), (2, 3)]
    assert ms.near_duplicate_pairs(hashes, 1) == []


def test_grupos_son_transitivos_y_estables():
    groups = ms.build_groups({1, 2, 3, 9}, [(2, 3), (1, 3)])
    assert groups[1] == groups[2] == groups[3] == "img000001"
    assert groups[9] == "img000009"


def test_detecta_la_cadena_de_duplicados(dataset):
    paths = {i: dataset["images_dir"] / f"{i}.png" for i in DUP_CHAIN + (2, 3)}
    pairs = ms.near_duplicate_pairs(ms.compute_phashes(paths), ms.DEFAULT_PHASH_THRESHOLD)
    groups = ms.build_groups(set(paths), pairs)
    assert groups[1] == groups[41] == groups[42]
    assert groups[2] != groups[1] and groups[3] != groups[1]


# ---------------------------------------------------------------------------
# Criterio del ticket: fuga = 0 y misma semilla -> mismos IDs
# ---------------------------------------------------------------------------


def test_fuga_cero(dataset, tmp_path):
    out = tmp_path / "out"
    assert ms.main(_argv(dataset, out)) == 0
    manifest = _read_manifest(out)

    splits_por_grupo: dict[str, set] = {}
    for r in manifest:
        splits_por_grupo.setdefault(r["group_id"], set()).add(r["split"])
    assert all(len(s) == 1 for s in splits_por_grupo.values())

    report = json.loads((out / "leakage_report.json").read_text())
    assert report["fuga"]["total"] == 0


def test_duplicados_cercanos_viajan_juntos(dataset, tmp_path):
    out = tmp_path / "out"
    assert ms.main(_argv(dataset, out)) == 0
    por_imagen = {int(r["image_id"]): (r["group_id"], r["split"]) for r in _read_manifest(out)}
    assert por_imagen[1] == por_imagen[41] == por_imagen[42]


def test_misma_semilla_mismos_ids(dataset, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    assert ms.main(_argv(dataset, a, "--seed", "7")) == 0
    assert ms.main(_argv(dataset, b, "--seed", "7")) == 0
    assert _ids_by_split(_read_manifest(a)) == _ids_by_split(_read_manifest(b))
    assert (a / "manifest.csv").read_bytes() == (b / "manifest.csv").read_bytes()


def test_otra_semilla_cambia_el_test(dataset, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    assert ms.main(_argv(dataset, a, "--seed", "1")) == 0
    assert ms.main(_argv(dataset, b, "--seed", "2")) == 0
    assert _ids_by_split(_read_manifest(a))["test"] != _ids_by_split(_read_manifest(b))["test"]


def test_proporciones_aproximadas(dataset, tmp_path):
    out = tmp_path / "out"
    assert ms.main(_argv(dataset, out)) == 0
    grupos = {}
    for r in _read_manifest(out):
        grupos[r["group_id"]] = r["split"]
    n = {s: sum(1 for v in grupos.values() if v == s) for s in ms.SPLITS}
    assert n["train"] > n["val"] > n["test"] > 0


# ---------------------------------------------------------------------------
# El detector de fuga funciona (si no, "fuga = 0" no demostraría nada)
# ---------------------------------------------------------------------------


def test_find_leakage_detecta_fuga_inyectada():
    manifest = [
        {"image_id": 1, "group_id": "img000001", "split": "train"},
        {"image_id": 1, "group_id": "img000001", "split": "test"},
        {"image_id": 2, "group_id": "img000002", "split": "train"},
        {"image_id": 3, "group_id": "img000003", "split": "val"},
    ]
    leak = ms.find_leakage(manifest, hashes={1: 0, 2: 0b1, 3: 0b11}, threshold=2)
    assert leak["grupos_en_varios_splits"] == ["img000001"]
    assert leak["imagenes_en_varios_splits"] == [1]
    assert leak["duplicados_cercanos_entre_splits"] == [[2, 3]]
    assert leak["total"] == 3


def test_main_sale_con_3_si_hay_fuga(dataset, tmp_path, monkeypatch, capsys):
    # Sin unir duplicados y mandando la 1 a train y la 41 a test, debe haber fuga.
    monkeypatch.setattr(ms, "build_groups", lambda ids, pairs: {i: f"img{i:06d}" for i in ids})
    monkeypatch.setattr(
        ms, "assign_splits", lambda rows, g, seed: {v: "test" if v == "img000041" else "train" for v in g.values()}
    )
    assert ms.main(_argv(dataset, tmp_path / "out")) == 3
    assert "fuga" in capsys.readouterr().err


def test_huella_del_test_cambia_con_un_recorte():
    base = [{"ann_id": 1, "split": "test"}, {"ann_id": 2, "split": "train"}]
    otro = [{"ann_id": 1, "split": "test"}, {"ann_id": 2, "split": "test"}]
    assert ms.fingerprint_test_split(base) != ms.fingerprint_test_split(otro)
    assert ms.fingerprint_test_split(base) == ms.fingerprint_test_split(list(reversed(base)))


# ---------------------------------------------------------------------------
# Errores de entrada
# ---------------------------------------------------------------------------


def test_csv_inexistente_exit_2(dataset, tmp_path, capsys):
    dataset["crops_csv"] = tmp_path / "nope.csv"
    assert ms.main(_argv(dataset, tmp_path / "out")) == 2
    assert "No existe el CSV" in capsys.readouterr().err


def test_columna_faltante_exit_2(dataset, tmp_path, capsys):
    dataset["crops_csv"].write_text("crop_path,ann_id\ncrops/a.jpg,1\n")
    assert ms.main(_argv(dataset, tmp_path / "out")) == 2
    assert "faltan columnas" in capsys.readouterr().err


def test_imagen_original_faltante_exit_2(dataset, tmp_path, capsys):
    (dataset["images_dir"] / "3.png").unlink()
    assert ms.main(_argv(dataset, tmp_path / "out")) == 2
    assert "Faltan 1 imágenes" in capsys.readouterr().err


def test_pocos_grupos_exit_2(tmp_path, capsys):
    ds = _write_dataset(tmp_path)
    with ds["crops_csv"].open(encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if int(r["image_id"]) <= 5]
    with ds["crops_csv"].open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    assert ms.main(_argv(ds, tmp_path / "out")) == 2
    assert "al menos 10 grupos" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# Manifiesto real (se salta si todavía no existe o no se hizo dvc pull)
# ---------------------------------------------------------------------------

REAL_MANIFEST = Path(__file__).resolve().parents[2] / "data" / "splits" / "manifest.csv"


@pytest.mark.skipif(not REAL_MANIFEST.is_file(), reason="manifiesto real no disponible")
def test_manifiesto_real_sin_fuga():
    with REAL_MANIFEST.open(encoding="utf-8") as f:
        manifest = list(csv.DictReader(f))
    assert ms.find_leakage(manifest)["total"] == 0
