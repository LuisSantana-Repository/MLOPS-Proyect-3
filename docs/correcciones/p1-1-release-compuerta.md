# P1-1 — Release aprobado real, con compuerta de calidad

**Hallazgo:** `readApprovedReleases` devolvía un release fijo desde `release_info.json`, sin
referencia a la compuerta de calidad, y `POST /api/training/jobs` aceptaba cualquier tag
(201); el rechazo llegaba después, en el worker.

**Corrección:**

| Qué | Dónde |
|---|---|
| Registro de releases del Proyecto 2 (`reports/versions.json` de `ikramzaldivar/proyecto2`) | `annotation-backend/quality/reports/versions.json` |
| Resultado real de la compuerta de `v1.1.0` (`reports/release.json`, salida DVC de la etapa `release` del Proyecto 2, traída con `dvc pull -r prod`) | `annotation-backend/quality/reports/release.json` |
| Política de calidad | `annotation-backend/quality/quality.yaml` |
| Regla de aprobación: versión en el registro + mismos datos (hash DVC) + reporte de esa versión en `pass` | `portal/src/lib/release-gate.ts` |
| `GET /api/releases` lista solo releases aprobados, con manifiesto 70/20/10 sin fuga, y expone `quality` | `portal/src/lib/repo-artifacts.ts` |
| `POST /api/training/jobs` valida el release antes de crear la fila (400 si no existe o no está aprobado) | `portal/src/app/api/training/jobs/route.ts` |
| Training muestra la evidencia: veredicto, reporte + MD5, política + SHA-256, checks | `portal/src/components/ReleaseSelector.tsx` |

Son los mismos archivos que sirve el backend de calidad del Proyecto 2 (`annotation-api`),
así que las vistas **Resumen** y **Versiones** del portal muestran el mismo release.

## Cómo se liga el release con la compuerta (verificable)

| Dato | Valor | Dónde |
|---|---|---|
| Release usado por los recortes | `proyecto2 v1.1.0@dc9376e` | `data/crops/release_info.json` |
| Hash DVC de los datos (`data/raw`) | `1fdb1dcea3218ad2fb0edf985984a929` | `release_info.json` **y** `versions.json` (`v1.1.0.dvcRevision`) |
| MD5 de anotaciones | `72e5f4025c4dbe7eb1e2420a9b4dbf9a` | `release_info.json` y `dvc.lock` del Proyecto 2 |
| Reporte de la compuerta | `dataset_version: v1.1.0`, `overall_status: pass`, `exit_code: 0`, 6 checks en `pass` | `release.json` |
| MD5 del reporte | `7975c619c6b2dc99ba4a052f70d522b0` | igual al de `reports/release.json` en el `dvc.lock` del Proyecto 2 |

```bash
md5sum annotation-backend/quality/reports/release.json   # 7975c619c6b2dc99ba4a052f70d522b0
curl -s localhost:3000/api/releases | python3 -m json.tool | grep -A6 '"quality"'
curl -s -X POST localhost:3000/api/training/jobs -H 'Content-Type: application/json' \
  -d '{"release":"v9.9.9@noaprobado"}'                    # 400, sin fila en training_jobs
```

## Evidencia (tests)

- `portal/src/app/api/training/jobs/route.release.test.ts`: `{"release":"v9.9.9@noaprobado"}`
  responde 400 y `createJob` no se llama (sin simular la validación: lee los artefactos reales).
- `portal/src/app/api/releases/route.gate.test.ts`: un release con compuerta fallida no aparece.
- `portal/src/lib/repo-artifacts.test.ts`: compuerta fallida, sin reporte, reporte de otra
  versión, datos distintos al registro, manifiesto con fuga; y el release real del repo pasa
  con el MD5 del reporte del Proyecto 2.

## Límites conocidos (sin maquillar)

- Hay **un** release utilizable. `v1.0.0` está en el registro pero no se lista: no tiene
  reporte de compuerta en este repo ni manifiesto 70/20/10 derivado. Por eso no se puede
  demostrar el cambio de manifiesto y conteos al cambiar de release.
- Los datos del release siguen siendo una copia en el DVC del Proyecto 3 (no un `dvc import`
  con `rev_lock`): cambiarlo obligaría a tocar los `.dvc` congelados. La igualdad con el
  Proyecto 2 se verifica por hash (tabla de arriba).
- El manifiesto, los recortes, los `.dvc`, los runs y el modelo publicado no se tocaron.
