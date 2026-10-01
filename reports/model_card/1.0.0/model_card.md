# Tarjeta del modelo: clasificador 1.0.0

> Generada por `python -m serving.model_card` desde el paquete publicado en S3, el run de
> MLflow y los artefactos versionados del repo. Ninguna cifra se escribe a mano.

## Propósito y uso previsto

Clasificador multiclase de **un objeto por imagen**: recibe el recorte de una caja COCO y predice su clase entre `person`, `car`. Se usa desde la página **Inference** del portal para sugerir la etiqueta de imágenes nuevas, que después revisa un anotador en la cola de anotación.

**No** está pensado para imágenes completas con varios objetos ni para clases distintas a las listadas: siempre devuelve una de ellas (no tiene opción de rechazo).

## Versión publicada

| Campo | Valor |
|---|---|
| Versión de modelo | `1.0.0` |
| Publicado | 2026-10-01 05:44 UTC (VersionId de weights.pt `IYKTZQHILzQGwcKwU0ZzZmr_92pF_UpC`) |
| Paquete en S3 | `s3://ml-models-proyecto3-2c1a70d3/models/clasificador/1.0.0` |
| SHA-256 de `weights.pt` | `e5aa4f73e607bf593eade2cc9c0194e468a425613aea8042f155c4a3e82af630` |
| Model Registry de MLflow | `clasificador v1` |

## Datos de origen

- **Release DVC del Proyecto 2:** `proyecto2 v1.1.0@dc9376e` (md5 de anotaciones `72e5f4025c4dbe7eb1e2420a9b4dbf9a`).
- **Recortes (T03):** una muestra por caja COCO válida; se descartaron 6 cajas (área menor a 1024 px²). Recortes versionados en DVC con md5 `f839dd62b048da0186ade1e382bb7f66.dir`.
- **Clases incluidas:** las que tienen al menos 300 imágenes originales. Excluidas: `dog`: 71 imágenes con caja válida (< 300).
- **Manifiesto 70/20/10 (T04):** SHA-256 `0bdfd6d7efd40f17903df10695b3e34177d535071b76ac0c5404a215428ed578`, md5 DVC `e75a07ce3b75455514f044b23e0d1b29`, semilla 42. Agrupado por imagen original y duplicados cercanos (pHash): **fuga = 0**. Huella del test `2da093177e6ad54ec90b91a472b3f43e15d32b143abd0bff87e908e55a7e5fe8`.

| Clase | Train | Val | Test |
|---|---:|---:|---:|
| person | 569 | 162 | 81 |
| car | 375 | 108 | 54 |

## Modelo y entrenamiento

- **Arquitectura:** resnet18 con cabeza MLP propia (capas ocultas [256], dropout 0.3, 2 salidas).
- **Pesos iniciales:** torchvision.models.ResNet18_Weights.IMAGENET1K_V1 (ImageNet-1k); capas entrenables del backbone: `layer4`; 8525570 de 11308354 parámetros entrenables.
- **Run de MLflow:** `fe32e1388dbd465cae714a69bf80f685` (t07-exp-07), commit `9a53bc568d4f6d7fed1c9e90271230466a964e52` con cambios sin commit; el código exacto está en `source/source_diff.patch` del run.
- **Selección (T07):** candidato elegido por min `best_val_loss` en val entre 10 corridas, congelado el 2026-09-28T03:21:04+00:00, antes de abrir el test.

| Hiperparámetro | Valor |
|---|---|
| `optimizer` | adamw |
| `batch_size` | 32 |
| `max_epochs` | 30 |
| `lr` | 0.001 |
| `img_size` | 160 |
| `hidden_layers` | [256] |
| `dropout` | 0.3 |
| `weight_decay` | 0.0 |
| `shuffle_seed` | 42 |
| `aug_seed` | 43 |
| `init_seed` | 44 |
| `monitor` | val_loss |
| `patience` | 5 |
| `min_delta` | 0.001 |

Early stopping por `val_loss`: mejor época **10**, paró en la 15 y se restauraron los pesos de la mejor época (`best_val_loss` 0.0463, `best_val_acc` 97.78 %).

## Desempeño en test

Evaluación única (T08) sobre el 10 % de test congelado (135 recortes), el 2026-09-30T21:17:09+00:00.

| Métrica | Valor |
|---|---:|
| Accuracy top-1 | **94.81 %** (128/135); IC 95 % 89.7 %–97.5 % |
| Meta ≥ 85 % | cumple |
| F1 macro | 94.58 % |
| Baseline (siempre `person`) | 60.00 % |

| Clase | Precisión | Recall | F1 | Soporte |
|---|---:|---:|---:|---:|
| person | 0.9512 | 0.9630 | 0.9571 | 81 |
| car | 0.9434 | 0.9259 | 0.9346 | 54 |

Matriz de confusión (filas = clase real, columnas = predicha):

| Real \ Predicha | person | car |
|---|---:|---:|
| person | 78 | 3 |
| car | 4 | 50 |

## Preprocesamiento exacto

1. Convertir a RGB.
2. Redimensionar a 160×160 px (bilinear, antialias=True), sin recortar.
3. Escalar a [0, 1] (píxel / 255).
4. Normalizar con media [0.485, 0.456, 0.406] y desviación [0.229, 0.224, 0.225] (ImageNet).
5. Tensor NCHW float32; salida: logits → softmax en el orden de `classes.json`.

Es el mismo transform de validación y test; lo reconstruye `trainer.load_model` desde
`preprocess.json`, así que no hay que reimplementarlo.

## Limitaciones y sesgos

- Solo distingue 2 clases; cualquier otro objeto se asignará a una de ellas.
- La clase con menor recall es `car` (92.59 %); la confusión más frecuente es `car` → `person` (4 casos).
- El test tiene solo 135 recortes: el intervalo de confianza de la accuracy es amplio (89.7 %–97.5 %).
- Las clases están desbalanceadas (baseline 60.00 %); por eso se reporta F1 macro y recall por clase.
- Los datos vienen de un solo release del Proyecto 2 (recortes COCO de fotos similares); el desempeño en fotos de otro dominio, recortes muy pequeños o mal encuadrados no está medido.
- Entrenado y evaluado en CPU; en GPU los resultados pueden variar en los últimos decimales.

## Cómo descargarlo y cargarlo

```bash
aws s3 cp --recursive s3://ml-models-proyecto3-2c1a70d3/models/clasificador/1.0.0/ ./modelo-1.0.0/
sha256sum ./modelo-1.0.0/weights.pt   # debe ser e5aa4f73e607bf593eade2cc9c0194e468a425613aea8042f155c4a3e82af630
```

```python
import torch
from PIL import Image
from trainer import load_model

m = load_model("./modelo-1.0.0")   # verifica classes.json y aplica preprocess.json
x = m.transform(Image.open("recorte.jpg").convert("RGB")).unsqueeze(0)
probs = torch.softmax(m.model(x), dim=1)[0]
print(dict(zip(m.classes, probs.tolist())))
```

O con el servicio de inferencia (T10): `curl -F version=1.0.0 -F file=@recorte.jpg http://localhost:8000/predict`. El servicio descarga el paquete de `s3://ml-models-proyecto3-2c1a70d3/models/clasificador/1.0.0` y verifica el SHA-256 antes de cargarlo.
