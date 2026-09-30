"""Worker de entrenamiento del portal.

Escucha la cola de Redis (``ml_jobs``) que llena ``POST /api/training/jobs`` (T09),
entrena con el entrenador real (``trainer.run_tracked``, T05/T06) y va reportando el
estado, el run de MLflow y los logs en la tabla ``training_jobs`` de MariaDB, que es
lo que lee ``GET /api/training/jobs/[id]`` y la página /training (T11).

Mensaje de la cola (``portal/src/lib/queue.ts``)::

    {"id": "<uuid>", "params": {"release": "...", "optimizer": "adamw", ..., "init_seed": 44}}

Ciclo de un job: queued (lo crea el portal) → running → running + run_id → succeeded | failed.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

log = logging.getLogger("worker")

QUEUE = os.getenv("ML_JOBS_QUEUE", "ml_jobs")
BASE_CONFIG = Path(os.getenv("WORKER_BASE_CONFIG", "configs/baseline.yaml"))
OUTPUT_ROOT = Path(os.getenv("WORKER_OUTPUT_DIR", "runs/jobs"))
MAX_ERROR_LENGTH = 2048  # varchar("error", { length: 2048 }) en portal/src/lib/db/schema.ts

# Campos de trainer.config.TrainConfig que el portal puede fijar por job.
TRAINER_FIELDS = (
    "optimizer",
    "batch_size",
    "max_epochs",
    "lr",
    "img_size",
    "hidden_layers",
    "dropout",
    "shuffle_seed",
    "aug_seed",
    "init_seed",
    "manifest_path",
    "classes_path",
    "data_root",
)


class JobError(Exception):
    """El job no se puede entrenar tal como viene (p. ej. release no aprobado)."""


class JobStore(Protocol):
    def set_status(self, job_id: str, status: str, *, run_id: str | None = None, error: str | None = None) -> None: ...

    def log(self, job_id: str, level: str, message: str) -> None: ...


# ---------------------------------------------------------------------------
# training_jobs en MariaDB
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class MySQLJobStore:
    """Escribe en ``training_jobs``. Abre una conexión por operación: un
    entrenamiento puede durar más que el timeout de una conexión abierta."""

    def __init__(self, connect: Callable[[], Any]) -> None:
        self._connect = connect

    @classmethod
    def from_env(cls) -> MySQLJobStore:
        import pymysql

        def connect() -> Any:
            return pymysql.connect(
                host=os.getenv("MYSQL_HOST", "db"),
                port=int(os.getenv("MYSQL_PORT", "3306")),
                user=os.environ["MYSQL_USER"],
                password=os.environ["MYSQL_PASSWORD"],
                database=os.environ["MYSQL_DATABASE"],
                charset="utf8mb4",
                autocommit=False,
            )

        return cls(connect)

    def set_status(self, job_id: str, status: str, *, run_id: str | None = None, error: str | None = None) -> None:
        conn = self._connect()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE training_jobs SET status = %s, run_id = COALESCE(%s, run_id), error = %s WHERE id = %s",
                    (status, run_id, error, job_id),
                )
                if cur.rowcount == 0:
                    log.warning("job %s no existe en training_jobs", job_id)
            conn.commit()
        finally:
            conn.close()

    def log(self, job_id: str, level: str, message: str) -> None:
        conn = self._connect()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT logs FROM training_jobs WHERE id = %s FOR UPDATE", (job_id,))
                row = cur.fetchone()
                stored = row[0] if row else None
                logs = json.loads(stored) if stored else []
                logs.append({"ts": _now(), "level": level, "message": message})
                cur.execute(
                    "UPDATE training_jobs SET logs = %s WHERE id = %s",
                    (json.dumps(logs, ensure_ascii=False), job_id),
                )
            conn.commit()
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Configuración del job
# ---------------------------------------------------------------------------


def build_config(job_id: str, params: dict[str, Any], base_config: Path, output_root: Path):
    """Config base (baseline.yaml) + parámetros del formulario, validada por TrainConfig."""
    from trainer.config import load_config

    overrides = {key: params[key] for key in TRAINER_FIELDS if key in params}
    overrides["output_dir"] = str(output_root / job_id)  # cada job en su carpeta
    return load_config(base_config, overrides)


def check_release(cfg, requested: str | None) -> str:
    """El release pedido debe ser el aprobado con el que T03 generó los recortes."""
    info_path = Path(cfg.classes_path).parent / "release_info.json" if cfg.classes_path else None
    if info_path is None or not info_path.is_file():
        raise JobError("no hay release_info.json junto a classes.json; ejecuta `dvc pull` antes de entrenar")
    approved = json.loads(info_path.read_text(encoding="utf-8")).get("release_tag")
    if requested != approved:
        raise JobError(f"el release pedido ({requested}) no es el aprobado ({approved})")
    return approved


def _default_runner(cfg, **kwargs):
    from trainer.tracking import run_tracked

    return run_tracked(cfg, **kwargs)


# ---------------------------------------------------------------------------
# Un job
# ---------------------------------------------------------------------------


def _safe_log(store: JobStore, job_id: str, level: str, message: str) -> None:
    """Un log que no se pudo guardar no debe detener el entrenamiento."""
    try:
        store.log(job_id, level, message)
    except Exception as exc:  # noqa: BLE001
        log.warning("no se pudo guardar el log del job %s: %s", job_id, exc)


def _epoch_message(row: dict[str, Any]) -> str:
    return (
        f"época {row['epoch']}: train_loss={row['train_loss']:.4f} train_acc={row['train_acc']:.4f} "
        f"val_loss={row['val_loss']:.4f} val_acc={row['val_acc']:.4f}"
    )


def run_job(
    job_id: str,
    params: dict[str, Any],
    store: JobStore,
    *,
    runner: Callable[..., Any] | None = None,
    base_config: Path | None = None,
    output_root: Path | None = None,
) -> bool:
    """Entrena un job y deja su estado final en ``training_jobs``. Devuelve True si terminó bien."""
    runner = runner or _default_runner
    store.set_status(job_id, "running")
    _safe_log(store, job_id, "info", f"job tomado por el worker (release {params.get('release')})")

    try:
        cfg = build_config(job_id, params, base_config or BASE_CONFIG, output_root or OUTPUT_ROOT)
        check_release(cfg, params.get("release"))
        _safe_log(
            store,
            job_id,
            "info",
            f"config: optimizer={cfg.optimizer} batch_size={cfg.batch_size} max_epochs={cfg.max_epochs} "
            f"lr={cfg.lr} img_size={cfg.img_size} hidden_layers={cfg.hidden_layers} dropout={cfg.dropout} "
            f"semillas={cfg.shuffle_seed}/{cfg.aug_seed}/{cfg.init_seed}",
        )

        def on_start(run_id: str) -> None:
            store.set_status(job_id, "running", run_id=run_id)
            _safe_log(store, job_id, "info", f"run de MLflow {run_id}")

        def on_epoch(row: dict[str, Any]) -> None:
            _safe_log(store, job_id, "info", _epoch_message(row))

        tracked = runner(
            cfg,
            run_name=f"job-{job_id[:8]}",
            tags={"job_id": job_id, "source": "portal"},
            on_start=on_start,
            on_epoch=on_epoch,
        )
    except Exception as exc:  # noqa: BLE001 — cualquier fallo del job se reporta, el worker sigue vivo
        message = f"{type(exc).__name__}: {exc}"[:MAX_ERROR_LENGTH]
        log.exception("job %s falló", job_id)
        _safe_log(store, job_id, "error", message)
        store.set_status(job_id, "failed", error=message)
        return False

    best = tracked.result.summary.get("best_metrics", {})
    store.set_status(job_id, "succeeded", run_id=tracked.run_id)
    _safe_log(
        store,
        job_id,
        "info",
        f"terminado: best_val_loss={best.get('val_loss', float('nan')):.4f} "
        f"best_val_acc={best.get('val_acc', float('nan')):.4f}",
    )
    return True


def process_message(message: str, store: JobStore, *, runner: Callable[..., Any] | None = None) -> bool:
    """Procesa un mensaje crudo de la cola. Un mensaje inválido se descarta sin tumbar el worker."""
    try:
        data = json.loads(message)
        job_id = str(data["id"])
        params = dict(data.get("params") or {})
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        log.error("mensaje inválido en la cola, se descarta: %r (%s)", message[:200], exc)
        return False
    try:
        return run_job(job_id, params, store, runner=runner, base_config=BASE_CONFIG, output_root=OUTPUT_ROOT)
    except Exception:  # noqa: BLE001 — p. ej. MariaDB caída al marcar el estado
        log.exception("no se pudo procesar el job %s", job_id)
        return False


def main() -> None:
    import redis

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    queue = redis.Redis(
        host=os.getenv("REDIS_HOST", "localhost"), port=int(os.getenv("REDIS_PORT", "6379")), decode_responses=True
    )
    store = MySQLJobStore.from_env()
    log.info("worker listo, escuchando la cola '%s' en Redis", QUEUE)
    while True:
        _, message = queue.blpop(QUEUE)
        process_message(message, store)


if __name__ == "__main__":
    main()
