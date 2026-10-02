"""Worker de entrenamiento: toma jobs del portal y entrena con trainer (T05)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
import yaml

import worker

JOB_ID = "11111111-2222-3333-4444-555555555555"
RELEASE = "proyecto2 v1.1.0@dc9376e"


# ---------------------------------------------------------------------------
# Dobles de prueba
# ---------------------------------------------------------------------------


@dataclass
class FakeStore:
    """Guarda en memoria lo que el worker escribiría en training_jobs."""

    statuses: list[dict[str, Any]] = field(default_factory=list)
    logs: list[tuple[str, str]] = field(default_factory=list)
    fail_logs: bool = False

    def set_status(self, job_id: str, status: str, *, run_id: str | None = None, error: str | None = None) -> None:
        assert job_id == JOB_ID
        self.statuses.append({"status": status, "run_id": run_id, "error": error})

    def log(self, job_id: str, level: str, message: str) -> None:
        if self.fail_logs:
            raise ConnectionError("MariaDB no responde")
        self.logs.append((level, message))

    def last(self) -> dict[str, Any]:
        return self.statuses[-1]


class FakeRunner:
    """Imita run_tracked: avisa el inicio, dos épocas y devuelve un resultado."""

    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def __call__(self, cfg, *, run_name, tags, on_start, on_epoch):
        self.calls.append({"cfg": cfg, "run_name": run_name, "tags": tags})
        on_start("run-abc")
        for epoch, loss in ((1, 0.5), (2, 0.3)):
            on_epoch({"epoch": epoch, "train_loss": loss + 0.1, "train_acc": 0.8, "val_loss": loss, "val_acc": 0.9})
        if self.error:
            raise self.error
        summary = {"best_metrics": {"val_loss": 0.3, "val_acc": 0.9}}
        return SimpleNamespace(run_id="run-abc", result=SimpleNamespace(summary=summary, best_epoch=2))


@pytest.fixture
def base_config(tmp_path: Path) -> Path:
    """Config base como configs/baseline.yaml, con un release_info.json junto al classes.json."""
    crops = tmp_path / "data" / "crops"
    crops.mkdir(parents=True)
    (crops / "classes.json").write_text(json.dumps({"0": "person", "1": "car"}))
    (crops / "release_info.json").write_text(json.dumps({"release_tag": RELEASE}))
    path = tmp_path / "baseline.yaml"
    path.write_text(
        yaml.safe_dump(
            {
                "manifest_path": str(tmp_path / "data" / "splits" / "manifest.csv"),
                "classes_path": str(crops / "classes.json"),
                "data_root": str(crops),
                "output_dir": "runs/baseline",
                "max_epochs": 30,
                "img_size": 224,
            }
        )
    )
    return path


def portal_params(**changes: Any) -> dict[str, Any]:
    """Exactamente lo que encola el portal (toTrainerParams de T09), sin las rutas."""
    params = {
        "release": RELEASE,
        "optimizer": "sgd",
        "batch_size": 16,
        "max_epochs": 3,
        "lr": 0.01,
        "img_size": 160,
        "hidden_layers": [128],
        "dropout": 0.2,
        "shuffle_seed": 1,
        "aug_seed": 2,
        "init_seed": 3,
    }
    params.update(changes)
    return params


def run(base_config: Path, tmp_path: Path, params: dict[str, Any], runner=None, store=None):
    store = store or FakeStore()
    runner = runner or FakeRunner()
    ok = worker.run_job(
        JOB_ID, params, store, runner=runner, base_config=base_config, output_root=tmp_path / "runs" / "jobs"
    )
    return ok, store, runner


# ---------------------------------------------------------------------------
# Flujo feliz
# ---------------------------------------------------------------------------


def test_job_exitoso_pasa_por_running_y_termina_succeeded_con_run_id(base_config, tmp_path):
    ok, store, _ = run(base_config, tmp_path, portal_params())
    assert ok is True
    assert [s["status"] for s in store.statuses] == ["running", "running", "succeeded"]
    assert store.statuses[1]["run_id"] == "run-abc"  # se guarda en cuanto arranca el run
    assert store.last() == {"status": "succeeded", "run_id": "run-abc", "error": None}


def test_los_parametros_del_formulario_llegan_al_entrenador(base_config, tmp_path):
    _, _, runner = run(base_config, tmp_path, portal_params())
    cfg = runner.calls[0]["cfg"]
    assert (cfg.optimizer, cfg.batch_size, cfg.max_epochs, cfg.lr, cfg.img_size) == ("sgd", 16, 3, 0.01, 160)
    assert (cfg.hidden_layers, cfg.dropout) == ([128], 0.2)
    assert (cfg.shuffle_seed, cfg.aug_seed, cfg.init_seed) == (1, 2, 3)
    assert cfg.output_dir == tmp_path / "runs" / "jobs" / JOB_ID  # no pisa runs/baseline


def test_el_run_queda_ligado_al_job(base_config, tmp_path):
    _, _, runner = run(base_config, tmp_path, portal_params())
    call = runner.calls[0]
    assert call["tags"]["job_id"] == JOB_ID
    assert call["tags"]["source"] == "portal"
    assert JOB_ID[:8] in call["run_name"]


def test_escribe_un_log_por_epoca_para_el_panel_de_progreso(base_config, tmp_path):
    _, store, _ = run(base_config, tmp_path, portal_params())
    epochs = [m for level, m in store.logs if m.startswith("época")]
    assert len(epochs) == 2
    assert "val_loss=0.3000" in epochs[1]
    assert any("run-abc" in m for _, m in store.logs)
    assert "best_val_loss=0.3000" in store.logs[-1][1]


def test_acepta_las_rutas_que_manda_el_portal(base_config, tmp_path):
    params = portal_params(
        manifest_path=str(tmp_path / "otro" / "manifest.csv"),
        classes_path=str(tmp_path / "data" / "crops" / "classes.json"),
        data_root=str(tmp_path / "data" / "crops"),
    )
    ok, _, runner = run(base_config, tmp_path, params)
    assert ok is True
    assert runner.calls[0]["cfg"].manifest_path == tmp_path / "otro" / "manifest.csv"


def test_ignora_campos_que_el_entrenador_no_conoce(base_config, tmp_path):
    ok, _, _ = run(base_config, tmp_path, portal_params(campo_nuevo_del_portal="x"))
    assert ok is True


# ---------------------------------------------------------------------------
# Fallos: el job termina en failed con un mensaje, y el worker no se cae
# ---------------------------------------------------------------------------


def test_parametros_invalidos_fallan_sin_entrenar(base_config, tmp_path):
    runner = FakeRunner()
    ok, store, _ = run(base_config, tmp_path, portal_params(lr=5), runner=runner)
    assert ok is False
    assert runner.calls == []
    assert store.last()["status"] == "failed"
    assert "lr" in store.last()["error"]


def test_release_distinto_al_aprobado_falla_sin_entrenar(base_config, tmp_path):
    runner = FakeRunner()
    ok, store, _ = run(base_config, tmp_path, portal_params(release="otro v9@abc"), runner=runner)
    assert ok is False
    assert runner.calls == []
    assert "otro v9@abc" in store.last()["error"]
    assert RELEASE in store.last()["error"]


def test_error_al_entrenar_deja_failed_con_el_run_id(base_config, tmp_path):
    ok, store, _ = run(base_config, tmp_path, portal_params(), runner=FakeRunner(RuntimeError("se acabó la memoria")))
    assert ok is False
    assert store.last()["status"] == "failed"
    assert "se acabó la memoria" in store.last()["error"]
    assert store.statuses[1]["run_id"] == "run-abc"
    assert store.logs[-1][0] == "error"


def test_error_muy_largo_se_recorta_al_tamano_de_la_columna(base_config, tmp_path):
    _, store, _ = run(base_config, tmp_path, portal_params(), runner=FakeRunner(RuntimeError("x" * 5000)))
    assert len(store.last()["error"]) <= worker.MAX_ERROR_LENGTH


def test_si_falla_escribir_un_log_el_entrenamiento_sigue(base_config, tmp_path):
    ok, store, _ = run(base_config, tmp_path, portal_params(), store=FakeStore(fail_logs=True))
    assert ok is True
    assert store.last()["status"] == "succeeded"


@pytest.mark.parametrize("message", ["{no es json", "[]", json.dumps({"params": {}}), ""])
def test_mensaje_invalido_de_la_cola_no_tumba_el_worker(message):
    store = FakeStore()
    assert worker.process_message(message, store, runner=FakeRunner()) is False
    assert store.statuses == []


def test_process_message_lee_la_forma_que_encola_el_portal(base_config, tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "BASE_CONFIG", base_config)
    monkeypatch.setattr(worker, "OUTPUT_ROOT", tmp_path / "runs" / "jobs")
    store = FakeStore()
    message = json.dumps({"id": JOB_ID, "params": portal_params()})
    assert worker.process_message(message, store, runner=FakeRunner()) is True
    assert store.last()["status"] == "succeeded"


# ---------------------------------------------------------------------------
# SQL contra training_jobs (sin base de datos real)
# ---------------------------------------------------------------------------


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, args=()):
        self.conn.executed.append((" ".join(sql.split()), args))
        self.conn.rowcount = 1

    def fetchone(self):
        return (self.conn.stored_logs,)

    @property
    def rowcount(self):
        return self.conn.rowcount


class FakeConnection:
    def __init__(self, stored_logs='[{"ts": "t0", "level": "info", "message": "creado"}]'):
        self.stored_logs = stored_logs
        self.executed: list[tuple[str, tuple]] = []
        self.commits = 0
        self.closed = False
        self.rowcount = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True


def test_set_status_actualiza_la_fila_del_job():
    conn = FakeConnection()
    store = worker.MySQLJobStore(lambda: conn)
    store.set_status(JOB_ID, "succeeded", run_id="run-abc")
    sql, args = conn.executed[0]
    assert sql.startswith("UPDATE training_jobs SET status = %s")
    assert "COALESCE(%s, run_id)" in sql  # no borra un run_id ya guardado
    assert args == ("succeeded", "run-abc", None, JOB_ID)
    assert conn.commits == 1 and conn.closed


def test_log_agrega_al_arreglo_sin_borrar_lo_anterior():
    conn = FakeConnection()
    worker.MySQLJobStore(lambda: conn).log(JOB_ID, "info", "época 1")
    select_sql, _ = conn.executed[0]
    update_sql, (new_logs, job_id) = conn.executed[1]
    assert "FOR UPDATE" in select_sql
    assert update_sql == "UPDATE training_jobs SET logs = %s WHERE id = %s"
    assert job_id == JOB_ID
    logs = json.loads(new_logs)
    assert [entry["message"] for entry in logs] == ["creado", "época 1"]
    assert set(logs[1]) == {"ts", "level", "message"}  # forma JobLogEntry del contrato
    assert conn.commits == 1


def test_log_tolera_logs_vacios_o_nulos():
    for stored in (None, "", "[]"):
        conn = FakeConnection(stored_logs=stored)
        worker.MySQLJobStore(lambda conn=conn: conn).log(JOB_ID, "warn", "hola")
        assert len(json.loads(conn.executed[1][1][0])) == 1


# ---------------------------------------------------------------------------
# Integración con el entrenador real (dataset sintético + MLflow local)
# ---------------------------------------------------------------------------


def test_job_real_crea_un_run_en_el_experimento_del_portal(tmp_path, monkeypatch):
    from mlflow.tracking import MlflowClient

    from trainer.synthetic import make_synthetic_dataset
    from trainer.tracking import DEFAULT_EXPERIMENT

    uri = (tmp_path / "mlruns").resolve().as_uri()
    monkeypatch.setenv("MLFLOW_TRACKING_URI", uri)
    manifest, classes = make_synthetic_dataset(tmp_path / "ds", per_split={"train": 6, "val": 3, "test": 3}, size=48)
    (classes.parent / "release_info.json").write_text(json.dumps({"release_tag": RELEASE}))
    base = tmp_path / "base.yaml"
    base.write_text(
        yaml.safe_dump(
            {
                "manifest_path": str(manifest),
                "classes_path": str(classes),
                "output_dir": "runs/baseline",
                "pretrained": False,
                "trainable_backbone": "all",
            }
        )
    )

    store = FakeStore()
    params = portal_params(optimizer="adam", batch_size=4, max_epochs=2, lr=0.001, img_size=32, hidden_layers=[16])
    ok = worker.run_job(JOB_ID, params, store, base_config=base, output_root=tmp_path / "jobs")

    assert ok is True, store.statuses
    run_id = store.last()["run_id"]
    run = MlflowClient(uri).get_run(run_id)
    experiment = MlflowClient(uri).get_experiment(run.info.experiment_id)
    assert experiment.name == DEFAULT_EXPERIMENT  # el que lee /experiments
    assert run.data.tags["job_id"] == JOB_ID
    assert len(MlflowClient(uri).get_metric_history(run_id, "val_loss")) == 2  # curvas por época
    assert len([m for _, m in store.logs if m.startswith("época")]) == 2


# ---------------------------------------------------------------------------
# Commit del código de la imagen (P2-2): runs con git_commit de HEAD, no de una imagen vieja
# ---------------------------------------------------------------------------

HEAD = "3a85a81" + "0" * 33
OLD = "ba2ee94" + "0" * 33


def test_startup_fails_when_the_image_was_built_from_another_commit() -> None:
    with pytest.raises(SystemExit, match="docker compose up -d --build"):
        worker.check_code_commit(baked=OLD, expected=HEAD)


def test_startup_accepts_an_image_built_from_head() -> None:
    assert worker.check_code_commit(baked=HEAD, expected=HEAD) == HEAD


@pytest.mark.parametrize(("baked", "expected"), [(HEAD, ""), ("no disponible", HEAD), ("no disponible", "")])
def test_startup_warns_when_the_commit_cannot_be_compared(
    baked: str, expected: str, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level("WARNING", logger="worker"):
        assert worker.check_code_commit(baked=baked, expected=expected) == baked
    assert "GIT_COMMIT" in caplog.text
