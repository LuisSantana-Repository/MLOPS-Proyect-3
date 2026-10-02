# P1-2 — El worker ya no ignora parámetros que la API acepta

**Hallazgo:** `TRAINER_FIELDS` (worker.py) no incluía `monitor`, `patience`, `min_delta`,
`trainable_backbone`, `weight_decay`, `momentum` ni `pretrained`. Un job pedido con
`patience=1, monitor=val_acc, min_delta=0.5, trainable_backbone=none` quedó registrado en
MLflow con `5 / val_loss / 0.001 / layer4` (los valores de `configs/baseline.yaml`).

**Corrección:**

| Qué | Dónde |
|---|---|
| El worker propaga los 17 campos de `trainingParamsSchema` al entrenador | `worker.py` (`TRAINER_FIELDS`) |
| Un parámetro que el worker no conoce hace fallar el job (no se ignora) | `worker.py` (`build_config`) |
| El log `config:` del job muestra también early stopping, backbone y optimizador | `worker.py` (`run_job`) |
| El contrato del portal es estricto: un campo no soportado responde 400 y no crea el job | `portal/src/contracts/training.ts`, `portal/src/lib/http.ts` |
| `/training` tiene controles de métrica vigilada, patience, min_delta, backbone entrenable y weight decay | `portal/src/components/TrainingForm.tsx`, `portal/src/lib/ui/training-form.ts` |

## Evidencia

- `tests/worker/test_worker.py`: todos los parámetros del job aparecen tal cual en `cfg`
  (incluido el caso exacto del hallazgo); un campo desconocido o reservado falla sin entrenar.
- `tests/worker/test_worker_mlflow.py`: un job corto **real** (dataset sintético, 2 épocas,
  CPU) registra en MLflow los mismos 17 valores que pidió el portal, partiendo de una config
  base con los valores "equivocados" del hallazgo.
- `portal/src/contracts/training.params.test.ts`, `route.params.test.ts`,
  `training-form.params.test.tsx`: contrato estricto, 400 sin crear fila, y controles del formulario.

```bash
pytest tests/worker -q          # 26 passed
cd portal && npm test           # 246 passed
```

No se tocaron el manifiesto, los recortes, los `.dvc`, los runs ni el modelo publicado.
