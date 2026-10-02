# P1-3 — Evaluation y la galería de errores funcionan con los artefactos versionados

**Hallazgo:** `GET /api/evaluation/clasificador:1.0.0` respondía 404 («no tiene run de origen
con métricas») cuando el run no estaba en MLflow, aunque `reports/t08/` tuviera
`predictions.csv` y `metrics.json` del mismo run.

**Corrección:**

| Qué | Dónde |
|---|---|
| MLflow sigue siendo la fuente principal | `portal/src/lib/evaluation-origin.ts` (`loadEvaluation`) |
| Respaldo verificado: si el run no se puede consultar, se usa `reports/t08` **solo** si `metrics.json.run_id` y `weights_sha256` coinciden con la versión publicada (`published_models`) | `readVerifiedRepoReport` |
| Hash de pesos distinto → **409** (no se muestran resultados de otros pesos) | `readVerifiedRepoReport`, `conflict` en `portal/src/lib/http.ts` |
| Se mantiene la regla: sin `reports/t07/selection.json` del mismo run con `test_split_used=false` no hay resultados de test (409) | `readVerifiedRepoReport` |
| La respuesta trae `source`: `"mlflow"` o `"repo"`; la página lo muestra como «MLflow» o «repo verificado» | `portal/src/contracts/models.ts`, `EvaluationSource` en `EvaluationDashboard.tsx` |
| Exportar `predictions.csv` desde la página | `GET /api/evaluation/[modelVersion]/predictions` |

En el respaldo, las métricas "registradas" con las que se comparan las cifras calculadas
desde el CSV son las de `reports/t08/metrics.json` y `classification_report.json`.

## Evidencia

- `portal/src/app/api/evaluation/[modelVersion]/route.fallback.test.ts` — los 3 casos de la
  ruta con los artefactos **reales** del repo (solo se simulan MLflow y `published_models`):
  1. MLflow → `source: "mlflow"`.
  2. Respaldo válido → `source: "repo"`, 135 muestras, accuracy 128/135 = 0.948148, y la
     galería con los **7 errores** (recorte, etiqueta real y predicción).
  3. Respaldo con hash distinto → 409.
  Más: MLflow caído usa el respaldo; reporte de otro run sigue siendo 404; exportación del CSV.
- `portal/src/lib/evaluation-origin.test.ts` — reglas del respaldo (hash, run, selección).
- `portal/src/components/evaluation-source.test.tsx` — la página indica la fuente y enlaza la exportación.

```bash
curl -s localhost:3000/api/evaluation/clasificador:1.0.0 | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['source'], d['test']['nSamples'], d['test']['accuracy'], len(d['test']['errors']))"
curl -sI localhost:3000/api/evaluation/clasificador:1.0.0/predictions | grep -i -E "content-disposition|x-evaluation-source"
```

No cambian `reports/t08`, `reports/t07`, el manifiesto ni el modelo: el accuracy de test
reportado sigue siendo 128/135 = 0.948148.
