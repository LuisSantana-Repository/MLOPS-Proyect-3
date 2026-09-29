"""CLI para publicar el run ganador como versión de modelo en S3 (T10).

Ejemplos:
    # Usa reports/t07/selection.json y sube al bucket AWS real (S3_BUCKET)
    python publish_model.py

    # Run explícito y versión fija
    python publish_model.py --run-id fe32e138... --version 1.0.0

    # Prueba contra MinIO local en vez de AWS
    MODELS_S3_USE_MINIO=1 python publish_model.py --run-id <run>
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from serving.db import DBError
from serving.publish import SELECTION_DEFAULT, publish
from serving.storage import S3Settings, StorageError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="publish_model.py", description=__doc__)
    parser.add_argument("--run-id", help="run ganador; por defecto se lee de reports/t07/selection.json")
    parser.add_argument("--selection", type=Path, default=SELECTION_DEFAULT, help="ruta del selection.json de T07")
    parser.add_argument("--version", help="versión semántica explícita (p. ej. 1.0.0); por defecto autoincrementa")
    parser.add_argument("--bump", choices=["major", "minor", "patch"], default="minor", help="tipo de incremento")
    parser.add_argument("--tracking-uri", help="MLflow tracking URI (por defecto el del entorno)")
    parser.add_argument("--use-minio", action="store_true", help="sube a MinIO en vez de AWS S3 (pruebas)")
    parser.add_argument("--no-db", action="store_true", help="no escribir en la tabla published_models")
    parser.add_argument("--no-registry", action="store_true", help="no registrar en el Model Registry de MLflow")
    parser.add_argument("--overwrite", action="store_true", help="reemplaza la versión si ya existe en S3")

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    try:
        s3_settings = S3Settings.from_env(use_minio=args.use_minio)
        package = publish(
            run_id=args.run_id,
            selection_path=args.selection,
            bump=args.bump,
            version=args.version,
            tracking_uri=args.tracking_uri,
            s3_settings=s3_settings,
            write_db=not args.no_db,
            register_mlflow=not args.no_registry,
            overwrite=args.overwrite,
        )
    except (StorageError, DBError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(
        f"publicado {package.name} v{package.version}\n"
        f"  s3:      {package.s3_uri}\n"
        f"  s3_key:  {package.s3_key}\n"
        f"  run_id:  {package.run_id}\n"
        f"  sha256:  {package.sha256}\n"
        f"  release: {package.dvc_release}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
