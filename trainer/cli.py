"""CLI: ``python -m trainer --config configs/baseline.yaml`` o ``python -m trainer --smoke``."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from pydantic import ValidationError

from trainer.config import TrainConfig, export_json_schema, load_config
from trainer.data import DataError
from trainer.synthetic import make_synthetic_dataset
from trainer.train import train

SMOKE_EPOCHS = 2
SMOKE_SAMPLES_PER_CLASS = 8


def smoke_config(output_dir: Path) -> TrainConfig:
    """Config sin datos reales ni descarga de pesos: dataset sintético y 2 épocas."""
    manifest, classes = make_synthetic_dataset(output_dir.parent / f"{output_dir.name}_data")
    return TrainConfig(
        manifest_path=manifest,
        classes_path=classes,
        output_dir=output_dir,
        optimizer="adam",
        batch_size=8,
        max_epochs=SMOKE_EPOCHS,
        lr=1e-3,
        img_size=64,
        hidden_layers=[32],
        dropout=0.1,
        pretrained=False,
        trainable_backbone="all",
        patience=SMOKE_EPOCHS,
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m trainer", description=__doc__)
    parser.add_argument("--config", type=Path, help="config YAML/JSON validada por TrainConfig")
    parser.add_argument("--output-dir", type=Path, help="sobrescribe output_dir de la config")
    parser.add_argument(
        "--smoke",
        action="store_true",
        help=f"{SMOKE_EPOCHS} épocas con pocos datos; sin --config usa un dataset sintético",
    )
    parser.add_argument("--overwrite", action="store_true", help="permite reemplazar un paquete existente")
    parser.add_argument("--export-schema", type=Path, metavar="PATH", help="escribe el JSON Schema y termina")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.export_schema:
        export_json_schema(args.export_schema)
        print(f"JSON Schema escrito en {args.export_schema}")
        return 0

    try:
        if args.config is None:
            if not args.smoke:
                print("error: indica --config o usa --smoke", file=sys.stderr)
                return 2
            cfg = smoke_config(args.output_dir or Path("runs/smoke"))
        else:
            overrides = {}
            if args.output_dir:
                overrides["output_dir"] = str(args.output_dir)
            if args.smoke:
                overrides |= {"max_epochs": SMOKE_EPOCHS, "max_samples_per_class": SMOKE_SAMPLES_PER_CLASS}
            cfg = load_config(args.config, overrides)
        result = train(cfg, overwrite=args.overwrite or (args.smoke and args.config is None))
    except ValidationError as exc:
        print(f"config inválida:\n{exc}", file=sys.stderr)
        return 2
    except (DataError, FileExistsError, FileNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(
        f"listo: mejor época {result.best_epoch} ({cfg.monitor}={result.best_value:.4f}), "
        f"paró en la época {result.stopped_epoch} por {result.stop_reason}; paquete en {result.output_dir}"
    )
    return 0
