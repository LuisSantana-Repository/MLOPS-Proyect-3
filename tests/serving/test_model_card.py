"""Tarjeta del modelo (T15): datos reales, sin placeholders y coherente con el artefacto."""

from __future__ import annotations

import copy
import json
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from serving import model_card, storage
from serving.model_card import (
    CardContext,
    CardError,
    TestResults,
    collect_context,
    majority_baseline,
    render_card,
    upload_card,
    wilson_interval,
)
from tests.serving.conftest import TEST_BUCKET

RUN_ID = "fe32e1388dbd465cae714a69bf80f685"
SHA = "e5aa4f73e607bf593eade2cc9c0194e468a425613aea8042f155c4a3e82af630"
MANIFEST = "0bdfd6d7efd40f17903df10695b3e34177d535071b76ac0c5404a215428ed578"


def make_test() -> TestResults:
    return TestResults(
        n_samples=135,
        accuracy=128 / 135,
        f1_macro=0.9458,
        per_class={
            "person": {"precision": 0.9512, "recall": 0.9630, "f1": 0.9571, "support": 81},
            "car": {"precision": 0.9434, "recall": 0.9259, "f1": 0.9346, "support": 54},
        },
        labels=["person", "car"],
        matrix=[[78, 3], [4, 50]],
        evaluated_at="2026-09-30T21:17:09+00:00",
    )


@pytest.fixture
def ctx() -> CardContext:
    return CardContext(
        name="clasificador",
        version="1.0.0",
        published_at="2026-10-01 05:44 UTC",
        s3_uri="s3://bucket-x/models/clasificador/1.0.0",
        weights_sha256=SHA,
        dvc_release="proyecto2 v1.1.0@dc9376e",
        run_id=RUN_ID,
        run_name="t07-exp-07",
        params={"optimizer": "adamw", "img_size": "160", "monitor": "val_loss", "hidden_layers": "[256]"},
        tags={
            "classes": '["person", "car"]',
            "manifest_sha256": MANIFEST,
            "test_weights_sha256": SHA,
            "git_commit": "9a53bc5",
            "git_dirty": "true",
        },
        val_metrics={"best_val_loss": 0.0463, "best_val_acc": 0.9778, "best_epoch": 10, "stopped_epoch": 15},
        test=make_test(),
        classes=["person", "car"],
        preprocess={
            "color_mode": "RGB",
            "resize": {"height": 160, "width": 160, "interpolation": "bilinear", "antialias": True},
            "normalize": {"mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
            "input_layout": "NCHW float32",
        },
        summary={
            "data": {"manifest_sha256": MANIFEST},
            "model": {
                "arch": {
                    "backbone": "resnet18",
                    "hidden_layers": [256],
                    "dropout": 0.3,
                    "trainable_backbone": "layer4",
                },
                "pretrained_weights": {"source": "torchvision IMAGENET1K_V1", "dataset": "ImageNet-1k"},
            },
        },
        selection={
            "run_id": RUN_ID,
            "selected_at": "2026-09-28T03:21:04+00:00",
            "criterion": {"metric": "best_val_loss", "mode": "min", "split": "val"},
            "candidates": [RUN_ID] * 10,
        },
        split_counts={
            "person": {"train": 569, "val": 162, "test": 81, "total": 812},
            "car": {"train": 375, "val": 108, "test": 54, "total": 537},
        },
        leakage={"semilla": 42, "fuga": {"total": 0}, "test_huella_sha256": "2da0"},
        exclusions={
            "parametros": {"min_area": 1024, "min_images": 300},
            "cajas_descartadas": {"area_menor_al_umbral": {"n": 6}},
            "clases_excluidas": [{"category_name": "dog", "motivo": "71 imágenes con caja válida (< 300)"}],
        },
        registry_version="1",
    )


# --- Render -------------------------------------------------------------------


def test_card_has_every_required_section_and_real_values(ctx: CardContext) -> None:
    card = render_card(ctx)
    for section in (
        "## Propósito y uso previsto",
        "## Datos de origen",
        "## Modelo y entrenamiento",
        "## Desempeño en test",
        "## Preprocesamiento exacto",
        "## Limitaciones y sesgos",
        "## Cómo descargarlo y cargarlo",
    ):
        assert section in card, section
    for value in (
        "proyecto2 v1.1.0@dc9376e",
        SHA,
        RUN_ID,
        MANIFEST,
        "94.81 %",
        "(128/135)",
        "60.00 %",  # baseline de la clase mayoritaria
        "160×160",
        "torchvision IMAGENET1K_V1",
        "`dog`",
        "**fuga = 0**",
        "| person | 78 | 3 |",
        "s3://bucket-x/models/clasificador/1.0.0/",
        "source/source_diff.patch",
    ):
        assert value in card, value
    assert "{{" not in card and "}}" not in card


def test_card_links_the_source_boxes_of_the_crops(ctx: CardContext) -> None:
    """P2-1: la sección de datos enlaza el archivo con la caja de origen de cada recorte."""
    card = render_card(ctx)
    section = card.split("## Datos de origen")[1].split("\n## ")[0]
    assert "`data/crops/crops_source_boxes.csv`" in section
    assert "caja COCO de origen" in section


def test_majority_baseline_and_wilson_interval() -> None:
    assert majority_baseline(make_test()) == ("person", 81 / 135)
    low, high = wilson_interval(128, 135)
    assert low == pytest.approx(0.8970, abs=1e-3)
    assert high == pytest.approx(0.9747, abs=1e-3)
    assert wilson_interval(0, 0) == (0.0, 0.0)


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda c: setattr(c, "classes", ["car", "person"]), "clases del test"),
        (lambda c: c.test.matrix.__setitem__(0, [78, 2]), "suma 134"),
        (lambda c: setattr(c.test, "accuracy", 0.99), "diagonal"),
        (lambda c: c.tags.__setitem__("test_weights_sha256", "otro"), "otros pesos"),
        (lambda c: c.selection.__setitem__("run_id", "otro-run"), "selection.json"),
        (lambda c: c.summary["data"].__setitem__("manifest_sha256", "otro"), "mismo manifiesto"),
    ],
)
def test_incoherent_sources_are_rejected(ctx: CardContext, mutate, message: str) -> None:
    broken = copy.deepcopy(ctx)
    mutate(broken)
    with pytest.raises(CardError, match=message):
        render_card(broken)


# --- Recolección desde S3 + MLflow + repo ---------------------------------------


class FakeMlflowClient:
    """Run de MLflow mínimo con las métricas test_* y la matriz que deja T08."""

    def __init__(self, matrix_dir: Path, *args, **kwargs) -> None:
        self.matrix_dir = matrix_dir

    def get_run(self, run_id: str):
        metrics = {
            "best_val_loss": 0.0463,
            "best_val_acc": 0.9778,
            "best_epoch": 10.0,
            "stopped_epoch": 15.0,
            "test_accuracy": 128 / 135,
            "test_f1_macro": 0.9458,
            "test_n_samples": 135.0,
        }
        for c, vals in make_test().per_class.items():
            for k, v in vals.items():
                metrics[f"test_{k}_{c}"] = float(v)
        return SimpleNamespace(
            info=SimpleNamespace(run_id=run_id, run_name="t07-exp-07"),
            data=SimpleNamespace(metrics=metrics, params={"optimizer": "adamw"}, tags={"git_commit": "abc"}),
        )

    def download_artifacts(self, run_id: str, path: str, dst: str) -> str:
        target = Path(dst) / "confusion_matrix.json"
        target.write_text(json.dumps({"labels": ["person", "car"], "matrix": [[78, 3], [4, 50]]}))
        return str(target)

    def search_model_versions(self, _filter: str):
        return [SimpleNamespace(version="1", tags={"semver": "1.0.0"})]


def _repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "reports" / "t07").mkdir(parents=True)
    (root / "data" / "splits").mkdir(parents=True)
    (root / "data" / "crops").mkdir(parents=True)
    (root / "reports" / "t07" / "selection.json").write_text(json.dumps({"run_id": RUN_ID}))
    (root / "data" / "splits" / "split_report.csv").write_text(
        "clase,total,train,train_pct,val,val_pct,test,test_pct\n"
        "car,537,375,69.8,108,20.1,54,10.1\nperson,812,569,70.1,162,20.0,81,10.0\n"
        "TOTAL,1349,944,70.0,270,20.0,135,10.0\n"
    )
    (root / "data" / "splits" / "leakage_report.json").write_text(json.dumps({"fuga": {"total": 0}}))
    (root / "data" / "crops" / "exclusions.json").write_text(json.dumps({"clases_excluidas": []}))
    return root


def test_collect_context_reads_the_published_package_and_verifies_its_hash(
    trained_package: Path, s3_bucket, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, settings = s3_bucket
    storage.upload_package(client, settings.bucket, trained_package, "1.0.0")
    sha = storage.sha256_file(trained_package / "weights.pt")
    row = {
        "run_id": RUN_ID,
        "sha256": sha,
        "dvc_release": "proyecto2 v1.1.0@dc9376e",
        "created_at": datetime(2026, 9, 30),
    }
    monkeypatch.setattr(model_card.db, "connect", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(model_card.db, "get_model_version", lambda conn, version, name: row)
    monkeypatch.setattr("mlflow.tracking.MlflowClient", lambda *a, **k: FakeMlflowClient(tmp_path))

    ctx = collect_context("1.0.0", repo_root=_repo(tmp_path), s3_settings=settings)

    assert ctx.weights_sha256 == sha
    assert ctx.s3_uri == f"s3://{TEST_BUCKET}/models/clasificador/1.0.0"
    assert ctx.registry_version == "1"
    assert ctx.test.matrix == [[78, 3], [4, 50]]
    assert ctx.split_counts["car"]["test"] == 54
    assert "UTC" in ctx.published_at
    # classes.json y preprocess.json salen del paquete publicado, no de constantes
    published = json.loads((trained_package / "classes.json").read_text())
    assert ctx.classes == [published[str(i)] for i in range(len(published))]
    assert ctx.preprocess == json.loads((trained_package / "preprocess.json").read_text())


def test_collect_context_fails_if_published_weights_were_tampered(
    trained_package: Path, s3_bucket, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, settings = s3_bucket
    storage.upload_package(client, settings.bucket, trained_package, "1.0.0")
    row = {"run_id": RUN_ID, "sha256": "0" * 64, "dvc_release": None, "created_at": datetime(2026, 9, 30)}
    monkeypatch.setattr(model_card.db, "connect", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(model_card.db, "get_model_version", lambda conn, version, name: row)
    monkeypatch.setattr("mlflow.tracking.MlflowClient", lambda *a, **k: FakeMlflowClient(tmp_path))
    with pytest.raises(storage.IntegrityError):
        collect_context("1.0.0", repo_root=_repo(tmp_path), s3_settings=settings)


def test_unpublished_version_is_rejected(monkeypatch: pytest.MonkeyPatch, s3_bucket) -> None:
    _, settings = s3_bucket
    monkeypatch.setattr(model_card.db, "connect", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(model_card.db, "get_model_version", lambda conn, version, name: None)
    with pytest.raises(CardError, match="published_models"):
        collect_context("9.9.9", s3_settings=settings)


def test_upload_card_puts_it_next_to_the_package(s3_bucket, tmp_path: Path) -> None:
    client, settings = s3_bucket
    card = tmp_path / "model_card.md"
    card.write_bytes(b"# Tarjeta\n")
    uri = upload_card(card, "1.0.0", settings)
    assert uri == f"s3://{TEST_BUCKET}/models/clasificador/1.0.0/model_card.md"
    obj = client.get_object(Bucket=TEST_BUCKET, Key="models/clasificador/1.0.0/model_card.md")
    assert obj["Body"].read() == b"# Tarjeta\n"
    assert obj["ContentType"].startswith("text/markdown")
