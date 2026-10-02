"""Respaldo local (solo lectura) de los objetos bajo ``models/`` del bucket de S3.

Baja cada objeto a ``backups/s3-models-<fecha>/`` y escribe un ``manifest.json`` con,
por objeto: llave, tamaño, ETag, VersionId (si el bucket tiene versionado) y el SHA-256
calculado del contenido descargado. Sirve de red de seguridad antes de publicar versiones
nuevas: si algo falla en AWS, el paquete (p. ej. ``1.0.0``) se puede restaurar y los hashes
siguen verificables.

NO modifica ni borra nada en S3. Usa las credenciales del entorno (las mismas que
``serving.storage.S3Settings.from_env``). Con ``--use-minio`` respalda desde MinIO.

Uso:
    python scripts/backup_s3_models.py              # respalda models/ del bucket AWS real
    python scripts/backup_s3_models.py --prefix models/clasificador/1.0.0/
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

# Permite ejecutar el script directamente (python scripts/backup_s3_models.py)
# añadiendo la raíz del repo al path para importar el paquete serving.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from serving import storage  # noqa: E402
from serving.storage import S3Settings, StorageError  # noqa: E402


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def backup(prefix: str, dest_root: Path, settings: S3Settings) -> dict:
    client = storage.make_s3_client(settings)
    paginator = client.get_paginator("list_objects_v2")
    keys: list[str] = []
    for page in paginator.paginate(Bucket=settings.bucket, Prefix=prefix):
        keys.extend(obj["Key"] for obj in page.get("Contents", []))
    if not keys:
        raise StorageError(f"no hay objetos bajo s3://{settings.bucket}/{prefix}")

    dest_root.mkdir(parents=True, exist_ok=True)
    entries = []
    for key in keys:
        local_path = dest_root / key
        local_path.parent.mkdir(parents=True, exist_ok=True)
        client.download_file(settings.bucket, key, str(local_path))
        head = client.head_object(Bucket=settings.bucket, Key=key)
        entries.append(
            {
                "key": key,
                "size": head["ContentLength"],
                "etag": head["ETag"].strip('"'),
                "version_id": head.get("VersionId"),
                "sha256": _sha256(local_path),
                "last_modified": head["LastModified"].astimezone(UTC).isoformat(),
            }
        )
        print(f"  OK {key}  ({head['ContentLength']} bytes)")

    manifest = {
        "bucket": settings.bucket,
        "prefix": prefix,
        "endpoint_url": settings.endpoint_url,
        "backed_up_at": datetime.now(UTC).isoformat(),
        "object_count": len(entries),
        "objects": entries,
    }
    (dest_root / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python scripts/backup_s3_models.py", description=__doc__.split("\n")[0])
    parser.add_argument("--prefix", default="models/", help="prefijo S3 a respaldar (default: models/)")
    parser.add_argument("--out", type=Path, help="carpeta destino (default: backups/s3-models-<fecha>)")
    parser.add_argument("--use-minio", action="store_true", help="respalda desde MinIO en vez de AWS")
    args = parser.parse_args(argv)

    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    dest = args.out or Path("backups") / f"s3-models-{stamp}"
    try:
        settings = S3Settings.from_env(use_minio=args.use_minio)
        print(f"respaldando s3://{settings.bucket}/{args.prefix} -> {dest}")
        manifest = backup(args.prefix, dest, settings)
    except StorageError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"\nrespaldo completo: {manifest['object_count']} objetos en {dest}")
    print(f"manifiesto con VersionId y SHA-256 en {dest / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
