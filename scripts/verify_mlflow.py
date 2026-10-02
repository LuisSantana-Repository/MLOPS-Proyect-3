"""Verifica que el MLflow apuntado por MLFLOW_TRACKING_URI tiene las corridas reales de T07 (P0-1).

Comprueba contra ``reports/t07/selection.json`` (congelado, no se modifica):

- runs:        existen los run IDs de ``candidates`` (las 10 corridas del barrido).
- finished:    todos terminaron en FINISHED.
- sweep:       todos llevan ``tags.sweep`` del barrido.
- manifest:    todos usan el mismo ``manifest_sha256`` que la selección.
- curvas:      cada run tiene ``val_loss`` por época hasta ``stopped_epoch``.
- artefactos:  cada run tiene ``weights.pt``, ``curves.png`` e ``history.json`` (opcional).
- seleccion:   el criterio predeclarado vuelve a elegir el mismo candidato y el mismo orden.
- pesos:       ``weights_sha256`` del candidato = el congelado; con artefactos, también el
               SHA-256 del ``weights.pt`` descargado.
- registry:    el modelo ``clasificador`` tiene una versión del run elegido con alias ``champion``.

Solo lee: no crea runs, no cambia tags y no toca ``selection.json``.

Uso::

    MLFLOW_TRACKING_URI=http://localhost:5000 python -m scripts.verify_mlflow
    python -m scripts.verify_mlflow --no-artifacts   # solo metadatos
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mlflow.exceptions import MlflowException
from mlflow.tracking import MlflowClient

from trainer.sweep import SweepSpec, collect, load_sweep, rank
from trainer.tracking import tracking_uri
from trainer.train import sha256_file

REQUIRED_ARTIFACTS = ("weights.pt", "curves.png", "history.json")


@dataclass
class Check:
    name: str
    ok: bool
    detail: str


def _get_runs(client: MlflowClient, ids: list[str]) -> tuple[dict[str, Any], list[str]]:
    found, missing = {}, []
    for rid in ids:
        try:
            found[rid] = client.get_run(rid)
        except MlflowException:
            missing.append(rid)
    return found, missing


def _ids(values: list[str]) -> str:
    return ", ".join(v[:8] for v in values)


def verify(
    client: MlflowClient,
    selection: dict[str, Any],
    spec: SweepSpec,
    *,
    model_name: str = "clasificador",
    alias: str = "champion",
    check_artifacts: bool = True,
    download_dir: Path | None = None,
) -> list[Check]:
    checks: list[Check] = []
    candidates: list[str] = list(selection["candidates"])
    winner_id: str = selection["run_id"]
    runs, missing = _get_runs(client, candidates)

    checks.append(
        Check(
            "runs",
            not missing,
            f"{len(runs)}/{len(candidates)} runs de selection.json" + (f"; faltan {_ids(missing)}" if missing else ""),
        )
    )

    unfinished = [rid for rid, r in runs.items() if r.info.status != "FINISHED"]
    checks.append(
        Check("finished", not unfinished, "todos FINISHED" if not unfinished else f"no FINISHED: {_ids(unfinished)}")
    )

    sweep = selection["sweep"]
    off_sweep = [rid for rid, r in runs.items() if r.data.tags.get("sweep") != sweep]
    detail = f"tags.sweep={sweep}" if not off_sweep else f"sin sweep={sweep}: {_ids(off_sweep)}"
    checks.append(Check("sweep", not off_sweep, detail))

    manifest = selection["data"]["manifest_sha256"]
    other = [rid for rid, r in runs.items() if r.data.tags.get("manifest_sha256") != manifest]
    checks.append(
        Check(
            "manifest",
            not other,
            f"manifest_sha256 {manifest[:12]}… en todos" if not other else f"otro manifiesto: {_ids(other)}",
        )
    )

    no_curves = []
    for rid, r in runs.items():
        steps = {m.step for m in client.get_metric_history(rid, "val_loss")}
        stopped = int(r.data.metrics.get("stopped_epoch", 0))
        if not steps or (stopped and len(steps) < stopped):
            no_curves.append(rid)
    checks.append(
        Check(
            "curvas",
            not no_curves,
            "val_loss por época en todos" if not no_curves else f"sin curvas completas: {_ids(no_curves)}",
        )
    )

    if check_artifacts:
        lacking = []
        for rid in runs:
            present = {a.path for a in client.list_artifacts(rid)}
            absent = [a for a in REQUIRED_ARTIFACTS if a not in present]
            if absent:
                lacking.append(f"{rid[:8]} sin {absent}")
        checks.append(
            Check(
                "artefactos",
                not lacking,
                f"{', '.join(REQUIRED_ARTIFACTS)} en todos" if not lacking else "; ".join(lacking),
            )
        )

    try:
        rows, _excluded = collect(client, spec)
        ranked = [r.run_id for r in rank(rows, spec)]
        same = ranked == candidates and ranked[:1] == [winner_id]
        detail = (
            f"{spec.mode} {spec.metric} vuelve a elegir {winner_id[:8]} con el mismo orden"
            if same
            else f"el ranking da {_ids(ranked)}; selection.json dice {_ids(candidates)}"
        )
        checks.append(Check("seleccion", same, detail))
    except Exception as exc:  # noqa: BLE001 - se reporta como chequeo fallido
        checks.append(Check("seleccion", False, f"no se pudo rankear: {exc}"))

    frozen = selection["checkpoint"]["sha256"]
    winner = runs.get(winner_id)
    tagged = winner.data.tags.get("weights_sha256") if winner else None
    problems = [] if tagged == frozen else [f"tag weights_sha256={str(tagged)[:12]}…"]
    if check_artifacts and winner is not None:
        with tempfile.TemporaryDirectory(dir=download_dir and _mkdir(download_dir)) as tmp:
            local = Path(client.download_artifacts(winner_id, "weights.pt", tmp))
            downloaded = sha256_file(local)
        if downloaded != frozen:
            problems.append(f"weights.pt descargado={downloaded[:12]}…")
    detail = (
        f"SHA-256 {frozen[:12]}… = congelado" if not problems else f"esperado {frozen[:12]}…; " + ", ".join(problems)
    )
    checks.append(Check("pesos", not problems, detail))

    try:
        version = client.get_model_version_by_alias(model_name, alias)
        ok = version.run_id == winner_id
        detail = f"{model_name} v{version.version} @{alias} → run {version.run_id[:8]}"
    except MlflowException as exc:
        ok, detail = False, f"{model_name}@{alias} no existe ({exc.error_code})"
    checks.append(Check("registry", ok, detail))
    return checks


def _mkdir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m scripts.verify_mlflow", description=__doc__.split("\n")[0])
    parser.add_argument("--selection", type=Path, default=Path("reports/t07/selection.json"))
    parser.add_argument("--spec", type=Path, default=Path("configs/experiments/t07.yaml"))
    parser.add_argument("--model", default="clasificador")
    parser.add_argument("--alias", default="champion")
    parser.add_argument("--no-artifacts", action="store_true", help="no descarga ni lista artefactos")
    args = parser.parse_args(argv)

    selection = json.loads(args.selection.read_text(encoding="utf-8"))
    uri = tracking_uri()
    client = MlflowClient(uri)
    checks = verify(
        client,
        selection,
        load_sweep(args.spec),
        model_name=args.model,
        alias=args.alias,
        check_artifacts=not args.no_artifacts,
    )
    print(f"MLflow: {uri}")
    for c in checks:
        print(f"{'OK   ' if c.ok else 'FALLA'} {c.name:<11s} {c.detail}")
    ok = all(c.ok for c in checks)
    print("Resultado: " + ("OK" if ok else "FALLA"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
