# Actividad A — Datos y Training (1.1 + 6.1)

## 1. Varios releases aprobados (1.1)

| Qué | Dónde |
|---|---|
| Cada release vive en su propia ruta: el entregado en `data/crops` + `data/splits`; los demás en `data/releases/<versión>/{crops,splits}` | `portal/src/lib/repo-artifacts.ts` (`releaseLayouts`, `evaluateReleases`) |
| Cada release se aprueba con el reporte de compuerta de **su** versión | `portal/src/lib/release-gate.ts` (`gateReportPath`) |
| Reporte oficial de la compuerta de `v1.0.0` (DVC del Proyecto 2, commit `9c0b9a4`, MD5 `da513805a74302569a3e980b8184f310`): `overall_status: pass`, `exit_code: 0` | `annotation-backend/quality/releases/v1.0.0/release.json` |
| `GET /api/releases` lista todos los aprobados; cada uno trae `paths` (su manifiesto, clases y recortes) | `portal/src/contracts/releases.ts` |
| El job entrena con el manifiesto del release elegido | `portal/src/lib/trainer-params.ts`, `POST /api/training/jobs` |
| Training muestra, por release, conteos, hashes y la ruta de su manifiesto | `portal/src/components/ReleaseSelector.tsx` |

El manifiesto entregado (`e75a07ce…`) no se regenera ni se modifica: el de `v1.0.0` va en
`data/releases/v1.0.0/splits/manifest.csv`, con su propio `.dvc`.

## 2. El job sobrevive a la recarga (6.1)

El id del job queda en la URL (`/training?job=<id>`) y, como respaldo, en localStorage. Al
montar `TrainingDashboard` se recupera y `JobProgress` vuelve a pedir estado, run y logs a
`GET /api/training/jobs/[id]` (`portal/src/lib/ui/job-persistence.ts`).

## 3. Validar el manifiesto actual antes de encolar (6.1)

`requireApprovedRelease` ya no confía solo en `leakage_report.json`: lee el `manifest.csv`
que usará el worker y recalcula los cruces entre train, val y test por `image_id`,
`group_id` y `ann_id` (`portal/src/lib/manifest-leakage.ts`). Responde **400 sin crear el
job** si hay algún cruce, si el archivo no es el versionado en DVC (md5 distinto al de
`manifest.csv.dvc`) o si falta (`dvc pull`).

## 4. Prueba completa de `crops_source_boxes.csv` (1.2)

Cerrada en la rama `fix/p2-1-cajas-origen`: ver `p2-1-cajas-origen.md`.

## Evidencia (tests)

- `portal/src/app/api/training/jobs/route.release.test.ts`: caso del evaluador (`image_id`
  61 / `ann_id` 80 en train y el resto del original en test) → 400 y `createJob` no se llama;
  manifiesto modificado → 400; sin archivo → 400; cada release encola su propio manifiesto.
- `portal/src/lib/manifest-leakage.test.ts`: cruces por `image_id`, `group_id` y `ann_id`.
- `portal/src/lib/repo-artifacts.test.ts`: dos releases con conteos, hash y manifiesto
  distintos; cada uno con su compuerta; uno con compuerta fallida no aparece.
- `portal/src/components/training-reload.test.tsx`: con `?job=<id>` reaparecen estado, run y
  logs; sin él se usa el último job guardado.
- `portal/src/components/components.test.tsx`: al cambiar de release cambian conteos y hash.
