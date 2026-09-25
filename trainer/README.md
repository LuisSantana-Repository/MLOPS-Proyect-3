# Entrenador del clasificador de recortes (T05)

ResNet18 (torchvision) con cabeza MLP propia, entrenada por minibatches sobre los
recortes del manifiesto 70/20/10. Solo usa `train` y `val`: las filas `split=test`
se descartan al leer el manifiesto y nunca se abren.

## Instalación

```bash
py -3.11 -m venv .venv
.venv/Scripts/python -m pip install -r requirements-trainer.txt --extra-index-url https://download.pytorch.org/whl/cpu
```

## Uso

```bash
# Corrida corta sin datos reales ni internet: dataset sintético, 2 épocas
python -m trainer --smoke

# Corrida con config validada
python -m trainer --config configs/baseline.yaml

# Misma config en modo humo: 2 épocas y 8 recortes por clase y split
python -m trainer --config configs/baseline.yaml --smoke

# Pruebas y lint
python -m pytest
ruff check . && ruff format --check .
```

Desde Python (worker y T06):

```python
from trainer import load_config, train

cfg = load_config("configs/baseline.yaml", {"output_dir": "runs/job-123"})
result = train(cfg, on_epoch_end=lambda row: print(row))  # row = métricas de la época
```

`on_epoch_end` recibe cada fila de `history.json` apenas termina la época; ahí se
conectan `mlflow.log_metrics(..., step=row["epoch"])` (T06) y el progreso del job (T09).

## Configuración

Esquema en [`trainer/config.py`](config.py); JSON Schema exportado en
[`configs/train-config.schema.json`](../configs/train-config.schema.json) para
replicar nombres y límites en Zod (T09/T11). Campos desconocidos se rechazan.

| Campo | Valores | Default |
|---|---|---|
| `optimizer` | `sgd` · `adam` · `adamw` | `adamw` |
| `batch_size` | 1–1024 | 32 |
| `max_epochs` | 1–500 | 30 |
| `lr` | (0, 1] | 0.001 |
| `img_size` | 32–512 | 224 |
| `hidden_layers` | lista de 0–4 enteros 1–4096 | `[256]` |
| `dropout` | [0, 1) | 0.3 |
| `shuffle_seed` · `aug_seed` · `init_seed` | 0–2³²−1 | 42 · 43 · 44 |
| `monitor` | `val_loss` (min) · `val_acc` (max) | `val_loss` |
| `patience` | 1–100 | 5 |
| `min_delta` | ≥ 0 | 0.0 |
| `pretrained` | pesos `ResNet18_Weights.IMAGENET1K_V1` | `true` |
| `trainable_backbone` | `none` (solo cabeza) · `layer4` · `all` | `none` |

Secundarios: `momentum` (solo sgd), `weight_decay`, `device`, `num_workers`,
`deterministic`, `max_samples_per_class`, `data_root`.

## Contrato de entrada

- `manifest.csv` (T04) con al menos `crop_path`, `category_name`, `split`
  (`train`/`val`/`test`); columnas extra (`ann_id`, `image_id`, `group_id`…) se conservan.
  `crop_path` relativo a `data_root` o, si no se indica, a la carpeta del manifiesto.
- `classes.json` (T03): `{"0": "clase", ...}`. Define orden e índices; las filas de
  otras clases se excluyen y se reportan en `summary.json`.

## Paquete de salida (`output_dir`)

| Archivo | Contenido |
|---|---|
| `weights.pt` | Checkpoint de la **mejor época**: `state_dict`, `arch`, `classes`, `best_epoch`, origen de pesos |
| `classes.json` | Mapa índice→clase usado |
| `preprocess.json` | Resize, normalización y formato de entrada de val/test/inferencia |
| `history.json` | Por época: `train_loss`, `train_acc`, `val_loss`, `val_acc`, pasos del optimizador, hash del orden de muestras |
| `config.json` | Config efectiva |
| `env.json` | Versiones de Python/librerías, dispositivo y ajustes de determinismo |
| `summary.json` | Mejor época, época y motivo de parada, verificación de restauración, conteos por clase y split, SHA-256 del manifiesto |

Para evaluar (T08) o inferir (T10) usa el mismo cargador; no descarga pesos de internet:

```python
from trainer import load_model

m = load_model("runs/baseline")  # m.model en eval, m.classes, m.transform
probs = m.model(m.transform(img).unsqueeze(0)).softmax(dim=1)
```

## Reproducibilidad

- `shuffle_seed` siembra el `torch.Generator` del DataLoader de train.
- `aug_seed` siembra cada transform aleatorio por (muestra, época), independiente
  del shuffle y del número de workers.
- `init_seed` inicializa la cabeza (y el backbone si `pretrained: false`) y el dropout.
- En CPU dos corridas con la misma config producen el mismo orden, métricas y
  pesos (lo verifica `tests/trainer/test_train.py`). En GPU, cuDNN puede variar en
  los últimos decimales aun en modo determinista.
