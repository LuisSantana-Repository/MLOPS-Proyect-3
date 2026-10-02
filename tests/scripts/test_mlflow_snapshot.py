"""Copia del tracking store de MLflow a un SQLite versionable con DVC (P0-1).

La copia debe ser fila por fila: mismos run IDs, parámetros, métricas por época, tags,
URIs de artefactos y Model Registry. No se reescribe ni se inventa nada.
"""

from __future__ import annotations

from pathlib import Path

import boto3
import pytest
from mlflow.tracking import MlflowClient
from moto import mock_aws

from scripts.mlflow_snapshot import copy_tracking_store, mirror_bucket, table_counts


def sqlite_uri(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


@pytest.fixture
def source(tmp_path: Path) -> tuple[str, str]:
    """Store de origen con un run de barrido, métricas por época y una versión registrada."""
    uri = sqlite_uri(tmp_path / "origen.db")
    client = MlflowClient(uri)
    exp = client.create_experiment("proyecto3-clasificador", artifact_location="s3://mlflow/1")
    run = client.create_run(exp, run_name="t07-exp-07", tags={"sweep": "t07", "config_id": "exp-07"})
    rid = run.info.run_id
    client.log_param(rid, "img_size", "160")
    for step, value in enumerate([0.9, 0.5, 0.3], start=1):
        client.log_metric(rid, "val_loss", value, step=step, timestamp=1_000 + step)
    client.log_metric(rid, "best_val_loss", 0.3)
    client.set_tag(rid, "weights_sha256", "e5aa")
    client.set_terminated(rid)
    client.create_registered_model("clasificador")
    client.create_model_version("clasificador", f"s3://mlflow/1/{rid}/artifacts", rid, tags={"semver": "1.0.0"})
    client.set_registered_model_alias("clasificador", "champion", "1")
    return uri, rid


def test_copy_keeps_run_ids_params_metrics_tags_and_artifact_uris(source: tuple[str, str], tmp_path: Path) -> None:
    src_uri, rid = source
    dst = tmp_path / "store" / "mlflow.db"

    copy_tracking_store(src_uri, dst)

    original, copy = MlflowClient(src_uri).get_run(rid), MlflowClient(sqlite_uri(dst)).get_run(rid)
    assert copy.info.run_id == rid
    assert copy.info.status == "FINISHED"
    assert copy.info.start_time == original.info.start_time
    assert copy.info.artifact_uri == f"s3://mlflow/1/{rid}/artifacts"  # sin reescribir
    assert copy.data.params == original.data.params
    assert copy.data.metrics == original.data.metrics
    assert copy.data.tags == original.data.tags
    history = MlflowClient(sqlite_uri(dst)).get_metric_history(rid, "val_loss")
    assert [(m.step, m.value, m.timestamp) for m in sorted(history, key=lambda m: m.step)] == [
        (1, 0.9, 1_001),
        (2, 0.5, 1_002),
        (3, 0.3, 1_003),
    ]


def test_copy_keeps_the_model_registry_and_its_alias(source: tuple[str, str], tmp_path: Path) -> None:
    src_uri, rid = source
    dst = tmp_path / "mlflow.db"

    copy_tracking_store(src_uri, dst)

    client = MlflowClient(sqlite_uri(dst))
    version = client.get_model_version_by_alias("clasificador", "champion")
    assert version.version == "1"
    assert version.run_id == rid
    assert version.tags == {"semver": "1.0.0"}


def test_every_table_has_the_same_number_of_rows(source: tuple[str, str], tmp_path: Path) -> None:
    src_uri, _ = source
    dst = tmp_path / "mlflow.db"

    counts = copy_tracking_store(src_uri, dst)

    assert counts == table_counts(sqlite_uri(dst))
    assert counts == {k: v for k, v in table_counts(src_uri).items() if k in counts}
    assert counts["runs"] == 1
    assert counts["metrics"] == 4


def test_copy_refuses_to_overwrite_an_existing_store(source: tuple[str, str], tmp_path: Path) -> None:
    src_uri, _ = source
    dst = tmp_path / "mlflow.db"
    dst.write_bytes(b"no tocar")

    with pytest.raises(FileExistsError):
        copy_tracking_store(src_uri, dst)
    assert dst.read_bytes() == b"no tocar"


def test_source_tables_outside_mlflow_are_ignored(source: tuple[str, str], tmp_path: Path) -> None:
    """El MariaDB del stack también guarda tablas del portal (training_jobs, published_models)."""
    import sqlalchemy as sa

    src_uri, _ = source
    with sa.create_engine(src_uri).begin() as conn:
        conn.execute(sa.text("CREATE TABLE training_jobs (id TEXT PRIMARY KEY)"))
        conn.execute(sa.text("INSERT INTO training_jobs VALUES ('job-1')"))
    dst = tmp_path / "mlflow.db"

    counts = copy_tracking_store(src_uri, dst)

    assert "training_jobs" not in counts
    assert "training_jobs" not in table_counts(sqlite_uri(dst))


@mock_aws
def test_mirror_bucket_copies_every_artifact_byte_for_byte(tmp_path: Path) -> None:
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket="mlflow")
    s3.put_object(Bucket="mlflow", Key="1/abc/artifacts/weights.pt", Body=b"\x00pesos")
    s3.put_object(Bucket="mlflow", Key="1/abc/artifacts/source/source_diff.patch", Body=b"diff")

    copied = mirror_bucket(s3, "mlflow", tmp_path / "artifacts")
    assert copied == 2
    assert (tmp_path / "artifacts/1/abc/artifacts/weights.pt").read_bytes() == b"\x00pesos"
    assert (tmp_path / "artifacts/1/abc/artifacts/source/source_diff.patch").read_bytes() == b"diff"

    assert mirror_bucket(s3, "mlflow", tmp_path / "artifacts") == 0  # idempotente: no vuelve a bajar
