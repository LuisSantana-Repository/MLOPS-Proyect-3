import os
import subprocess
import time

import mlflow

# Leer credenciales estrictamente del entorno, sin valores por defecto
os.environ["AWS_ACCESS_KEY_ID"] = os.environ["MINIO_ROOT_USER"]
os.environ["AWS_SECRET_ACCESS_KEY"] = os.environ["MINIO_ROOT_PASSWORD"]

# Configuración para que el script acceda al entorno local
os.environ["MLFLOW_TRACKING_URI"] = "http://localhost:5000"
os.environ["MLFLOW_S3_ENDPOINT_URL"] = "http://localhost:9000"


def test_persistence():
    print("1. Creando un Run de prueba en MLflow...")
    mlflow.set_experiment("SmokeTest")

    with mlflow.start_run():
        # Solución Ruff: Se obtiene el run_id sin dejar variables sin usar
        run_id = mlflow.active_run().info.run_id
        mlflow.log_param("test_param", "12345")

        with open("dummy_artifact.txt", "w") as f:
            f.write("¡La persistencia en MinIO funciona perfectamente!")
        mlflow.log_artifact("dummy_artifact.txt")

    print(f"Run ID creado exitosamente: {run_id}")

    print("2. Tumbando y reiniciando contenedores para probar persistencia...")
    subprocess.run(["docker", "compose", "down"], check=True)
    time.sleep(3)
    subprocess.run(["docker", "compose", "up", "-d"], check=True)

    print("Esperando a que la BD y MLflow vuelvan a estar listos (20s)...")
    time.sleep(20)

    print("3. Verificando persistencia de MariaDB (Metadatos) y MinIO (S3)...")
    client = mlflow.tracking.MlflowClient()

    # Comprobar MariaDB
    fetched_run = client.get_run(run_id)
    assert fetched_run.data.params["test_param"] == "12345", "Error DB"
    print("✓ Persistencia en MariaDB confirmada.")

    # Comprobar MinIO
    artifacts = client.list_artifacts(run_id)
    assert len(artifacts) > 0, "Error: Artefacto no encontrado en S3/MinIO."
    assert artifacts[0].path == "dummy_artifact.txt", "Error nombre artefacto."
    print("✓ Persistencia en MinIO (S3) confirmada.")

    print("\n¡Smoke Test superado! Infraestructura lista para producción.")


if __name__ == "__main__":
    test_persistence()
