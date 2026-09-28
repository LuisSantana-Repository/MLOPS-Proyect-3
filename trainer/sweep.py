"""Barrido de experimentos y selección del candidato por validación (T07).

``python -m trainer.sweep run configs/experiments/t07.yaml``
    Valida las 10 configs antes de gastar horas de CPU, las corre en secuencia con
    ``run_tracked`` y salta las que ya terminaron (se puede reanudar).

``python -m trainer.sweep report configs/experiments/t07.yaml``
    Lee los runs desde MLflow, filtra los válidos, escribe la tabla comparativa y
    congela el candidato en ``selection.json`` con el criterio predeclarado. No usa test.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import mlflow
import yaml
from mlflow.entities import Run
from mlflow.tracking import MlflowClient
from pydantic import ValidationError

from trainer.config import TrainConfig, load_config
from trainer.data import DataError
from trainer.tracking import DEFAULT_EXPERIMENT, ProvenanceError, config_params, run_tracked, tracking_uri

log = logging.getLogger(__name__)

SEVEN_PARAMS = ("optimizer", "batch_size", "max_epochs", "lr", "img_size", "hidden_layers", "dropout")
# Parámetros que dependen de la corrida y no del diseño del experimento.
RUN_SPECIFIC_PARAMS = {"output_dir"}
SELECTION_FILE = "selection.json"


class SweepError(RuntimeError):
    pass


# --- Especificación -----------------------------------------------------------


@dataclass
class Experiment:
    id: str
    question: str
    overrides: dict[str, Any] = field(default_factory=dict)


@dataclass
class SweepSpec:
    name: str
    base_config: Path
    output_dir: Path
    metric: str
    mode: str
    tie_breakers: list[tuple[str, str]]
    experiments: list[Experiment]
    min_valid_runs: int = 10
    experiment_name: str = DEFAULT_EXPERIMENT
    report_dir: Path | None = None

    def reports(self) -> Path:
        return self.report_dir or Path("reports") / self.name


def _parse_tie_breaker(item: str) -> tuple[str, str]:
    key, _, mode = item.partition(":")
    if mode not in {"min", "max"}:
        raise SweepError(f"desempate inválido '{item}', usa clave:min o clave:max")
    return key, mode


def load_sweep(path: str | Path) -> SweepSpec:
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    selection = data.get("selection") or {}
    experiments = [
        Experiment(id=str(e["id"]), question=str(e.get("question", "")), overrides=e.get("overrides") or {})
        for e in data.get("experiments") or []
    ]
    ids = [e.id for e in experiments]
    if len(set(ids)) != len(ids):
        raise SweepError(f"ids de experimento repetidos: {sorted({i for i in ids if ids.count(i) > 1})}")
    if selection.get("mode", "min") not in {"min", "max"}:
        raise SweepError("selection.mode debe ser min o max")
    return SweepSpec(
        name=str(data["sweep"]),
        base_config=Path(data["base_config"]),
        output_dir=Path(data.get("output_dir", f"runs/{data['sweep']}")),
        metric=str(selection.get("metric", "best_val_loss")),
        mode=str(selection.get("mode", "min")),
        tie_breakers=[_parse_tie_breaker(t) for t in selection.get("tie_breakers", [])],
        experiments=experiments,
        min_valid_runs=int(data.get("min_valid_runs", 10)),
        experiment_name=str(data.get("experiment", DEFAULT_EXPERIMENT)),
        report_dir=Path(data["report_dir"]) if data.get("report_dir") else None,
    )


def build_configs(spec: SweepSpec) -> dict[str, TrainConfig]:
    """Valida todas las configs antes de entrenar; un error aquí no gasta CPU."""
    configs, errors = {}, []
    for exp in spec.experiments:
        overrides = {**exp.overrides, "output_dir": str(spec.output_dir / exp.id)}
        try:
            configs[exp.id] = load_config(spec.base_config, overrides)
        except ValidationError as exc:
            errors.append(f"{exp.id}: {exc}")
    if errors:
        raise SweepError("configs inválidas:\n" + "\n".join(errors))
    return configs


def design_params(cfg: TrainConfig) -> dict[str, str]:
    return {k: v for k, v in config_params(cfg).items() if k not in RUN_SPECIFIC_PARAMS}


def coverage(param_sets: list[dict[str, str]]) -> dict[str, list[str]]:
    """Valores distintos que toma cada uno de los 7 parámetros."""
    return {p: sorted({params[p] for params in param_sets if p in params}) for p in SEVEN_PARAMS}


def effective_params(cfg: TrainConfig) -> dict[str, str]:
    """Parámetros de diseño con equivalencias resueltas: con weight_decay=0, Adam y AdamW
    hacen exactamente las mismas actualizaciones."""
    params = design_params(cfg)
    if params["optimizer"] == "adam" and cfg.weight_decay == 0:
        params["optimizer"] = "adamw"
    return params


def check_design(configs: dict[str, TrainConfig], min_runs: int) -> list[str]:
    problems = []
    if len(configs) < min_runs:
        problems.append(f"hay {len(configs)} experimentos; se piden al menos {min_runs}")
    seen: dict[str, str] = {}
    for exp_id, cfg in configs.items():
        key = json.dumps(effective_params(cfg), sort_keys=True)
        if key in seen:
            problems.append(f"{exp_id} repite exactamente la config de {seen[key]}")
        seen.setdefault(key, exp_id)
    for param, values in coverage([design_params(c) for c in configs.values()]).items():
        if len(values) < 2:
            problems.append(f"'{param}' toma un solo valor ({values}); la rúbrica pide al menos dos")
    data_keys = {(str(c.manifest_path), str(c.classes_path)) for c in configs.values()}
    if len(data_keys) > 1:
        problems.append(f"los experimentos no usan el mismo manifiesto y clases: {sorted(data_keys)}")
    return problems


# --- Ejecución ----------------------------------------------------------------


def _client() -> MlflowClient:
    uri = tracking_uri()
    mlflow.set_tracking_uri(uri)
    return MlflowClient(uri)


def sweep_runs(client: MlflowClient, spec: SweepSpec) -> list[Run]:
    experiment = client.get_experiment_by_name(spec.experiment_name)
    if experiment is None:
        return []
    return client.search_runs(
        [experiment.experiment_id],
        filter_string=f"tags.sweep = '{spec.name}'",
        order_by=["attributes.start_time ASC"],
        max_results=1000,
    )


def _finished_match(runs: list[Run], exp_id: str, params: dict[str, str]) -> Run | None:
    for run in runs:
        if run.info.status != "FINISHED" or run.data.tags.get("config_id") != exp_id:
            continue
        logged = {k: v for k, v in run.data.params.items() if k not in RUN_SPECIFIC_PARAMS}
        if logged == params:
            return run
    return None


def run_sweep(spec: SweepSpec, only: list[str] | None = None, dry_run: bool = False) -> dict[str, str]:
    """Corre los experimentos pendientes; devuelve {id: run_id | 'omitido' | 'error: ...'}."""
    configs = build_configs(spec)
    problems = check_design(configs, spec.min_valid_runs)
    if problems:
        raise SweepError("el diseño no cumple:\n- " + "\n- ".join(problems))
    unknown = sorted(set(only or []) - set(configs))
    if unknown:
        raise SweepError(f"ids desconocidos en --only: {unknown}")

    client = _client()
    done = sweep_runs(client, spec)
    outcome: dict[str, str] = {}
    questions = {e.id: e.question for e in spec.experiments}
    for exp_id, cfg in configs.items():
        if only and exp_id not in only:
            continue
        previous = _finished_match(done, exp_id, design_params(cfg))
        if previous is not None:
            log.info("%s ya terminó en el run %s; se omite", exp_id, previous.info.run_id)
            outcome[exp_id] = f"omitido (run {previous.info.run_id})"
            continue
        if dry_run:
            outcome[exp_id] = "pendiente"
            continue
        log.info("=== %s: %s", exp_id, questions[exp_id])
        try:
            tracked = run_tracked(
                cfg,
                experiment=spec.experiment_name,
                run_name=f"{spec.name}-{exp_id}",
                tags={"sweep": spec.name, "config_id": exp_id, "question": questions[exp_id]},
            )
            outcome[exp_id] = tracked.run_id
        except (DataError, ProvenanceError) as exc:
            raise SweepError(f"{exp_id}: {exc}") from exc  # afectaría a todas las corridas
        except Exception as exc:  # noqa: BLE001 - una corrida fallida no detiene el resto
            log.exception("%s falló", exp_id)
            outcome[exp_id] = f"error: {type(exc).__name__}: {exc}"
    return outcome


# --- Reporte y selección ------------------------------------------------------


@dataclass
class Row:
    config_id: str
    run_id: str
    run_name: str
    question: str
    params: dict[str, str]
    metrics: dict[str, float]
    tags: dict[str, str]
    start_time: int
    artifact_uri: str

    def value(self, key: str) -> float:
        if key == "start_time":
            return float(self.start_time)
        return float(self.metrics[key])


def collect(client: MlflowClient, spec: SweepSpec) -> tuple[list[Row], list[tuple[str, str]]]:
    """Runs válidos (uno por config_id, el más reciente) y la lista de excluidos con motivo."""
    valid: dict[str, Row] = {}
    excluded: list[tuple[str, str]] = []
    for run in sweep_runs(client, spec):
        tags, rid = run.data.tags, run.info.run_id
        if run.info.status != "FINISHED":
            reason = f"estado {run.info.status}"
            if tags.get("error"):
                reason += f" ({tags['error']})"
            excluded.append((rid, reason))
            continue
        if tags.get("smoke") == "true":
            excluded.append((rid, "corrida smoke"))
            continue
        missing = [m for m in (spec.metric, "best_val_acc", "best_epoch") if m not in run.data.metrics]
        if missing:
            excluded.append((rid, f"faltan métricas {missing}"))
            continue
        row = Row(
            config_id=tags.get("config_id", "?"),
            run_id=rid,
            run_name=tags.get("mlflow.runName", ""),
            question=tags.get("question", ""),
            params=dict(run.data.params),
            metrics=dict(run.data.metrics),
            tags=dict(tags),
            start_time=run.info.start_time,
            artifact_uri=run.info.artifact_uri,
        )
        if row.config_id in valid:
            excluded.append((valid[row.config_id].run_id, f"reemplazado por una corrida posterior de {row.config_id}"))
        valid[row.config_id] = row

    rows = list(valid.values())
    for key in ("manifest_sha256", "classes"):
        values = {r.tags.get(key) for r in rows}
        if len(values) > 1:
            raise SweepError(f"los runs del barrido no comparten {key}: {sorted(map(str, values))}")
    return rows, excluded


def rank(rows: list[Row], spec: SweepSpec) -> list[Row]:
    keys = [(spec.metric, spec.mode), *spec.tie_breakers]

    def sort_key(row: Row) -> tuple[float, ...]:
        return tuple(row.value(k) if mode == "min" else -row.value(k) for k, mode in keys)

    return sorted(rows, key=sort_key)


def selection_record(winner: Row, rows: list[Row], spec: SweepSpec) -> dict[str, Any]:
    t = winner.tags
    return {
        "sweep": spec.name,
        "selected_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "criterion": {
            "metric": spec.metric,
            "mode": spec.mode,
            "tie_breakers": [f"{k}:{m}" for k, m in spec.tie_breakers],
            "split": "val",
        },
        "test_split_used": False,
        "run_id": winner.run_id,
        "run_name": winner.run_name,
        "config_id": winner.config_id,
        "artifact_uri": winner.artifact_uri,
        "checkpoint": {"artifact": "weights.pt", "sha256": t.get("weights_sha256")},
        "metrics": {k: winner.metrics[k] for k in ("best_val_loss", "best_val_acc", "best_epoch", "stopped_epoch")},
        "params": {k: winner.params[k] for k in SEVEN_PARAMS},
        "data": {k: t.get(k) for k in ("dvc_release", "manifest_sha256", "manifest_dvc_md5", "classes")},
        "code": {k: t.get(k) for k in ("git_commit", "git_dirty", "source_diff_sha256")},
        "candidates": [r.run_id for r in rank(rows, spec)],
    }


def _fmt(value: float, digits: int = 4) -> str:
    return f"{value:.{digits}f}"


def other_changes(rows: list[Row]) -> dict[str, str]:
    """Parámetros fuera de los 7 que difieren del valor más común (p. ej. weight_decay)."""
    keys = sorted({k for r in rows for k in r.params} - set(SEVEN_PARAMS) - RUN_SPECIFIC_PARAMS)
    common = {k: Counter(r.params.get(k) for r in rows).most_common(1)[0][0] for k in keys}
    return {
        r.run_id: ", ".join(f"{k}={r.params.get(k)}" for k in keys if r.params.get(k) != common[k]) or "—" for r in rows
    }


def render_markdown(ranked: list[Row], excluded: list[tuple[str, str]], spec: SweepSpec, selection: dict) -> str:
    winner = ranked[0]
    cov = coverage([r.params for r in ranked])
    lines = [
        f"# Experimentos {spec.name}: comparación y candidato",
        "",
        f"- Experimento MLflow: `{spec.experiment_name}` · runs válidos: **{len(ranked)}**",
        f"- Datos: release `{winner.tags.get('dvc_release')}` · "
        f"manifiesto sha256 `{winner.tags.get('manifest_sha256')}`",
        f"- Clases: {winner.tags.get('classes')}",
        f"- Criterio predeclarado: **{spec.mode} `{spec.metric}`** en validación; desempates "
        + ", ".join(f"`{k}` ({m})" for k, m in spec.tie_breakers)
        + ". El split test no se usó.",
        f"- Seleccionado: **{winner.config_id}** · run `{winner.run_id}` · "
        f"pesos sha256 `{winner.tags.get('weights_sha256')}` · congelado {selection['selected_at']}",
        "",
        "| # | Exp | Run ID | optimizer | batch | max_ep | lr | img | hidden | dropout "
        "| otros cambios | best_val_loss | best_val_acc | mejor ép. | paró | motivo | min |",
        "|---|---|---|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|",
    ]
    others = other_changes(ranked)
    for i, r in enumerate(ranked, start=1):
        p = r.params
        mark = " ★" if r is winner else ""
        lines.append(
            f"| {i} | {r.config_id}{mark} | `{r.run_id}` | {p['optimizer']} | {p['batch_size']} | {p['max_epochs']} "
            f"| {p['lr']} | {p['img_size']} | {p['hidden_layers']} | {p['dropout']} | {others[r.run_id]} "
            f"| {_fmt(r.metrics['best_val_loss'])} | {_fmt(r.metrics['best_val_acc'])} "
            f"| {int(r.metrics['best_epoch'])} | {int(r.metrics['stopped_epoch'])} "
            f"| {r.tags.get('stop_reason', '')} | {r.metrics.get('duration_seconds', 0) / 60:.1f} |"
        )
    lines += ["", "## Cobertura de los 7 parámetros", "", "| Parámetro | Valores probados |", "|---|---|"]
    lines += [f"| `{p}` | {', '.join(v)} |" for p, v in cov.items()]
    lines += ["", "## Pregunta de cada experimento", ""]
    lines += [f"- **{r.config_id}**: {r.question}" for r in sorted(ranked, key=lambda r: r.config_id)]
    if excluded:
        lines += ["", "## Runs excluidos", ""]
        lines += [f"- `{rid}`: {reason}" for rid, reason in excluded]
    if any(r.tags.get("git_dirty") == "true" for r in ranked):
        lines += [
            "",
            "## Nota de trazabilidad",
            "",
            "Las corridas se lanzaron con cambios sin commit (`git_dirty=true`). Cada run guarda "
            "`source/source_diff.patch`; aplicado sobre `git_commit` reconstruye el código exacto usado.",
        ]
    return "\n".join(lines) + "\n"


def write_report(spec: SweepSpec, out_dir: Path | None = None, force: bool = False) -> dict[str, Any]:
    client = _client()
    rows, excluded = collect(client, spec)
    if len(rows) < spec.min_valid_runs:
        raise SweepError(f"hay {len(rows)} runs válidos; se necesitan {spec.min_valid_runs} antes de seleccionar")
    missing_cov = [p for p, v in coverage([r.params for r in rows]).items() if len(v) < 2]
    if missing_cov:
        raise SweepError(f"los runs válidos no varían {missing_cov}")

    ranked = rank(rows, spec)
    out = out_dir or spec.reports()
    out.mkdir(parents=True, exist_ok=True)
    selection_path = out / SELECTION_FILE
    selection = selection_record(ranked[0], rows, spec)
    if selection_path.exists():
        frozen = json.loads(selection_path.read_text(encoding="utf-8"))
        if frozen["run_id"] != selection["run_id"] and not force:
            raise SweepError(
                f"la selección ya está congelada en {frozen['run_id']} ({frozen['selected_at']}); "
                f"el ranking actual daría {selection['run_id']}. No se cambia el candidato sin --force."
            )
        selection = frozen if frozen["run_id"] == selection["run_id"] else selection
    selection_path.write_text(json.dumps(selection, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    (out / "experiments.md").write_text(render_markdown(ranked, excluded, spec, selection), encoding="utf-8")
    with (out / "experiments.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        metric_keys = ["best_val_loss", "best_val_acc", "best_epoch", "stopped_epoch", "duration_seconds"]
        writer.writerow(["rank", "config_id", "run_id", *SEVEN_PARAMS, *metric_keys, "stop_reason", "selected"])
        for i, r in enumerate(ranked, start=1):
            writer.writerow(
                [i, r.config_id, r.run_id, *(r.params[p] for p in SEVEN_PARAMS)]
                + [r.metrics.get(k) for k in metric_keys]
                + [r.tags.get("stop_reason"), r.run_id == selection["run_id"]]
            )

    for r in rows:
        client.set_tag(r.run_id, "candidate", str(r.run_id == selection["run_id"]).lower())
    client.set_tag(selection["run_id"], "selected_at", selection["selected_at"])
    client.set_tag(selection["run_id"], "selection_criterion", f"{spec.mode} {spec.metric} (val)")
    return selection


# --- CLI ----------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m trainer.sweep", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    run_p = sub.add_parser("run", help="corre los experimentos pendientes del barrido")
    run_p.add_argument("spec", type=Path)
    run_p.add_argument("--only", nargs="+", metavar="ID", help="solo estos experimentos")
    run_p.add_argument("--dry-run", action="store_true", help="valida y muestra qué correría, sin entrenar")
    rep_p = sub.add_parser("report", help="tabla comparativa y selección congelada del candidato")
    rep_p.add_argument("spec", type=Path)
    rep_p.add_argument("--out-dir", type=Path, help="por defecto reports/<sweep>")
    rep_p.add_argument("--force", action="store_true", help="permite cambiar un candidato ya congelado")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    try:
        spec = load_sweep(args.spec)
        if args.command == "run":
            outcome = run_sweep(spec, only=args.only, dry_run=args.dry_run)
            for exp_id, result in outcome.items():
                print(f"{exp_id}: {result}")
            return 1 if any(v.startswith("error") for v in outcome.values()) else 0
        selection = write_report(spec, args.out_dir, force=args.force)
    except (SweepError, FileNotFoundError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(
        f"candidato {selection['config_id']} · run {selection['run_id']} · "
        f"{spec.metric}={selection['metrics'][spec.metric]:.4f}; reporte en {args.out_dir or spec.reports()}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
