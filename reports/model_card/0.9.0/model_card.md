# Tarjeta del modelo: clasificador 0.9.0

> Generada por `python -m serving.model_card` desde el paquete publicado en S3, el run de
> MLflow y los artefactos versionados del repo. Ninguna cifra se escribe a mano.

## Propósito y uso previsto

Clasificador multiclase de **un objeto por imagen**: recibe el recorte de una caja COCO y predice su clase entre `person`, `car`. Se usa desde la página **Inference** del portal para sugerir la etiqueta de imágenes nuevas, que después revisa un anotador en la cola de anotación.

**No** está pensado para imágenes completas con varios objetos ni para clases distintas a las listadas: siempre devuelve una de ellas (no tiene opción de rechazo).

## Versión publicada

| Campo | Valor |
|---|---|
| Versión de modelo | `0.9.0` |
| Publicado | 2026-10-03 00:39 UTC (VersionId de weights.pt `Qa0w9SYb96kCuVZ.rsaj2mgJAVZvp1al`) |
| Paquete en S3 | `s3://ml-models-proyecto3-2c1a70d3/models/clasificador/0.9.0` |
| SHA-256 de `weights.pt` | `9091584d7a101146f3d182f1d9ec342e5f451c0cd3948b6c361125303ad3b170` |
| Model Registry de MLflow | `clasificador v2` |

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
- **Run de MLflow:** `7693ef54d0884ebba1fc40348010bf29` (t07-exp-01), commit `9a53bc568d4f6d7fed1c9e90271230466a964e52` con cambios sin commit; el código exacto está en `source/source_diff.patch` del run.
- **Selección (T07):** corrida de comparación (no elegida). El candidato congelado por min `best_val_loss` en val entre 10 corridas fue `fe32e1388dbd465cae714a69bf80f685` (versión `1.0.0`), el 2026-09-28T03:21:04+00:00, antes de abrir el test.

| Hiperparámetro | Valor |
|---|---|
| `optimizer` | adamw |
| `batch_size` | 32 |
| `max_epochs` | 30 |
| `lr` | 0.001 |
| `img_size` | 224 |
| `hidden_layers` | [256] |
| `dropout` | 0.3 |
| `weight_decay` | 0.0 |
| `shuffle_seed` | 42 |
| `aug_seed` | 43 |
| `init_seed` | 44 |
| `monitor` | val_loss |
| `patience` | 5 |
| `min_delta` | 0.001 |

Early stopping por `val_loss`: mejor época **7**, paró en la 12 y se restauraron los pesos de la mejor época (`best_val_loss` 0.0587, `best_val_acc` 97.78 %).

## Desempeño en validación

> Esta versión **no es el modelo campeón**: no se evaluó sobre el conjunto de test congelado, así que **no tiene métricas `test_*`** (solo el ganador de T07 las tiene, para no romper la regla M3). Lo que sigue son métricas de **validación**.

| Métrica (validación) | Valor |
|---|---:|
| best_val_loss | 0.0587 |
| best_val_acc | 97.78 % |

Para comparar contra el campeón, mira su tarjeta (`1.0.0`), que sí reporta test.

## Preprocesamiento exacto

1. Convertir a RGB.
2. Redimensionar a 224×224 px (bilinear, antialias=True), sin recortar.
3. Escalar a [0, 1] (píxel / 255).
4. Normalizar con media [0.485, 0.456, 0.406] y desviación [0.229, 0.224, 0.225] (ImageNet).
5. Tensor NCHW float32; salida: logits → softmax en el orden de `classes.json`.

Es el mismo transform de validación y test; lo reconstruye `trainer.load_model` desde
`preprocess.json`, así que no hay que reimplementarlo.

## Limitaciones y sesgos

- Solo distingue 2 clases; cualquier otro objeto se asignará a una de ellas.
- Sin evaluación en test: su desempeño real está medido solo en validación, que puede ser optimista. No usar esta versión como referencia de calidad final.
- Los datos vienen de un solo release del Proyecto 2 (recortes COCO de fotos similares); el desempeño en fotos de otro dominio, recortes muy pequeños o mal encuadrados no está medido.
- Entrenado y evaluado en CPU; en GPU los resultados pueden variar en los últimos decimales.

## Contenido del paquete

El paquete publicado en `s3://ml-models-proyecto3-2c1a70d3/models/clasificador/0.9.0` contiene:

- `weights.pt` — checkpoint de la mejor época (state_dict + arquitectura + clases)
- `classes.json` — mapa índice→clase
- `preprocess.json` — preprocesamiento determinista de inferencia
- `summary.json` — resumen del run (datos, modelo, métricas de validación)
- `config.json` — configuración efectiva validada del entrenamiento
- `env.json` — versiones de Python y librerías con que se entrenó
- `requirements.lock` — dependencias fijadas (==) derivadas de env.json, para reproducir el entorno

## Procedencia de los recortes

Las cajas de origen (bbox COCO) de cada recorte están en [`data/crops/crops_source_boxes.csv`](data/crops/crops_source_boxes.csv), enlazadas por `ann_id`: para cada recorte, la imagen y la caja de la que salió. Permite auditar que cada entrada del manifiesto corresponde a su objeto en la foto original.

## Cómo descargarlo y cargarlo

```bash
aws s3 cp --recursive s3://ml-models-proyecto3-2c1a70d3/models/clasificador/0.9.0/ ./modelo-0.9.0/
sha256sum ./modelo-0.9.0/weights.pt   # debe ser 9091584d7a101146f3d182f1d9ec342e5f451c0cd3948b6c361125303ad3b170
```

```python
import torch
from PIL import Image
from trainer import load_model

m = load_model("./modelo-0.9.0")   # verifica classes.json y aplica preprocess.json
x = m.transform(Image.open("recorte.jpg").convert("RGB")).unsqueeze(0)
probs = torch.softmax(m.model(x), dim=1)[0]
print(dict(zip(m.classes, probs.tolist())))
```

O con el servicio de inferencia (T10): `curl -F version=0.9.0 -F file=@recorte.jpg http://localhost:8000/predict`. El servicio descarga el paquete de `s3://ml-models-proyecto3-2c1a70d3/models/clasificador/0.9.0` y verifica el SHA-256 antes de cargarlo.
