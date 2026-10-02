"""Registro de entrenamientos en MLflow (T06).

``run_tracked(cfg)`` envuelve ``trainer.train``: crea un run en el experimento
``proyecto3-clasificador``, registra parámetros, semillas, procedencia de datos y
código, métricas por época y el paquete del modelo como artefactos.

Convenciones del run (contrato para T07, T08, T09 y T10):

- params: todos los campos de ``TrainConfig`` (``hidden_layers`` como JSON).
- métricas por época (``step`` = época): ``train_loss``, ``train_acc``, ``val_loss``,
  ``val_acc``, ``epoch_seconds``. El último valor de ``val_loss`` es el de la última
  época, no el mejor: para comparar corridas usa ``best_val_loss`` / ``best_val_acc``.
- métricas finales: ``best_val_loss``, ``best_val_acc``, ``best_epoch``,
  ``stopped_epoch``, ``duration_seconds``.
- tags: ``dvc_release``, ``release_annotations_md5``, ``manifest_sha256``,
  ``manifest_dvc_md5``, ``crops_dvc_md5``, ``split_seed``, ``split_method``,
  ``test_fingerprint`` (de ``leakage_report.json``), ``git_commit``, ``git_dirty``, ``classes``,
  ``stop_reason``, ``weights_sha256``, versiones de librerías y los ``tags`` extra
  (p. ej. ``job_id`` desde el worker). Si ``git_dirty=true``, también ``source_diff_sha256``.
- artefactos en la raíz del run: ``weights.pt``, ``classes.json``, ``preprocess.json``,
  ``history.json``, ``config.json``, ``env.json``, ``summary.json``, ``curves.png``; con
  ``git_dirty=true``, ``source/source_diff.patch`` (cambios sin commit contra ``git_commit``).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import mlflow
import yaml
from mlflow.tracking import MlflowClient
from pydantic import ValidationError

from trainer.config import TrainConfig, load_config
from trainer.data import DataError
from trainer.train import TrainResult, sha256_file, train

log = logging.getLogger(__name__)

DEFAULT_EXPERIMENT = "proyecto3-clasificador"
EPOCH_METRICS = ("train_loss", "train_acc", "val_loss", "val_acc")
NOT_AVAILABLE = "no disponible"
SOURCE_PATCH_ARTIFACT = "source/source_diff.patch"
LEAKAGE_REPORT = "leakage_report.json"  # de ml/make_split.py, junto al manifiesto


class ProvenanceError(RuntimeError):
    """Los datos locales no corresponden a la versión registrada en DVC."""


# --- Procedencia --------------------------------------------------------------


def tracking_uri() -> str:
    """MLFLOW_TRACKING_URI si existe; si no, ./mlruns local."""
    return os.environ.get("MLFLOW_TRACKING_URI") or Path("mlruns").resolve().as_uri()


def md5_file(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dvc_md5(dvc_file: Path) -> str | None:
    """md5 del primer ``outs`` de un archivo .dvc (None si no existe)."""
    if not dvc_file.is_file():
        return None
    outs = (yaml.safe_load(dvc_file.read_text(encoding="utf-8")) or {}).get("outs") or []
    return str(outs[0]["md5"]) if outs else None


def git_info(cwd: Path | None = None) -> tuple[str, str]:
    """(commit, dirty). En contenedores sin .git usa la variable GIT_COMMIT."""
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=cwd, capture_output=True, text=True, check=True
        ).stdout.strip()
        status_cmd = ["git", "status", "--porcelain", "--untracked-files=normal"]
        status = subprocess.run(status_cmd, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()
        return commit, str(bool(status)).lower()
    except (OSError, subprocess.CalledProcessError):
        return os.environ.get("GIT_COMMIT", NOT_AVAILABLE), NOT_AVAILABLE


def source_patch(cwd: Path | None = None) -> bytes:
    """Parche contra HEAD con los cambios sin commit, incluidos archivos nuevos no ignorados.

    Con ``git apply`` sobre ``git_commit`` reconstruye el código exacto de una corrida hecha
    con ``git_dirty=true``. Se maneja en bytes: leerlo como texto convertiría CRLF en LF y
    el parche dejaría de aplicar.
    """

    def git(*args: str) -> bytes:
        # diff --no-index sale con código 1 cuando hay diferencias: no es error.
        out = subprocess.run(["git", "-c", "core.quotepath=false", *args], cwd=cwd, capture_output=True)
        if out.returncode not in (0, 1):
            raise subprocess.CalledProcessError(out.returncode, args, out.stdout, out.stderr)
        return out.stdout

    parts = [git("diff", "HEAD", "--binary")]
    for path in git("ls-files", "-z", "--others", "--exclude-standard").split(b"\0"):
        if path:
            parts.append(git("diff", "--no-index", "--binary", "/dev/null", path.decode("utf-8")))
    return b"".join(parts)


def default_release_info(cfg: TrainConfig) -> Path | None:
    """release_info.json de T03, junto al classes.json congelado."""
    if cfg.classes_path is None:
        return None
    candidate = cfg.classes_path.parent / "release_info.json"
    return candidate if candidate.is_file() else None


def split_provenance(report: Path) -> dict[str, str]:
    """Semilla, método y huella de test del split (T04), desde ``leakage_report.json``."""
    data = json.loads(report.read_text(encoding="utf-8")) if report.is_file() else {}
    return {
        "split_seed": str(data.get("semilla", NOT_AVAILABLE)),
        "split_method": str(data.get("metodo", NOT_AVAILABLE)),
        "test_fingerprint": str(data.get("test_huella_sha256", NOT_AVAILABLE)),
    }


def collect_provenance(cfg: TrainConfig, release_info: Path | None, strict: bool = True) -> dict[str, str]:
    """Tags de datos y código. Con ``strict`` falla si el manifiesto no es el versionado en DVC."""
    manifest_md5 = md5_file(cfg.manifest_path)
    manifest_dvc = dvc_md5(cfg.manifest_path.with_name(cfg.manifest_path.name + ".dvc"))
    if manifest_dvc is not None and manifest_dvc != manifest_md5:
        message = (
            f"{cfg.manifest_path} (md5 {manifest_md5}) no coincide con su .dvc ({manifest_dvc}); "
            "ejecuta `dvc pull` o `dvc checkout` antes de entrenar"
        )
        if strict:
            raise ProvenanceError(message)
        log.warning(message)

    release = {}
    if release_info is not None and release_info.is_file():
        release = json.loads(release_info.read_text(encoding="utf-8"))
    elif strict:
        log.warning("sin release_info.json: el run no queda ligado a un release DVC del Proyecto 2")

    root = cfg.data_root if cfg.data_root is not None else cfg.manifest_path.parent
    split = split_provenance(cfg.manifest_path.parent / LEAKAGE_REPORT)
    commit, dirty = git_info()
    return {
        "dvc_release": str(release.get("release_tag", NOT_AVAILABLE)),
        "release_annotations_md5": str(release.get("annotations_md5", NOT_AVAILABLE)),
        "manifest_path": cfg.manifest_path.as_posix(),
        "manifest_sha256": sha256_file(cfg.manifest_path),
        "manifest_md5": manifest_md5,
        "manifest_dvc_md5": manifest_dvc or NOT_AVAILABLE,
        "crops_dvc_md5": dvc_md5(root / "crops.dvc") or NOT_AVAILABLE,
        **split,
        "git_commit": commit,
        "mlflow.source.git.commit": commit,
        "git_dirty": dirty,
    }


def config_params(cfg: TrainConfig) -> dict[str, str]:
    params = {}
    for key, value in cfg.to_json_dict().items():
        params[key] = json.dumps(value) if isinstance(value, list | dict) else str(value)
    return params


# --- Curvas -------------------------------------------------------------------


def plot_curves(history: list[dict[str, Any]], best_epoch: int, path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import MaxNLocator

    epochs = [row["epoch"] for row in history]
    fig, axes = plt.subplots(1, 2, figsize=(10, 4), constrained_layout=True)
    for ax, metric, title in ((axes[0], "loss", "Loss"), (axes[1], "acc", "Accuracy")):
        ax.plot(epochs, [row[f"train_{metric}"] for row in history], marker="o", label="train")
        ax.plot(epochs, [row[f"val_{metric}"] for row in history], marker="o", label="validación")
        ax.axvline(best_epoch, color="gray", linestyle="--", linewidth=1, label=f"mejor época ({best_epoch})")
        ax.set_title(title)
        ax.set_xlabel("época")
        ax.xaxis.set_major_locator(MaxNLocator(integer=True))
        ax.grid(alpha=0.3)
        ax.legend()
    fig.savefig(path, dpi=120)
    plt.close(fig)


# --- Run ----------------------------------------------------------------------


@dataclass
class TrackedRun:
    run_id: str
    experiment_id: str
    tracking_uri: str
    result: TrainResult


def run_tracked(
    cfg: TrainConfig,
    *,
    experiment: str = DEFAULT_EXPERIMENT,
    run_name: str | None = None,
    tags: dict[str, str] | None = None,
    release_info: Path | None = None,
    strict: bool = True,
    on_start: Callable[[str], None] | None = None,
    on_epoch: Callable[[dict[str, Any]], None] | None = None,
) -> TrackedRun:
    """Entrena con ``cfg`` dentro de un run de MLflow.

    El paquete se escribe en ``cfg.output_dir / <run_id>`` para que cada corrida tenga
    su propia carpeta y quede ligada a su run.

    ``on_start(run_id)`` y ``on_epoch(fila)`` son avisos opcionales para quien lanza el
    entrenamiento (p. ej. el worker del portal, que guarda el run_id y el progreso en
    ``training_jobs``). Sin ellos, el comportamiento es el mismo de siempre.
    """
    uri = tracking_uri()
    mlflow.set_tracking_uri(uri)
    provenance = collect_provenance(cfg, release_info or default_release_info(cfg), strict=strict)
    experiment_id = mlflow.set_experiment(experiment).experiment_id

    with mlflow.start_run(run_name=run_name) as run:
        run_id = run.info.run_id
        cfg = cfg.model_copy(update={"output_dir": cfg.output_dir / run_id})
        mlflow.set_tags({**provenance, **(tags or {})})
        mlflow.log_params(config_params(cfg))
        if provenance["git_dirty"] == "true":
            patch = source_patch()
            with tempfile.TemporaryDirectory() as tmp:
                patch_path = Path(tmp) / Path(SOURCE_PATCH_ARTIFACT).name
                patch_path.write_bytes(patch)
                mlflow.log_artifact(str(patch_path), str(Path(SOURCE_PATCH_ARTIFACT).parent.as_posix()))
            mlflow.set_tag("source_diff_sha256", hashlib.sha256(patch).hexdigest())
        if on_start is not None:
            on_start(run_id)

        def log_epoch(row: dict[str, Any]) -> None:
            metrics = {key: row[key] for key in EPOCH_METRICS}
            metrics["epoch_seconds"] = row["seconds"]
            mlflow.log_metrics(metrics, step=row["epoch"])
            if on_epoch is not None:
                on_epoch(row)

        try:
            result = train(cfg, on_epoch_end=log_epoch)
        except Exception as exc:
            mlflow.set_tag("error", f"{type(exc).__name__}: {exc}"[:5000])
            raise

        out = result.output_dir
        plot_curves(result.history, result.best_epoch, out / "curves.png")
        summary = result.summary
        env = json.loads((out / "env.json").read_text(encoding="utf-8"))
        mlflow.set_tags(
            {
                "classes": json.dumps(summary["data"]["classes"]),
                "num_classes": str(len(summary["data"]["classes"])),
                "stop_reason": result.stop_reason,
                "restored_matches_best_epoch": str(summary["restored_check"]["matches_best_epoch"]).lower(),
                "weights_sha256": sha256_file(out / "weights.pt"),
                "pretrained_weights": summary["model"]["pretrained_weights"]["source"],
                "device": summary["device"],
                "python_version": env["python"],
                **{f"{name}_version": str(version) for name, version in env["packages"].items()},
            }
        )
        mlflow.log_metrics(
            {
                "best_val_loss": summary["best_metrics"]["val_loss"],
                "best_val_acc": summary["best_metrics"]["val_acc"],
                "best_epoch": result.best_epoch,
                "stopped_epoch": result.stopped_epoch,
                "duration_seconds": summary["duration_seconds"],
                "train_samples": sum(summary["data"]["counts"]["train"].values()),
                "val_samples": sum(summary["data"]["counts"]["val"].values()),
            }
        )
        mlflow.log_artifacts(str(out))
        log.info("run %s registrado en %s (experimento %s)", run_id, uri, experiment)

    return TrackedRun(run_id=run_id, experiment_id=experiment_id, tracking_uri=uri, result=result)


# --- Reproducibilidad ---------------------------------------------------------


IGNORED_PARAMS = {"output_dir"}


def compare_runs(run_a: str, run_b: str, client: MlflowClient | None = None) -> dict[str, Any]:
    """Compara dos runs: parámetros, datos, métricas por época y hash de pesos."""
    client = client or MlflowClient(tracking_uri())
    a, b = client.get_run(run_a), client.get_run(run_b)

    params = sorted(
        k
        for k in set(a.data.params) | set(b.data.params)
        if k not in IGNORED_PARAMS and a.data.params.get(k) != b.data.params.get(k)
    )
    data_tags = ("manifest_sha256", "dvc_release", "git_commit")
    tags = sorted(k for k in data_tags if a.data.tags.get(k) != b.data.tags.get(k))

    metrics: dict[str, float | None] = {}
    for key in EPOCH_METRICS:
        ha = [m.value for m in sorted(client.get_metric_history(run_a, key), key=lambda m: m.step)]
        hb = [m.value for m in sorted(client.get_metric_history(run_b, key), key=lambda m: m.step)]
        if len(ha) != len(hb):
            metrics[key] = None
        else:
            metrics[key] = max((abs(x - y) for x, y in zip(ha, hb, strict=True)), default=0.0)

    same_weights = a.data.tags.get("weights_sha256") == b.data.tags.get("weights_sha256")
    return {
        "run_a": run_a,
        "run_b": run_b,
        "different_params": params,
        "different_data_or_code": tags,
        "max_abs_diff_per_metric": metrics,
        "same_epochs": all(v is not None for v in metrics.values()),
        "same_weights_sha256": same_weights,
        "reproducible": not params and not tags and same_weights and all(v == 0.0 for v in metrics.values()),
    }


# --- CLI ----------------------------------------------------------------------


def _parse_tags(values: list[str]) -> dict[str, str]:
    tags = {}
    for item in values:
        key, sep, value = item.partition("=")
        if not sep or not key:
            raise argparse.ArgumentTypeError(f"tag inválido '{item}', usa clave=valor")
        tags[key] = value
    return tags


def main(argv: list[str] | None = None) -> int:
    from trainer.cli import SMOKE_EPOCHS, SMOKE_SAMPLES_PER_CLASS, smoke_config

    parser = argparse.ArgumentParser(prog="python -m trainer.tracking", description="Entrena y registra en MLflow.")
    sub = parser.add_subparsers(dest="command", required=True)

    run_p = sub.add_parser("run", help="entrena con una config y registra el run")
    run_p.add_argument("--config", type=Path, help="config YAML/JSON")
    run_p.add_argument("--smoke", action="store_true", help=f"{SMOKE_EPOCHS} épocas; sin --config usa datos sintéticos")
    run_p.add_argument("--output-dir", type=Path, help="carpeta base de paquetes (se agrega el run_id)")
    run_p.add_argument("--experiment", default=DEFAULT_EXPERIMENT)
    run_p.add_argument("--run-name")
    run_p.add_argument("--tag", action="append", default=[], metavar="CLAVE=VALOR")
    run_p.add_argument("--release-info", type=Path, help="release_info.json de T03 (por defecto junto a classes.json)")
    run_p.add_argument("--allow-data-mismatch", action="store_true", help="no falla si manifest.csv difiere de su .dvc")

    cmp_p = sub.add_parser("compare", help="compara dos runs para verificar reproducibilidad")
    cmp_p.add_argument("run_a")
    cmp_p.add_argument("run_b")

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.command == "compare":
        report = compare_runs(args.run_a, args.run_b)
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0 if report["reproducible"] else 1

    try:
        if args.config is None:
            if not args.smoke:
                print("error: indica --config o usa --smoke", file=sys.stderr)
                return 2
            cfg = smoke_config(args.output_dir or Path("runs/smoke"))
        else:
            overrides: dict[str, Any] = {}
            if args.output_dir:
                overrides["output_dir"] = str(args.output_dir)
            if args.smoke:
                overrides |= {"max_epochs": SMOKE_EPOCHS, "max_samples_per_class": SMOKE_SAMPLES_PER_CLASS}
            cfg = load_config(args.config, overrides)
        tags = _parse_tags(args.tag)
        if args.smoke:
            tags.setdefault("smoke", "true")
        tracked = run_tracked(
            cfg,
            experiment=args.experiment,
            run_name=args.run_name,
            tags=tags,
            release_info=args.release_info,
            strict=not args.allow_data_mismatch,
        )
    except ValidationError as exc:
        print(f"config inválida:\n{exc}", file=sys.stderr)
        return 2
    except (DataError, ProvenanceError, FileExistsError, FileNotFoundError, argparse.ArgumentTypeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    r = tracked.result
    print(
        f"run {tracked.run_id} ({tracked.tracking_uri}): mejor época {r.best_epoch}, "
        f"paró en {r.stopped_epoch} por {r.stop_reason}, {r.summary['duration_seconds']:.1f} s; "
        f"paquete en {r.output_dir}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
