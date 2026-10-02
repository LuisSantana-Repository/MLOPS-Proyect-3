"""Snapshot del MLflow del barrido en ``mlflow-store/`` para versionarlo con DVC (P0-1).

Las 10 corridas de T07, el run elegido y el Model Registry vivían solo en el MariaDB y
el MinIO locales de la máquina que corrió el barrido. Este script los copia, sin
reentrenar ni reescribir nada, a una carpeta que se versiona con DVC en el remoto S3
del proyecto:

- ``mlflow-store/mlflow.db``: backend store en SQLite, copiado fila por fila desde el
  MariaDB del stack (mismos run IDs, métricas por época, tags, URIs de artefactos y
  versiones/alias del registro). Se crea con el esquema de la misma versión de MLflow y
  se exige la misma revisión de alembic que el origen.
- ``mlflow-store/artifacts/``: espejo byte a byte del bucket ``mlflow`` de MinIO
  (``<experimento>/<run>/artifacts/...``). Al arrancar el stack, ``createbuckets`` lo
  vuelve a cargar en MinIO, así que las URIs ``s3://mlflow/...`` originales siguen
  resolviendo sin tocarlas.

Uso (dentro de la red del stack, ver ``scripts/mlflow_snapshot.sh``)::

    python -m scripts.mlflow_snapshot db --src "mysql+pymysql://..." --dst mlflow-store/mlflow.db
    python -m scripts.mlflow_snapshot artifacts --bucket mlflow --dst mlflow-store/artifacts
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

import sqlalchemy as sa

ALEMBIC_TABLE = "alembic_version"


def _mlflow_tables(engine: sa.Engine) -> list[sa.Table]:
    """Tablas del esquema de MLflow en orden de dependencias (padres antes que hijos)."""
    meta = sa.MetaData()
    meta.reflect(engine)
    return [t for t in meta.sorted_tables if t.name != ALEMBIC_TABLE]


def _revision(conn: sa.Connection) -> str | None:
    return conn.execute(sa.text(f"SELECT version_num FROM {ALEMBIC_TABLE}")).scalar()


def table_counts(uri: str) -> dict[str, int]:
    engine = sa.create_engine(uri)
    try:
        with engine.connect() as conn:
            return {
                t.name: conn.execute(sa.select(sa.func.count()).select_from(t)).scalar_one()
                for t in _mlflow_tables(engine)
            }
    finally:
        engine.dispose()


def copy_tracking_store(src_uri: str, dst: Path, *, batch_size: int = 5_000) -> dict[str, int]:
    """Copia todas las tablas de MLflow de ``src_uri`` a un SQLite nuevo en ``dst``.

    Devuelve las filas copiadas por tabla. Nunca sobrescribe un store existente.
    """
    from mlflow.store.db.utils import _initialize_tables

    if dst.exists():
        raise FileExistsError(f"{dst} ya existe; bórralo a mano si de verdad quieres regenerarlo")
    dst.parent.mkdir(parents=True, exist_ok=True)

    src_engine = sa.create_engine(src_uri)
    dst_engine = sa.create_engine(f"sqlite:///{dst.as_posix()}")
    try:
        _initialize_tables(dst_engine)  # esquema vacío de esta versión de MLflow, sin filas
        with src_engine.connect() as src, dst_engine.begin() as out:
            if _revision(src) != _revision(out):
                raise RuntimeError(
                    f"el origen está en la revisión {_revision(src)} y el destino en {_revision(out)}; "
                    "usa la misma versión de MLflow que el servidor (Dockerfile.mlflow)"
                )
            src_tables = {t.name: t for t in _mlflow_tables(src_engine)}
            counts: dict[str, int] = {}
            for table in _mlflow_tables(dst_engine):
                origin = src_tables.get(table.name)
                if origin is None:
                    raise RuntimeError(f"el origen no tiene la tabla {table.name}")
                columns = [c.name for c in table.columns]
                copied = 0
                # Columnas sin tipo: el valor llega tal cual del driver. Con los tipos reflejados,
                # DOUBLE de MariaDB se convierte a Decimal redondeado a 10 dígitos y las métricas
                # pierden precisión.
                query = sa.select(*(sa.column(c) for c in columns)).select_from(sa.table(origin.name))
                result = src.execution_options(stream_results=True).execute(query)
                while rows := result.fetchmany(batch_size):
                    out.execute(table.insert(), [dict(zip(columns, row, strict=True)) for row in rows])
                    copied += len(rows)
                counts[table.name] = copied
        return counts
    except BaseException:
        dst_engine.dispose()
        dst.unlink(missing_ok=True)  # nunca dejar un store a medias
        raise
    finally:
        src_engine.dispose()
        dst_engine.dispose()


def mirror_bucket(s3: Any, bucket: str, dest: Path) -> int:
    """Baja cada objeto de ``bucket`` a ``dest/<key>``; salta los que ya están con el mismo tamaño."""
    copied = 0
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket):
        for obj in page.get("Contents", []):
            target = dest / obj["Key"]
            if target.is_file() and target.stat().st_size == obj["Size"]:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            s3.download_file(bucket, obj["Key"], str(target))
            copied += 1
    return copied


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m scripts.mlflow_snapshot", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    db_p = sub.add_parser("db", help="copia el backend store a SQLite")
    db_p.add_argument("--src", required=True, help="URI SQLAlchemy del backend actual (p. ej. mysql+pymysql://...)")
    db_p.add_argument("--dst", type=Path, default=Path("mlflow-store/mlflow.db"))
    art_p = sub.add_parser("artifacts", help="espejo del bucket de artefactos")
    art_p.add_argument("--bucket", default=os.environ.get("MLFLOW_BUCKET_NAME", "mlflow"))
    art_p.add_argument("--dst", type=Path, default=Path("mlflow-store/artifacts"))
    art_p.add_argument("--endpoint-url", default=os.environ.get("MLFLOW_S3_ENDPOINT_URL"))
    args = parser.parse_args(argv)

    if args.command == "db":
        try:
            counts = copy_tracking_store(args.src, args.dst)
        except (FileExistsError, RuntimeError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        for name, n in counts.items():
            print(f"{name:32s} {n:>8d}")
        return 0

    import boto3

    s3 = boto3.client("s3", endpoint_url=args.endpoint_url)
    copied = mirror_bucket(s3, args.bucket, args.dst)
    print(f"{copied} objetos nuevos en {args.dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
