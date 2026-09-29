import csv
import hashlib
import json
from pathlib import Path

import evaluate_final as ev
import numpy as np
import pytest
from PIL import Image

CLASSES = ["person", "car"]

# ---------------------------------------------------------------------------
# Fixture: manifiesto + recortes + run de MLflow (file store) + selection.json
# ---------------------------------------------------------------------------
#  12 recortes de test (6 person, 6 car) más filas de train/val que no deben usarse.
#  El modelo falso acierta todo excepto el recorte con ann_id 1011 (car -> person).

WRONG_ANN_ID = 1011


class FakeLoaded:
    classes = CLASSES


def _fake_predict(loaded, paths, batch_size=64):
    probs = []
    for p in paths:
        ann_id = int(Path(p).stem.split("_")[1])
        true_is_person = ann_id % 2 == 0
        predict_person = true_is_person != (ann_id == WRONG_ANN_ID)
        probs.append([0.9, 0.1] if predict_person else [0.2, 0.8])
    return np.array(probs)


@pytest.fixture
def env(tmp_path, monkeypatch):
    mlflow = pytest.importorskip("mlflow")

    data_root = tmp_path / "data" / "crops"
    (data_root / "crops").mkdir(parents=True)
    rows = []
    for split, start, n in (("train", 1, 6), ("val", 101, 4), ("test", 1000, 12)):
        for ann_id in range(start, start + n):
            cls = "person" if ann_id % 2 == 0 else "car"
            crop = f"crops/{ann_id}_{ann_id}.jpg"
            Image.new("RGB", (20, 20), (ann_id % 255, 0, 0)).save(data_root / crop)
            rows.append(
                {
                    "crop_path": crop,
                    "ann_id": ann_id,
                    "image_id": ann_id,
                    "category_id": 1 if cls == "person" else 3,
                    "category_name": cls,
                    "class_index": CLASSES.index(cls),
                    "group_id": f"img{ann_id:06d}",
                    "split": split,
                }
            )
    manifest = tmp_path / "manifest.csv"
    with manifest.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    test_ids = sorted(r["ann_id"] for r in rows if r["split"] == "test")
    leakage = tmp_path / "leakage_report.json"
    leakage.write_text(json.dumps({"test_huella_sha256": ev.fingerprint_test_ids(test_ids)}))

    package = tmp_path / "package"
    package.mkdir()
    (package / "weights.pt").write_bytes(b"pesos de prueba")
    (package / "classes.json").write_text(json.dumps({"0": "person", "1": "car"}))
    (package / "preprocess.json").write_text(json.dumps({"format_version": 1}))

    uri = (tmp_path / "mlruns").as_uri()
    monkeypatch.setenv("MLFLOW_TRACKING_URI", uri)
    mlflow.set_tracking_uri(uri)
    mlflow.set_experiment("proyecto3-clasificador")
    with mlflow.start_run() as run:
        mlflow.set_tag("manifest_sha256", ev.sha256_file(manifest))
        mlflow.log_metric("best_val_loss", 0.05)
        for name in ev.PACKAGE_FILES:
            mlflow.log_artifact(str(package / name))
    run_id = run.info.run_id

    selection = tmp_path / "selection.json"
    selection.write_text(
        json.dumps(
            {
                "test_split_used": False,
                "run_id": run_id,
                "checkpoint": {"artifact": "weights.pt", "sha256": ev.sha256_file(package / "weights.pt")},
                "data": {"manifest_sha256": ev.sha256_file(manifest)},
            }
        )
    )

    monkeypatch.setattr(ev, "load_package", lambda package_dir, device: FakeLoaded())
    monkeypatch.setattr(ev, "predict_proba", _fake_predict)
    return {
        "run_id": run_id,
        "selection": selection,
        "manifest": manifest,
        "leakage": leakage,
        "data_root": data_root,
        "package": package,
        "out_dir": tmp_path / "reports" / "t08",
        "client": ev.mlflow_client(),
    }


def _argv(e: dict, *extra: str) -> list[str]:
    return [
        "--run-id", e["run_id"],
        "--selection", str(e["selection"]),
        "--manifest", str(e["manifest"]),
        "--leakage-report", str(e["leakage"]),
        "--data-root", str(e["data_root"]),
        "--out-dir", str(e["out_dir"]),
        *extra,
    ]  # fmt: skip


# ---------------------------------------------------------------------------
# Métricas recalculables desde predictions.csv
# ---------------------------------------------------------------------------


def _write_csv(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def _pred(ann_id, y_true, y_pred):
    p_person = 0.9 if y_pred == "person" else 0.1
    return {"ann_id": ann_id, "y_true": y_true, "y_pred": y_pred, "prob_person": p_person, "prob_car": 1 - p_person}


def test_metricas_desde_predictions(tmp_path):
    path = tmp_path / "predictions.csv"
    _write_csv(
        path,
        [
            _pred(1, "person", "person"),
            _pred(2, "person", "person"),
            _pred(3, "person", "car"),
            _pred(4, "car", "car"),
        ],
    )
    m = ev.metrics_from_predictions(path, CLASSES)
    assert m["n_samples"] == 4
    assert m["accuracy"] == pytest.approx(0.75)
    # person: P=1, R=2/3, F1=0.8 ; car: P=1/2, R=1, F1=2/3
    assert m["per_class"]["person"]["f1"] == pytest.approx(0.8)
    assert m["per_class"]["car"]["f1"] == pytest.approx(2 / 3)
    assert m["f1_macro"] == pytest.approx((0.8 + 2 / 3) / 2)
    assert m["per_class"]["person"]["support"] == 3
    assert m["confusion_matrix"] == {"labels": CLASSES, "matrix": [[2, 1], [0, 1]]}


def test_predictions_inconsistente_se_detecta(tmp_path):
    path = tmp_path / "predictions.csv"
    bad = _pred(1, "person", "person")
    bad["prob_person"], bad["prob_car"] = 0.1, 0.9  # y_pred no es el argmax
    _write_csv(path, [bad])
    with pytest.raises(ev.IntegrityError):
        ev.metrics_from_predictions(path, CLASSES)


def test_flat_metrics_con_prefijo_test():
    m = {
        "n_samples": 2,
        "accuracy": 1.0,
        "f1_macro": 1.0,
        "per_class": {"person": {"precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}},
    }
    flat = ev.flat_metrics(m)
    assert all(k.startswith("test_") for k in flat)
    assert flat["test_support_person"] == 1.0


def test_huella_igual_a_la_de_t04():
    make_split = pytest.importorskip("make_split")
    manifest = [{"ann_id": i, "split": "test"} for i in (5, 3, 9)]
    assert ev.fingerprint_test_ids([5, 3, 9]) == make_split.fingerprint_test_split(manifest)


# ---------------------------------------------------------------------------
# Flujo completo
# ---------------------------------------------------------------------------


def test_evaluacion_completa(env, capsys):
    assert ev.main(_argv(env, "--package-dir", str(env["package"]))) == 0
    out = env["out_dir"]
    for name in ("predictions.csv", "metrics.json", "classification_report.json", "confusion_matrix.json"):
        assert (out / name).is_file(), name
    assert (out / "confusion_matrix.png").stat().st_size > 0

    with (out / "predictions.csv").open() as f:
        preds = list(csv.DictReader(f))
    assert len(preds) == 12  # solo split=test
    assert [int(p["ann_id"]) for p in preds] == list(range(1000, 1012))
    assert list(preds[0]) == [
        "crop_path",
        "ann_id",
        "image_id",
        "y_true",
        "y_pred",
        "correct",
        "prob_person",
        "prob_car",
    ]
    wrong = [p for p in preds if p["correct"] == "0"]
    assert [int(p["ann_id"]) for p in wrong] == [WRONG_ANN_ID]

    metrics = json.loads((out / "metrics.json").read_text())
    assert metrics["accuracy"] == pytest.approx(11 / 12)
    assert "cumple" in capsys.readouterr().out


def test_metricas_en_mlflow_son_recalculables(env):
    assert ev.main(_argv(env, "--package-dir", str(env["package"]))) == 0
    run = env["client"].get_run(env["run_id"])

    recalculated = ev.flat_metrics(ev.metrics_from_predictions(env["out_dir"] / "predictions.csv", CLASSES))
    for key, value in recalculated.items():
        assert run.data.metrics[key] == pytest.approx(value), key

    tags = run.data.tags
    assert tags["test_manifest_sha256"] == ev.sha256_file(env["manifest"])
    assert tags["test_meets_target"] == "true"
    assert run.data.metrics["best_val_loss"] == 0.05  # lo de T07 no se toca

    artifacts = {a.path for a in env["client"].list_artifacts(env["run_id"], "test")}
    assert "test/predictions.csv" in artifacts
    assert "test/confusion_matrix.png" in artifacts


def test_descarga_el_modelo_del_run(env):
    assert ev.main(_argv(env)) == 0  # sin --package-dir: baja weights.pt del run


# ---------------------------------------------------------------------------
# El test se evalúa una sola vez y con lo congelado
# ---------------------------------------------------------------------------


def test_solo_una_vez(env, capsys):
    assert ev.main(_argv(env, "--package-dir", str(env["package"]))) == 0
    assert ev.main(_argv(env, "--package-dir", str(env["package"]))) == 5
    (env["out_dir"] / "predictions.csv").unlink()  # aunque se borre la salida, el run ya tiene test_*
    assert ev.main(_argv(env, "--package-dir", str(env["package"]))) == 5
    assert "una sola vez" in capsys.readouterr().err


def test_run_distinto_al_congelado(env):
    selection = json.loads(env["selection"].read_text())
    selection["run_id"] = "otro_run"
    env["selection"].write_text(json.dumps(selection))
    assert ev.main(_argv(env, "--package-dir", str(env["package"]))) == 4


def test_seleccion_que_uso_test(env):
    selection = json.loads(env["selection"].read_text())
    selection["test_split_used"] = True
    env["selection"].write_text(json.dumps(selection))
    assert ev.main(_argv(env, "--package-dir", str(env["package"]))) == 4


def test_manifiesto_modificado(env, capsys):
    with env["manifest"].open("a") as f:
        f.write("crops/x.jpg,9999,9999,1,person,0,img009999,train\n")
    assert ev.main(_argv(env, "--package-dir", str(env["package"]))) == 4
    assert "manifiesto cambió" in capsys.readouterr().err


def test_pesos_distintos(env, capsys):
    (env["package"] / "weights.pt").write_bytes(b"otros pesos")
    assert ev.main(_argv(env, "--package-dir", str(env["package"]))) == 4
    assert "weights.pt no es el congelado" in capsys.readouterr().err


def test_huella_de_test_distinta(env, capsys):
    env["leakage"].write_text(json.dumps({"test_huella_sha256": hashlib.sha256(b"x").hexdigest()}))
    assert ev.main(_argv(env, "--package-dir", str(env["package"]))) == 4
    assert "huella de T04" in capsys.readouterr().err


def test_recorte_faltante(env, capsys):
    (env["data_root"] / "crops" / "1000_1000.jpg").unlink()
    assert ev.main(_argv(env, "--package-dir", str(env["package"]))) == 2
    assert "dvc pull" in capsys.readouterr().err


def test_nada_se_registra_si_falla_una_verificacion(env):
    (env["package"] / "weights.pt").write_bytes(b"otros pesos")
    assert ev.main(_argv(env, "--package-dir", str(env["package"]))) == 4
    run = env["client"].get_run(env["run_id"])
    assert not [k for k in run.data.metrics if k.startswith("test_")]
    assert not (env["out_dir"] / "predictions.csv").exists()


# ---------------------------------------------------------------------------
# Inferencia real con el entrenador (requiere PyTorch)
# ---------------------------------------------------------------------------


def test_inferencia_real_con_el_preprocess_de_validacion(tmp_path):
    torch = pytest.importorskip("torch")
    from trainer.data import preprocess_spec
    from trainer.model import CropClassifier, arch_spec, save_checkpoint

    torch.manual_seed(0)
    model = CropClassifier(num_classes=2, hidden_layers=[8], dropout=0.0, pretrained=False)
    save_checkpoint(tmp_path / "weights.pt", model, arch_spec(2, [8], 0.0, "none"), CLASSES, extra={})
    (tmp_path / "classes.json").write_text(json.dumps({"0": "person", "1": "car"}))
    (tmp_path / "preprocess.json").write_text(json.dumps(preprocess_spec(32)))

    paths = []
    for i in range(5):
        p = tmp_path / f"crop_{i}.png"
        Image.new("RGB", (40 + 7 * i, 30 + 3 * i), (40 * i, 100, 200)).save(p)
        paths.append(p)

    loaded = ev.load_package(tmp_path, "cpu")
    assert loaded.classes == CLASSES
    probs = ev.predict_proba(loaded, paths, batch_size=2)
    assert probs.shape == (5, 2)
    assert np.allclose(probs.sum(axis=1), 1.0, atol=1e-5)
    assert np.allclose(probs, ev.predict_proba(loaded, paths, batch_size=5), atol=1e-6)  # determinista
