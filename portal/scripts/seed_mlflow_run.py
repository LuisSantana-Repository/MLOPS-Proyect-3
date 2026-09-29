"""Crea un run de prueba en MLflow siguiendo el contrato de tracking.py (T06),
para el smoke test de los endpoints de T09. Solo para pruebas locales.

Uso: python portal/scripts/seed_mlflow_run.py
"""

import json
import os

import mlflow
from mlflow.tracking import MlflowClient

TRACKING_URI = os.environ.get("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000")
EXPERIMENT = "proyecto3-clasificador"
MODEL_NAME = "clasificador-recortes"

mlflow.set_tracking_uri(TRACKING_URI)
mlflow.set_experiment(EXPERIMENT)

with mlflow.start_run(run_name="smoke-t09") as run:
    run_id = run.info.run_id
    mlflow.log_params(
        {
            "optimizer": "adamw",
            "batch_size": "32",
            "max_epochs": "5",
            "lr": "0.001",
            "img_size": "224",
            "hidden_layers": json.dumps([256]),
            "dropout": "0.3",
        }
    )
    # Curvas por época (contrato: train_loss / val_loss por step=época).
    for epoch, (tl, vl, ta, va) in enumerate(
        [(0.9, 0.95, 0.5, 0.48), (0.6, 0.7, 0.7, 0.66), (0.4, 0.55, 0.82, 0.78),
         (0.3, 0.5, 0.88, 0.83), (0.25, 0.52, 0.9, 0.82)]
    ):
        mlflow.log_metrics(
            {"train_loss": tl, "val_loss": vl, "train_acc": ta, "val_acc": va}, step=epoch
        )
    # Métricas finales (mejor época = 3, val_loss 0.5) + métricas de evaluación (test_*).
    mlflow.log_metrics(
        {
            "best_val_loss": 0.5,
            "best_val_acc": 0.83,
            "best_epoch": 3,
            "duration_seconds": 42.0,
            "test_accuracy": 0.81,
            "test_macro_f1": 0.79,
            "test_loss": 0.53,
        }
    )
    mlflow.set_tags(
        {
            "dvc_release": "proyecto2 v1.1.0@dc9376e",
            "weights_sha256": "abc123def456",
            "classes": json.dumps(["person", "car"]),
            "confusion_matrix": json.dumps([[40, 5], [7, 38]]),
            # Tag de selección T07 para probar el filtro de /api/experiments.
            "sweep": "t07",
        }
    )

print(f"RUN_ID={run_id}")

# Registra una versión de modelo apuntando al run (Model Registry).
client = MlflowClient(TRACKING_URI)
try:
    client.create_registered_model(MODEL_NAME)
except Exception:
    pass  # ya existe
source = f"{run.info.artifact_uri}/model"
mv = client.create_model_version(name=MODEL_NAME, source=source, run_id=run_id)
print(f"MODEL={MODEL_NAME} VERSION={mv.version}")
