# Publicación e inferencia del modelo (T10)

Versiona el paquete del run ganador, lo sube a S3 y lo registra; expone un
servicio de inferencia que descarga de S3, verifica el hash y clasifica imágenes.

## Componentes

- `serving/storage.py` — cliente S3 (boto3) parametrizable (AWS real o MinIO),
  versionado semántico, SHA-256 y layout `models/clasificador/<version>/`.
- `serving/publish.py` + `publish_model.py` (CLI) — publican el run ganador.
- `serving/inference.py` — `ModelCache`: descarga con caché, verifica hash y carga
  con `trainer.load_model` (respeta el `img_size` de `preprocess.json`, p. ej. 160).
- `serving/app.py` — servicio FastAPI con `POST /predict`.
- `serving/db.py` — inserta/lee la tabla `published_models` en MariaDB.

> La tabla se llama `published_models` (no `model_versions`) porque el backend
> store de MLflow ya usa una tabla `model_versions` en la misma base de datos.

## Dos almacenes S3

- **MinIO** (`s3://mlflow/...`): artifact store de MLflow, de donde se **descargan**
  los artefactos del run ganador.
- **AWS S3 real** (`S3_BUCKET`, prefijo `models/`): a donde se **suben** los modelos
  publicados. Credenciales dedicadas `MODELS_AWS_*` (o `AWS_*` como fallback).

Para pruebas locales sin AWS, `MODELS_S3_USE_MINIO=1` publica/lee contra MinIO.

## Publicar el run ganador

```bash
# Instala dependencias del servicio (torch, mlflow-skinny, boto3, fastapi, pymysql...)
pip install -r requirements-serving.txt --extra-index-url https://download.pytorch.org/whl/cpu

# Publica el run de reports/t07/selection.json al bucket AWS real
python publish_model.py

# O un run explícito con versión fija
python publish_model.py --run-id fe32e1388dbd465cae714a69bf80f685 --version 1.0.0

# Probar contra MinIO en vez de AWS
MODELS_S3_USE_MINIO=1 python publish_model.py --run-id <run> --no-registry
```

Verifica el SHA-256 de `weights.pt` contra el tag `weights_sha256`/`selection.json`,
sube el paquete, registra la versión en el Model Registry y en `published_models`.

## Servicio de inferencia

```bash
uvicorn serving.app:app --host 0.0.0.0 --port 8000
# En el stack: docker compose up -d inference  (puerto 8000)

curl -F "version=1.0.0" -F "file=@recorte.jpg" http://localhost:8000/predict
```

Respuesta:

```json
{
  "version": "1.0.0",
  "predicted_class": "car",
  "probabilities": { "person": 0.08, "car": 0.92 }
}
```

## Tests

```bash
pytest tests/serving
```

Cubren versionado/hash, publicación (S3 simulado con moto), el servicio HTTP y la
prueba principal: descargar el paquete en un directorio limpio y predecir.
