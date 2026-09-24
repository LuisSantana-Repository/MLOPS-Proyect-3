import os
import json
import time
import redis
import mlflow
import torch
import torch.nn as nn

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
queue = redis.Redis(host=REDIS_HOST, port=6379, decode_responses=True)

class SimpleModel(nn.Module):
    def __init__(self):
        super().__init__()
        self.linear = nn.Linear(10, 2)
    def forward(self, x):
        return self.linear(x)

def run_training(job_id, params):
    print(f"Iniciando entrenamiento para el job: {job_id}")
    
    # Aquí se integra tu pipeline de datasets MLOps 
    # (el script que procesa las imágenes de personas, coches y perros vía LoremFlickr)
    print("Cargando dataset de imágenes...")
    
    mlflow.set_experiment("PyTorch_Worker_Jobs")
    
    with mlflow.start_run(run_name=f"job_{job_id}") as run:
        epochs = params.get("epochs", 5)
        learning_rate = params.get("lr", 0.01)
        mlflow.log_param("epochs", epochs)
        mlflow.log_param("learning_rate", learning_rate)
        
        model = SimpleModel()
        criterion = nn.MSELoss()
        optimizer = torch.optim.SGD(model.parameters(), lr=learning_rate)
        
        # Simulación de las iteraciones de entrenamiento
        for epoch in range(epochs):
            inputs = torch.randn(1, 10)
            targets = torch.randn(1, 2)
            
            optimizer.zero_grad()
            outputs = model(inputs)
            loss = criterion(outputs, targets)
            loss.backward()
            optimizer.step()
            
            mlflow.log_metric("loss", loss.item(), step=epoch)
            time.sleep(1) # Simular procesamiento de las imágenes
            
        # Sube el artefacto entrenado directamente a MinIO
        mlflow.pytorch.log_model(model, "model")
        print(f"Job {job_id} completado. Artefactos guardados en MinIO y metadatos en MariaDB.")

if __name__ == "__main__":
    print("Worker iniciado, escuchando la cola 'ml_jobs' en Redis...")
    while True:
        # blpop bloquea la ejecución y espera hasta que exista un trabajo en la cola
        _, message = queue.blpop("ml_jobs")
        try:
            job_data = json.loads(message)
            run_training(job_data.get("id", "unknown"), job_data.get("params", {}))
        except Exception as e:
            print(f"Error crítico procesando el job: {e}")