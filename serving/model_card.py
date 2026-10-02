"""Tarjeta del modelo publicado (T15).

Genera ``model_card.md`` para una versión publicada por T10 a partir de fuentes
reales, sin placeholders:

- el paquete publicado en S3 (``classes.json``, ``preprocess.json``, ``summary.json``
  y ``weights.pt``, cuyo SHA-256 se verifica contra ``published_models``);
- el run de MLflow de origen (hiperparámetros, semillas, procedencia, métricas de
  validación y las métricas ``test_*`` + ``test/confusion_matrix.json`` de T08);
- los artefactos versionados en Git (``selection.json`` de T07, reportes de T03/T04).

La tarjeta se escribe en el repo y, con ``--upload``, junto al paquete en S3
(``models/<name>/<version>/model_card.md``), donde la muestra la página Models (T13).

Uso:
    python -m serving.model_card --version 1.0.0            # escribe reports/model_card/1.0.0/
    python -m serving.model_card --version 1.0.0 --upload   # y la publica en el bucket
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import math
import os
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import UTC
from pathlib import Path
from typing import Any

from serving import db, storage
from serving.storage import S3Settings, StorageError

log = logging.getLogger(__name__)

CARD_FILE = "model_card.md"
TARGET_ACCURACY = 0.85
CARD_PACKAGE_FILES = ("classes.json", "preprocess.json", "summary.json", "weights.pt")


class CardError(RuntimeError):
    """Las fuentes no son coherentes entre sí o falta una pieza (p. ej. T08)."""


@dataclass
class TestResults:
    n_samples: int
    accuracy: float
    f1_macro: float
    per_class: dict[str, dict[str, float]]
    labels: list[str]
    matrix: list[list[int]]
    evaluated_at: str | None


@dataclass
class CardContext:
    name: str
    version: str
    published_at: str
    s3_uri: str
    weights_sha256: str
    dvc_release: str
    run_id: str
    run_name: str | None
    params: dict[str, str]
    tags: dict[str, str]
    val_metrics: dict[str, float]
    test: TestResults
    classes: list[str]
    preprocess: dict[str, Any]
    summary: dict[str, Any]
    selection: dict[str, Any]
    split_counts: dict[str, dict[str, int]]
    leakage: dict[str, Any]
    exclusions: dict[str, Any]
    registry_version: str | None = None
    notes: list[str] = field(default_factory=list)


# --- Cálculos -----------------------------------------------------------------


def wilson_interval(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Intervalo de confianza del 95 % para una proporción (Wilson)."""
    if n == 0:
        return (0.0, 0.0)
    p = successes / n
    denom = 1 + z**2 / n
    center = (p + z**2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2)) / denom
    return (center - half, center + half)


def majority_baseline(test: TestResults) -> tuple[str, float]:
    """Accuracy de predecir siempre la clase más frecuente del mismo test."""
    support = {c: int(test.per_class[c]["support"]) for c in test.labels}
    cls = max(support, key=support.get)
    return cls, support[cls] / test.n_samples


def check_consistency(ctx: CardContext) -> None:
    """La tarjeta solo se genera si todas las fuentes describen el mismo artefacto."""
    problems = []
    if ctx.test.labels != ctx.classes:
        problems.append(f"clases del test {ctx.test.labels} != classes.json publicado {ctx.classes}")
    tag_classes = json.loads(ctx.tags.get("classes", "null") or "null")
    if tag_classes is not None and tag_classes != ctx.classes:
        problems.append(f"clases del run {tag_classes} != classes.json publicado {ctx.classes}")
    total = sum(sum(row) for row in ctx.test.matrix)
    if total != ctx.test.n_samples:
        problems.append(f"la matriz de confusión suma {total}, no {ctx.test.n_samples}")
    correct = sum(ctx.test.matrix[i][i] for i in range(len(ctx.test.matrix)))
    if abs(correct / ctx.test.n_samples - ctx.test.accuracy) > 1e-9:
        problems.append("la accuracy registrada no coincide con la diagonal de la matriz")
    test_weights = ctx.tags.get("test_weights_sha256")
    if test_weights and test_weights != ctx.weights_sha256:
        problems.append("T08 evaluó otros pesos que los publicados")
    if ctx.selection.get("run_id") != ctx.run_id:
        problems.append(f"el run publicado {ctx.run_id} no es el congelado en selection.json")
    if ctx.summary.get("data", {}).get("manifest_sha256") != ctx.tags.get("manifest_sha256"):
        problems.append("summary.json publicado y el run no apuntan al mismo manifiesto")
    if problems:
        raise CardError("fuentes incoherentes:\n- " + "\n- ".join(problems))


# --- Render -------------------------------------------------------------------


def _pct(value: float, digits: int = 2) -> str:
    return f"{value * 100:.{digits}f} %"


def _code(value: object) -> str:
    return f"`{value}`"


def render_card(ctx: CardContext) -> str:
    check_consistency(ctx)
    p, t, s = ctx.params, ctx.test, ctx.summary
    arch = s.get("model", {}).get("arch", {})
    weights = s.get("model", {}).get("pretrained_weights", {})
    resize = ctx.preprocess["resize"]
    norm = ctx.preprocess["normalize"]
    correct = sum(t.matrix[i][i] for i in range(len(t.matrix)))
    low, high = wilson_interval(correct, t.n_samples)
    base_cls, base_acc = majority_baseline(t)
    worst = min(t.labels, key=lambda c: t.per_class[c]["recall"])
    confused = max(
        (
            (t.labels[i], t.labels[j], t.matrix[i][j])
            for i in range(len(t.labels))
            for j in range(len(t.labels))
            if i != j
        ),
        key=lambda x: x[2],
    )
    excluded = ctx.exclusions.get("clases_excluidas", [])
    discarded = sum(v.get("n", 0) for v in ctx.exclusions.get("cajas_descartadas", {}).values())
    criterion = ctx.selection.get("criterion", {})
    bucket_key = ctx.s3_uri.removeprefix("s3://")
    bucket, prefix = bucket_key.split("/", 1)

    registry = _code(f"{ctx.name} v{ctx.registry_version}") if ctx.registry_version else "—"
    v = ctx.val_metrics
    accuracy_row = f"**{_pct(t.accuracy)}** ({correct}/{t.n_samples}); IC 95 % {_pct(low, 1)}–{_pct(high, 1)}"
    lines = [
        f"# Tarjeta del modelo: {ctx.name} {ctx.version}",
        "",
        "> Generada por `python -m serving.model_card` desde el paquete publicado en S3, el run de",
        "> MLflow y los artefactos versionados del repo. Ninguna cifra se escribe a mano.",
        "",
        "## Propósito y uso previsto",
        "",
        f"Clasificador multiclase de **un objeto por imagen**: recibe el recorte de una caja COCO y "
        f"predice su clase entre {', '.join(_code(c) for c in ctx.classes)}. Se usa desde la página "
        "**Inference** del portal para sugerir la etiqueta de imágenes nuevas, que después revisa un "
        "anotador en la cola de anotación.",
        "",
        "**No** está pensado para imágenes completas con varios objetos ni para clases distintas a "
        "las listadas: siempre devuelve una de ellas (no tiene opción de rechazo).",
        "",
        "## Versión publicada",
        "",
        "| Campo | Valor |",
        "|---|---|",
        f"| Versión de modelo | {_code(ctx.version)} |",
        f"| Publicado | {ctx.published_at} |",
        f"| Paquete en S3 | {_code(ctx.s3_uri)} |",
        f"| SHA-256 de `weights.pt` | {_code(ctx.weights_sha256)} |",
        f"| Model Registry de MLflow | {registry} |",
        "",
        "## Datos de origen",
        "",
        f"- **Release DVC del Proyecto 2:** {_code(ctx.dvc_release)} (md5 de anotaciones "
        f"{_code(ctx.tags.get('release_annotations_md5', '—'))}).",
        f"- **Recortes (T03):** una muestra por caja COCO válida; se descartaron {discarded} cajas "
        f"(área menor a {ctx.exclusions.get('parametros', {}).get('min_area', '—')} px²). "
        f"Recortes versionados en DVC con md5 {_code(ctx.tags.get('crops_dvc_md5', '—'))}. "
        "La caja COCO de origen y el rectángulo recortado de cada uno están en "
        f"{_code('data/crops/crops_source_boxes.csv')}.",
        "- **Clases incluidas:** las que tienen al menos "
        f"{ctx.exclusions.get('parametros', {}).get('min_images', '—')} imágenes originales. "
        + (
            "Excluidas: " + "; ".join(f"{_code(e['category_name'])}: {e['motivo']}" for e in excluded) + "."
            if excluded
            else "Sin exclusiones."
        ),
        f"- **Manifiesto 70/20/10 (T04):** SHA-256 {_code(ctx.tags.get('manifest_sha256', '—'))}, "
        f"md5 DVC {_code(ctx.tags.get('manifest_dvc_md5', '—'))}, semilla {ctx.leakage.get('semilla', '—')}. "
        "Agrupado por imagen original y duplicados cercanos (pHash): "
        f"**fuga = {ctx.leakage.get('fuga', {}).get('total', '—')}**. Huella del test "
        f"{_code(ctx.leakage.get('test_huella_sha256', '—'))}.",
        "",
        "| Clase | Train | Val | Test |",
        "|---|---:|---:|---:|",
        *[
            f"| {c} | {ctx.split_counts[c]['train']} | {ctx.split_counts[c]['val']} | {ctx.split_counts[c]['test']} |"
            for c in ctx.classes
        ],
        "",
        "## Modelo y entrenamiento",
        "",
        f"- **Arquitectura:** {arch.get('backbone', '—')} con cabeza MLP propia "
        f"(capas ocultas {arch.get('hidden_layers', '—')}, dropout {arch.get('dropout', '—')}, "
        f"{len(ctx.classes)} salidas).",
        f"- **Pesos iniciales:** {weights.get('source', '—')} ({weights.get('dataset', '—')}); "
        f"capas entrenables del backbone: {_code(arch.get('trainable_backbone', '—'))}; "
        f"{s.get('model', {}).get('trainable_params', '—')} de {s.get('model', {}).get('total_params', '—')} "
        "parámetros entrenables.",
        f"- **Run de MLflow:** {_code(ctx.run_id)} ({ctx.run_name or '—'}), commit "
        f"{_code(ctx.tags.get('git_commit', '—'))}"
        + (
            " con cambios sin commit; el código exacto está en `source/source_diff.patch` del run."
            if ctx.tags.get("git_dirty") == "true"
            else "."
        ),
        f"- **Selección (T07):** candidato elegido por {criterion.get('mode', '—')} "
        f"{_code(criterion.get('metric', '—'))} en {criterion.get('split', '—')} entre "
        f"{len(ctx.selection.get('candidates', []))} corridas, congelado el {ctx.selection.get('selected_at', '—')}, "
        "antes de abrir el test.",
        "",
        "| Hiperparámetro | Valor |",
        "|---|---|",
        *[
            f"| `{k}` | {p.get(k, '—')} |"
            for k in (
                "optimizer",
                "batch_size",
                "max_epochs",
                "lr",
                "img_size",
                "hidden_layers",
                "dropout",
                "weight_decay",
                "shuffle_seed",
                "aug_seed",
                "init_seed",
                "monitor",
                "patience",
                "min_delta",
            )
        ],
        "",
        f"Early stopping por {_code(p.get('monitor', '—'))}: mejor época **{int(ctx.val_metrics['best_epoch'])}**, "
        f"paró en la {int(ctx.val_metrics['stopped_epoch'])} y se restauraron los pesos de la mejor época "
        f"(`best_val_loss` {v['best_val_loss']:.4f}, `best_val_acc` {_pct(v['best_val_acc'])}).",
        "",
        "## Desempeño en test",
        "",
        f"Evaluación única (T08) sobre el 10 % de test congelado ({t.n_samples} recortes), "
        f"{'el ' + t.evaluated_at if t.evaluated_at else ''}.",
        "",
        "| Métrica | Valor |",
        "|---|---:|",
        f"| Accuracy top-1 | {accuracy_row} |",
        f"| Meta ≥ {_pct(TARGET_ACCURACY, 0)} | {'cumple' if t.accuracy >= TARGET_ACCURACY else 'NO cumple'} |",
        f"| F1 macro | {_pct(t.f1_macro)} |",
        f"| Baseline (siempre {_code(base_cls)}) | {_pct(base_acc)} |",
        "",
        "| Clase | Precisión | Recall | F1 | Soporte |",
        "|---|---:|---:|---:|---:|",
        *[
            f"| {c} | {t.per_class[c]['precision']:.4f} | {t.per_class[c]['recall']:.4f} | "
            f"{t.per_class[c]['f1']:.4f} | {int(t.per_class[c]['support'])} |"
            for c in t.labels
        ],
        "",
        "Matriz de confusión (filas = clase real, columnas = predicha):",
        "",
        "| Real \\ Predicha | " + " | ".join(t.labels) + " |",
        "|---|" + "---:|" * len(t.labels),
        *[
            f"| {label} | " + " | ".join(str(v) for v in row) + " |"
            for label, row in zip(t.labels, t.matrix, strict=True)
        ],
        "",
        "## Preprocesamiento exacto",
        "",
        f"1. Convertir a {ctx.preprocess.get('color_mode', 'RGB')}.",
        f"2. Redimensionar a {resize['height']}×{resize['width']} px ({resize['interpolation']}, "
        f"antialias={resize['antialias']}), sin recortar.",
        "3. Escalar a [0, 1] (píxel / 255).",
        f"4. Normalizar con media {norm['mean']} y desviación {norm['std']} (ImageNet).",
        f"5. Tensor {ctx.preprocess.get('input_layout', 'NCHW')}; salida: logits → softmax en el orden "
        "de `classes.json`.",
        "",
        "Es el mismo transform de validación y test; lo reconstruye `trainer.load_model` desde",
        "`preprocess.json`, así que no hay que reimplementarlo.",
        "",
        "## Limitaciones y sesgos",
        "",
        f"- Solo distingue {len(ctx.classes)} clases; cualquier otro objeto se asignará a una de ellas.",
        f"- La clase con menor recall es {_code(worst)} ({_pct(t.per_class[worst]['recall'])}); la confusión "
        f"más frecuente es {_code(confused[0])} → {_code(confused[1])} ({confused[2]} casos).",
        f"- El test tiene solo {t.n_samples} recortes: el intervalo de confianza de la accuracy es amplio "
        f"({_pct(low, 1)}–{_pct(high, 1)}).",
        f"- Las clases están desbalanceadas (baseline {_pct(base_acc)}); por eso se reporta F1 macro y "
        "recall por clase.",
        "- Los datos vienen de un solo release del Proyecto 2 (recortes COCO de fotos similares); el "
        "desempeño en fotos de otro dominio, recortes muy pequeños o mal encuadrados no está medido.",
        "- Entrenado y evaluado en CPU; en GPU los resultados pueden variar en los últimos decimales.",
        "",
        "## Cómo descargarlo y cargarlo",
        "",
        "```bash",
        f"aws s3 cp --recursive {ctx.s3_uri}/ ./modelo-{ctx.version}/",
        f"sha256sum ./modelo-{ctx.version}/weights.pt   # debe ser {ctx.weights_sha256}",
        "```",
        "",
        "```python",
        "import torch",
        "from PIL import Image",
        "from trainer import load_model",
        "",
        f'm = load_model("./modelo-{ctx.version}")   # verifica classes.json y aplica preprocess.json',
        'x = m.transform(Image.open("recorte.jpg").convert("RGB")).unsqueeze(0)',
        "probs = torch.softmax(m.model(x), dim=1)[0]",
        "print(dict(zip(m.classes, probs.tolist())))",
        "```",
        "",
        f"O con el servicio de inferencia (T10): `curl -F version={ctx.version} -F file=@recorte.jpg "
        "http://localhost:8000/predict`. El servicio descarga el paquete de "
        f"`s3://{bucket}/{prefix}` y verifica el SHA-256 antes de cargarlo.",
        "",
    ]
    lines += [f"> Nota: {n}" for n in ctx.notes]
    card = "\n".join(lines)
    if "{{" in card or "}}" in card:
        raise CardError("la tarjeta quedó con placeholders sin resolver")
    return card + ("\n" if not card.endswith("\n") else "")


# --- Recolección de fuentes ---------------------------------------------------


def _read_json(path: Path) -> Any:
    if not path.is_file():
        raise CardError(f"falta {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def read_split_counts(path: Path) -> dict[str, dict[str, int]]:
    with path.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    return {
        r["clase"]: {k: int(r[k]) for k in ("train", "val", "test", "total")} for r in rows if r["clase"] != "TOTAL"
    }


def collect_context(
    version: str,
    *,
    repo_root: Path = Path("."),
    tracking_uri: str | None = None,
    s3_settings: S3Settings | None = None,
    name: str = storage.MODEL_NAME,
) -> CardContext:
    from mlflow.tracking import MlflowClient

    conn = db.connect()
    try:
        row = db.get_model_version(conn, version, name)
    finally:
        conn.close()
    if not row:
        raise CardError(f"la versión {version} no está en published_models; publícala con publish_model.py")

    settings = s3_settings or S3Settings.from_env()
    client_s3 = storage.make_s3_client(settings)
    client = MlflowClient(tracking_uri or os.environ.get("MLFLOW_TRACKING_URI"))
    run = client.get_run(row["run_id"])

    with tempfile.TemporaryDirectory() as tmp:
        pkg = storage.download_package(client_s3, settings.bucket, version, Path(tmp) / "pkg", name, CARD_PACKAGE_FILES)
        storage.verify_checkpoint_hash(pkg, row["sha256"])
        classes_raw = _read_json(pkg / "classes.json")
        classes = [classes_raw[str(i)] for i in range(len(classes_raw))]
        preprocess = _read_json(pkg / "preprocess.json")
        summary = _read_json(pkg / "summary.json")
        try:
            cm_path = Path(client.download_artifacts(run.info.run_id, "test/confusion_matrix.json", tmp))
        except Exception as exc:  # noqa: BLE001 - MLflow lanza distintos tipos según el store
            raise CardError(f"el run {run.info.run_id} no tiene test/confusion_matrix.json: ¿ya corrió T08?") from exc
        confusion = _read_json(cm_path)

    m = run.data.metrics
    if "test_accuracy" not in m:
        raise CardError(f"el run {run.info.run_id} no tiene métricas test_*: ¿ya corrió T08?")
    per_class = {
        c: {k: m[f"test_{k}_{c}"] for k in ("precision", "recall", "f1", "support")} for c in confusion["labels"]
    }
    test = TestResults(
        n_samples=int(m["test_n_samples"]),
        accuracy=m["test_accuracy"],
        f1_macro=m["test_f1_macro"],
        per_class=per_class,
        labels=confusion["labels"],
        matrix=confusion["matrix"],
        evaluated_at=run.data.tags.get("test_evaluated_at"),
    )

    registry_version = None
    try:
        for mv in client.search_model_versions(f"name='{name}'"):
            if mv.tags.get("semver") == version:
                registry_version = mv.version
    except Exception:  # noqa: BLE001 - registry opcional
        log.warning("no se pudo consultar el Model Registry")

    # Fecha real de publicación = última escritura de weights.pt en el bucket (no la de la fila,
    # que conserva la primera inserción si la versión se republicó).
    head = client_s3.head_object(Bucket=settings.bucket, Key=storage.model_key(version, "weights.pt", name))
    published_at = head["LastModified"].astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
    if head.get("VersionId"):
        published_at += f" (VersionId de weights.pt `{head['VersionId']}`)"
    return CardContext(
        name=name,
        version=version,
        published_at=published_at,
        s3_uri=f"s3://{settings.bucket}/{storage.model_prefix(version, name)}",
        weights_sha256=row["sha256"],
        dvc_release=row["dvc_release"] or run.data.tags.get("dvc_release", "—"),
        run_id=run.info.run_id,
        run_name=run.info.run_name,
        params=dict(run.data.params),
        tags=dict(run.data.tags),
        val_metrics={k: m[k] for k in ("best_val_loss", "best_val_acc", "best_epoch", "stopped_epoch")},
        test=test,
        classes=classes,
        preprocess=preprocess,
        summary=summary,
        selection=_read_json(repo_root / "reports" / "t07" / "selection.json"),
        split_counts=read_split_counts(repo_root / "data" / "splits" / "split_report.csv"),
        leakage=_read_json(repo_root / "data" / "splits" / "leakage_report.json"),
        exclusions=_read_json(repo_root / "data" / "crops" / "exclusions.json"),
        registry_version=registry_version,
    )


def upload_card(card_path: Path, version: str, settings: S3Settings, name: str = storage.MODEL_NAME) -> str:
    key = storage.model_key(version, CARD_FILE, name)
    storage.make_s3_client(settings).upload_file(
        str(card_path), settings.bucket, key, ExtraArgs={"ContentType": "text/markdown; charset=utf-8"}
    )
    return f"s3://{settings.bucket}/{key}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m serving.model_card", description=__doc__.split("\n")[0])
    parser.add_argument("--version", required=True, help="versión publicada, p. ej. 1.0.0")
    parser.add_argument(
        "--out", type=Path, help="ruta del .md (por defecto reports/model_card/<versión>/model_card.md)"
    )
    parser.add_argument("--upload", action="store_true", help="publica la tarjeta junto al paquete en S3")
    parser.add_argument("--use-minio", action="store_true", help="lee/escribe el paquete en MinIO (pruebas)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    out = args.out or Path("reports") / "model_card" / args.version / CARD_FILE
    try:
        storage.parse_semver(args.version)
        settings = S3Settings.from_env(use_minio=args.use_minio)
        card = render_card(collect_context(args.version, s3_settings=settings))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(card, encoding="utf-8", newline="\n")
        print(f"tarjeta escrita en {out}")
        if args.upload:
            print(f"publicada en {upload_card(out, args.version, settings)}")
    except (CardError, StorageError, db.DBError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
