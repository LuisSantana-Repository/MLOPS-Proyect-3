"""Acceso a la tabla ``published_models`` en MariaDB (T10).

La tabla la crea/versiona Drizzle en el portal; aquí solo insertamos y leemos.
Se llama ``published_models`` (no ``model_versions``) para no chocar con la tabla
interna del mismo nombre del backend store de MLflow.
Se conecta con las variables ``MYSQL_*`` (mismas que usa el portal). En el worker
el host es ``db`` y el puerto ``3306``; desde el host de desarrollo, ``127.0.0.1:3307``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import pymysql


class DBError(RuntimeError):
    """No se pudo conectar o escribir en MariaDB."""


@dataclass
class DBSettings:
    host: str
    port: int
    user: str
    password: str
    database: str

    @classmethod
    def from_env(cls) -> DBSettings:
        return cls(
            host=os.environ.get("MYSQL_HOST", "127.0.0.1"),
            port=int(os.environ.get("MYSQL_PORT", "3307")),
            user=os.environ.get("MYSQL_USER", "mlflow_user"),
            password=os.environ.get("MYSQL_PASSWORD", "mlflow_password"),
            database=os.environ.get("MYSQL_DATABASE", "mlflow_db"),
        )


def connect(settings: DBSettings | None = None) -> pymysql.connections.Connection:
    settings = settings or DBSettings.from_env()
    try:
        return pymysql.connect(
            host=settings.host,
            port=settings.port,
            user=settings.user,
            password=settings.password,
            database=settings.database,
            autocommit=True,
            cursorclass=pymysql.cursors.DictCursor,
        )
    except pymysql.MySQLError as exc:
        raise DBError(
            f"no se pudo conectar a MariaDB en {settings.host}:{settings.port}/{settings.database}: {exc}"
        ) from exc


def insert_model_version(
    conn: pymysql.connections.Connection,
    *,
    version: str,
    name: str,
    run_id: str,
    dvc_release: str | None,
    s3_key: str,
    sha256: str,
) -> None:
    """Inserta (o reemplaza) la fila de una versión de modelo.

    Usa REPLACE para que re-publicar la misma versión sea idempotente.
    """
    # Upsert que preserva created_at al re-publicar la misma versión (a diferencia
    # de REPLACE, que borraría la fila y regeneraría la fecha de creación).
    sql = (
        "INSERT INTO published_models (version, name, run_id, dvc_release, s3_key, sha256) "
        "VALUES (%s, %s, %s, %s, %s, %s) "
        "ON DUPLICATE KEY UPDATE "
        "name = VALUES(name), run_id = VALUES(run_id), dvc_release = VALUES(dvc_release), "
        "s3_key = VALUES(s3_key), sha256 = VALUES(sha256)"
    )
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (version, name, run_id, dvc_release, s3_key, sha256))
    except pymysql.MySQLError as exc:
        raise DBError(f"no se pudo insertar la versión {version} en published_models: {exc}") from exc


def get_model_version(conn: pymysql.connections.Connection, version: str, name: str = "clasificador") -> dict | None:
    """Lee una fila de published_models por versión (y nombre)."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM published_models WHERE version = %s AND name = %s",
                (version, name),
            )
            return cur.fetchone()
    except pymysql.MySQLError as exc:
        raise DBError(f"no se pudo leer la versión {version}: {exc}") from exc
