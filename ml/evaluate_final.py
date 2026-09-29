"""T08 — Evaluación final, una sola vez, sobre el 10 % de test.

Carga el modelo del run ganador de T07, predice cada recorte de test con el
mismo preprocesamiento de validación y registra los resultados en ese run de
MLflow con el prefijo ``test_``.

Antes de inferir verifica, y se detiene si algo no cuadra:
- que el run sea el congelado en ``reports/t07/selection.json``;
- que el run todavía no tenga métricas ``test_*`` (el test se evalúa una sola vez);
- el SHA-256 del manifiesto contra el registrado en el run y en la selección;
- la huella de los IDs de test contra la de T04 (``leakage_report.json``);
- el SHA-256 de ``weights.pt`` contra el de la selección.

Salidas en --out-dir (por defecto reports/t08):
    predictions.csv            una fila por recorte: y_true, y_pred y probabilidad por clase
    metrics.json               run_id, hashes verificados y métricas recalculadas de predictions.csv
    classification_report.json precisión, recall, F1 y soporte por clase
    confusion_matrix.json/png  filas = clase real, columnas = clase predicha

Uso (desde la raíz del repo, con MLFLOW_TRACKING_URI apuntando al servidor):
    python ml/evaluate_final.py --run-id fe32e1388dbd465cae714a69bf80f685

Códigos de salida: 0 = OK, 2 = error de entrada, 4 = falló una verificación de
integridad, 5 = el test ya se había evaluado en este run.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

# `python ml/evaluate_final.py` agrega ml/ a sys.path, no la raíz del repo, y
# `trainer` no está instalado como paquete. Se agrega la raíz para que
# `from trainer import load_model` funcione sin PYTHONPATH.
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

TARGET_ACCURACY = 0.85
PACKAGE_FILES = ("weights.pt", "classes.json", "preprocess.json")
METRIC_PREFIX = "test_"


class InputError(Exception):
    """Entrada inválida: exit code 2."""


class IntegrityError(Exception):
    """Algo no coincide con lo congelado en T04/T07: exit code 4."""


class AlreadyEvaluatedError(Exception):
    """El run ya tiene métricas de test: exit code 5."""


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fingerprint_test_ids(ann_ids: list[int]) -> str:
    """Misma huella que T04 (make_split.fingerprint_test_split)."""
    return hashlib.sha256("\n".join(map(str, sorted(ann_ids))).encode()).hexdigest()


def tracking_uri() -> str:
    """Igual que trainer.tracking: MLFLOW_TRACKING_URI o ./mlruns."""
    return os.environ.get("MLFLOW_TRACKING_URI") or Path("mlruns").resolve().as_uri()


def git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def read_json(path: Path) -> Any:
    if not path.is_file():
        raise InputError(f"No existe: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def read_classes(path: Path) -> list[str]:
    data = read_json(path)
    if isinstance(data, list):
        return [str(c) for c in data]
    return [str(data[str(i)]) for i in range(len(data))]


# ---------------------------------------------------------------------------
# Datos de test
# ---------------------------------------------------------------------------


def read_test_rows(manifest: Path, classes: list[str]) -> list[dict]:
    if not manifest.is_file():
        raise InputError(f"No existe el manifiesto: {manifest}")
    with manifest.open(encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r["split"] == "test"]
    if not rows:
        raise InputError("El manifiesto no tiene filas con split=test")
    unknown = sorted({r["category_name"] for r in rows} - set(classes))
    if unknown:
        raise IntegrityError(f"El test tiene clases que el modelo no conoce: {unknown}")
    return sorted(rows, key=lambda r: int(r["ann_id"]))


# ---------------------------------------------------------------------------
# Verificaciones de integridad
# ---------------------------------------------------------------------------


def check_run_matches_selection(run_id: str, selection: dict) -> None:
    if selection.get("test_split_used") is not False:
        raise IntegrityError("selection.json no confirma que el test no se usó para elegir el modelo")
    if run_id != selection.get("run_id"):
        raise IntegrityError(f"El run {run_id} no es el congelado en selection.json ({selection.get('run_id')})")


def check_not_evaluated(metric_keys: list[str], out_dir: Path) -> None:
    done = sorted(k for k in metric_keys if k.startswith(METRIC_PREFIX))
    if done:
        raise AlreadyEvaluatedError(f"El run ya tiene métricas de test ({done[:3]}...); el test se evalúa una sola vez")
    if (out_dir / "predictions.csv").exists():
        raise AlreadyEvaluatedError(f"Ya existe {out_dir / 'predictions.csv'}; el test se evalúa una sola vez")


def check_manifest(manifest: Path, run_tags: dict, selection: dict) -> str:
    actual = sha256_file(manifest)
    expected = {
        "run de MLflow": run_tags.get("manifest_sha256"),
        "selection.json": selection.get("data", {}).get("manifest_sha256"),
    }
    for source, value in expected.items():
        if value != actual:
            raise IntegrityError(f"El manifiesto cambió: sha256 {actual} != {value} ({source})")
    return actual


def check_test_fingerprint(rows: list[dict], leakage_report: Path) -> str:
    actual = fingerprint_test_ids([int(r["ann_id"]) for r in rows])
    expected = read_json(leakage_report).get("test_huella_sha256")
    if actual != expected:
        raise IntegrityError(f"Los IDs de test no coinciden con la huella de T04: {actual} != {expected}")
    return actual


def check_weights(package_dir: Path, selection: dict) -> str:
    missing = [f for f in PACKAGE_FILES if not (package_dir / f).is_file()]
    if missing:
        raise InputError(f"Faltan archivos del modelo en {package_dir}: {missing}")
    actual = sha256_file(package_dir / "weights.pt")
    expected = selection.get("checkpoint", {}).get("sha256")
    if actual != expected:
        raise IntegrityError(f"weights.pt no es el congelado: sha256 {actual} != {expected}")
    return actual


# ---------------------------------------------------------------------------
# Inferencia (única parte que usa PyTorch)
# ---------------------------------------------------------------------------


def load_package(package_dir: Path, device: str):
    """weights.pt + classes.json + preprocess.json con el transform de validación."""
    from trainer import load_model

    return load_model(package_dir, device=device)


def predict_proba(loaded, image_paths: list[Path], batch_size: int = 64) -> np.ndarray:
    """Probabilidades softmax por clase, en el orden de loaded.classes."""
    import torch

    device = next(loaded.model.parameters()).device
    loaded.model.eval()
    chunks = []
    with torch.no_grad():
        for start in range(0, len(image_paths), batch_size):
            batch = []
            for path in image_paths[start : start + batch_size]:
                with Image.open(path) as img:
                    batch.append(loaded.transform(img.convert("RGB")))
            logits = loaded.model(torch.stack(batch).to(device))
            chunks.append(torch.softmax(logits, dim=1).cpu().numpy())
    return np.concatenate(chunks)


# ---------------------------------------------------------------------------
# Predicciones y métricas (recalculables solo desde predictions.csv)
# ---------------------------------------------------------------------------


def write_predictions(path: Path, rows: list[dict], probs: np.ndarray, classes: list[str]) -> None:
    fields = ["crop_path", "ann_id", "image_id", "y_true", "y_pred", "correct", *[f"prob_{c}" for c in classes]]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        for row, p in zip(rows, probs, strict=True):
            y_pred = classes[int(np.argmax(p))]
            writer.writerow(
                {
                    "crop_path": row["crop_path"],
                    "ann_id": row["ann_id"],
                    "image_id": row["image_id"],
                    "y_true": row["category_name"],
                    "y_pred": y_pred,
                    "correct": int(y_pred == row["category_name"]),
                    **{f"prob_{c}": f"{float(v):.6f}" for c, v in zip(classes, p, strict=True)},
                }
            )


def metrics_from_predictions(path: Path, classes: list[str]) -> dict[str, Any]:
    """Recalcula todas las métricas leyendo únicamente predictions.csv."""
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score

    with path.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    y_true = [r["y_true"] for r in rows]
    y_pred = [r["y_pred"] for r in rows]
    for r in rows:
        probs = [float(r[f"prob_{c}"]) for c in classes]
        if classes[int(np.argmax(probs))] != r["y_pred"]:
            raise IntegrityError(f"predictions.csv inconsistente en ann_id {r['ann_id']}: y_pred != argmax")

    report = classification_report(y_true, y_pred, labels=classes, output_dict=True, zero_division=0)
    per_class = {
        c: {
            "precision": report[c]["precision"],
            "recall": report[c]["recall"],
            "f1": report[c]["f1-score"],
            "support": int(report[c]["support"]),
        }
        for c in classes
    }
    return {
        "n_samples": len(rows),
        "accuracy": accuracy_score(y_true, y_pred),
        "f1_macro": f1_score(y_true, y_pred, labels=classes, average="macro", zero_division=0),
        "per_class": per_class,
        "confusion_matrix": {
            "labels": classes,
            "matrix": confusion_matrix(y_true, y_pred, labels=classes).tolist(),
        },
    }


def flat_metrics(metrics: dict[str, Any]) -> dict[str, float]:
    """Métricas numéricas con prefijo test_, listas para MLflow."""
    flat = {
        f"{METRIC_PREFIX}accuracy": metrics["accuracy"],
        f"{METRIC_PREFIX}f1_macro": metrics["f1_macro"],
        f"{METRIC_PREFIX}n_samples": metrics["n_samples"],
    }
    for cls, m in metrics["per_class"].items():
        for key, value in m.items():
            flat[f"{METRIC_PREFIX}{key}_{cls}"] = value
    return {k: float(v) for k, v in flat.items()}


def save_confusion_png(cm: dict, path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    labels, matrix = cm["labels"], np.array(cm["matrix"])
    fig, ax = plt.subplots(figsize=(1.6 * len(labels) + 2, 1.6 * len(labels) + 1.5))
    ax.imshow(matrix, cmap="Blues")
    ax.set_xticks(range(len(labels)), labels)
    ax.set_yticks(range(len(labels)), labels)
    ax.set_xlabel("Predicha")
    ax.set_ylabel("Real")
    ax.set_title("Matriz de confusión (test)")
    for i in range(len(labels)):
        for j in range(len(labels)):
            color = "white" if matrix[i, j] > matrix.max() / 2 else "black"
            ax.text(j, i, int(matrix[i, j]), ha="center", va="center", color=color)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def write_outputs(out_dir: Path, metrics: dict[str, Any], provenance: dict[str, str]) -> None:
    """Escribe los reportes. `provenance` liga la carpeta al run y a los datos sin depender de MLflow."""

    def dump(name: str, data: Any) -> None:
        (out_dir / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    summary = {k: v for k, v in metrics.items() if k not in ("per_class", "confusion_matrix")}
    dump("metrics.json", {**provenance, **summary})
    dump("classification_report.json", metrics["per_class"])
    dump("confusion_matrix.json", metrics["confusion_matrix"])
    save_confusion_png(metrics["confusion_matrix"], out_dir / "confusion_matrix.png")


# ---------------------------------------------------------------------------
# MLflow
# ---------------------------------------------------------------------------


def mlflow_client():
    from mlflow.tracking import MlflowClient

    return MlflowClient(tracking_uri())


def log_to_run(client, run_id: str, metrics: dict[str, float], out_dir: Path, tags: dict[str, str]) -> None:
    from mlflow.entities import Metric

    now = int(time.time() * 1000)
    client.log_batch(run_id, metrics=[Metric(k, v, now, 0) for k, v in sorted(metrics.items())])
    for key, value in tags.items():
        client.set_tag(run_id, key, value)
    client.log_artifacts(run_id, str(out_dir), artifact_path="test")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def print_summary(metrics: dict[str, Any], run_id: str) -> None:
    print(f"Run: {run_id}   muestras de test: {metrics['n_samples']}")
    print(f"accuracy top-1: {metrics['accuracy']:.4f}   F1 macro: {metrics['f1_macro']:.4f}\n")
    print(f"{'clase':<12}{'precisión':>10}{'recall':>9}{'F1':>8}{'soporte':>9}")
    for cls, m in metrics["per_class"].items():
        print(f"{cls:<12}{m['precision']:>10.4f}{m['recall']:>9.4f}{m['f1']:>8.4f}{m['support']:>9}")
    cm = metrics["confusion_matrix"]
    print("\nMatriz de confusión (filas = real, columnas = predicha)")
    print(" " * 12 + "".join(f"{c:>10}" for c in cm["labels"]))
    for label, row in zip(cm["labels"], cm["matrix"], strict=True):
        print(f"{label:<12}" + "".join(f"{v:>10}" for v in row))
    status = "cumple" if metrics["accuracy"] >= TARGET_ACCURACY else "NO cumple"
    print(f"\nMeta accuracy >= {TARGET_ACCURACY:.0%}: {status}")


def run(args: argparse.Namespace) -> int:
    selection = read_json(args.selection)
    check_run_matches_selection(args.run_id, selection)

    client = mlflow_client()
    run_info = client.get_run(args.run_id)
    check_not_evaluated(list(run_info.data.metrics), args.out_dir)
    manifest_sha = check_manifest(args.manifest, run_info.data.tags, selection)

    with tempfile.TemporaryDirectory() as tmp:
        package_dir = args.package_dir
        if package_dir is None:
            package_dir = Path(tmp)
            for name in PACKAGE_FILES:
                client.download_artifacts(args.run_id, name, str(package_dir))
        weights_sha = check_weights(package_dir, selection)

        classes = read_classes(package_dir / "classes.json")
        rows = read_test_rows(args.manifest, classes)
        fingerprint = check_test_fingerprint(rows, args.leakage_report)

        paths = [args.data_root / r["crop_path"] for r in rows]
        missing = [str(p) for p in paths if not p.is_file()]
        if missing:
            raise InputError(f"Faltan {len(missing)} recortes de test, p. ej. {missing[:3]} (¿hiciste dvc pull?)")

        loaded = load_package(package_dir, args.device)
        if list(loaded.classes) != classes:
            raise IntegrityError("Las clases del modelo no coinciden con classes.json")
        probs = predict_proba(loaded, paths, args.batch_size)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    predictions = args.out_dir / "predictions.csv"
    write_predictions(predictions, rows, probs, classes)
    metrics = metrics_from_predictions(predictions, classes)

    provenance = {
        "run_id": args.run_id,
        "evaluated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "manifest_sha256": manifest_sha,
        "weights_sha256": weights_sha,
        "test_ids_fingerprint": fingerprint,
    }
    write_outputs(args.out_dir, metrics, provenance)

    tags = {
        "test_evaluated_at": provenance["evaluated_at"],
        "test_manifest_sha256": manifest_sha,
        "test_ids_fingerprint": fingerprint,
        "test_weights_sha256": weights_sha,
        "test_eval_git_commit": git_commit() or "desconocido",
        "test_meets_target": str(metrics["accuracy"] >= TARGET_ACCURACY).lower(),
    }
    log_to_run(client, args.run_id, flat_metrics(metrics), args.out_dir, tags)
    print_summary(metrics, args.run_id)
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--run-id", required=True, help="Run ganador congelado en selection.json")
    p.add_argument("--selection", type=Path, default=Path("reports/t07/selection.json"))
    p.add_argument("--manifest", type=Path, default=Path("data/splits/manifest.csv"))
    p.add_argument("--leakage-report", type=Path, default=Path("data/splits/leakage_report.json"))
    p.add_argument("--data-root", type=Path, default=Path("data/crops"))
    p.add_argument("--out-dir", type=Path, default=Path("reports/t08"))
    p.add_argument(
        "--package-dir", type=Path, default=None, help="Copia local de weights.pt, classes.json y preprocess.json"
    )
    p.add_argument("--device", default="cpu")
    p.add_argument("--batch-size", type=int, default=64)
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        return run(args)
    except InputError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except IntegrityError as exc:
        print(f"ERROR DE INTEGRIDAD: {exc}", file=sys.stderr)
        return 4
    except AlreadyEvaluatedError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 5


if __name__ == "__main__":
    sys.exit(main())
