"""Avisos opcionales de run_tracked para el worker del portal (on_start y on_epoch)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from trainer.config import TrainConfig
from trainer.tracking import EPOCH_METRICS, run_tracked


@pytest.fixture
def mlflow_uri(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    uri = (tmp_path / "mlruns").resolve().as_uri()
    monkeypatch.setenv("MLFLOW_TRACKING_URI", uri)
    return uri


def test_on_start_recibe_el_run_id_antes_de_las_epocas(cfg: TrainConfig, mlflow_uri: str) -> None:
    events: list[tuple[str, Any]] = []
    tracked = run_tracked(
        cfg,
        on_start=lambda run_id: events.append(("start", run_id)),
        on_epoch=lambda row: events.append(("epoch", row["epoch"])),
    )
    assert events[0] == ("start", tracked.run_id)
    assert [e for e in events[1:] if e[0] == "start"] == []


def test_on_epoch_recibe_una_fila_por_epoca_con_sus_metricas(cfg: TrainConfig, mlflow_uri: str) -> None:
    rows: list[dict[str, Any]] = []
    tracked = run_tracked(cfg, on_epoch=rows.append)
    assert [r["epoch"] for r in rows] == [r["epoch"] for r in tracked.result.history]
    for row in rows:
        for key in EPOCH_METRICS:
            assert key in row


def test_sin_avisos_se_comporta_igual_que_antes(cfg: TrainConfig, mlflow_uri: str) -> None:
    tracked = run_tracked(cfg)
    assert tracked.run_id
    assert len(tracked.result.history) >= 1
