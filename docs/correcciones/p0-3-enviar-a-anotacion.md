# P0-3 — «Enviar a anotación» entra al flujo de anotación del Proyecto 1

**Hallazgo:** Inference escribía en una tabla nueva (`annotation_queue`) que la anotación
COCO del Proyecto 1 no consumía.

**Corrección:** al enviar desde `/inference`, la imagen se registra en el portal de
anotación con su API de siempre (`POST /images` de `annotation-api`): queda en la tabla
`images` como `pending`, guardada en su bucket, con la sugerencia del modelo como
metadato. Se consulta desde **Buscar** (`/search?status=pending`) y **Subir fotografías**
(lista de pendientes) y se anota en `/annotate/<id>`, igual que una subida manual.

| Qué | Dónde |
|---|---|
| Columnas `suggested_category`, `suggested_probabilities`, `suggested_model_version` en `images` | `annotation-backend/src/data/db/schema.ts`, migración `0003_model_suggestion.sql` |
| `POST /images` acepta la sugerencia (valida; 400 si es inválida) | `annotation-backend/src/logic/image-suggestion.ts`, `src/ui/server.ts` |
| La búsqueda y `GET /images/:id` devuelven `suggestion` | `image-search.service.ts`, `image-upload.service.ts` |
| El portal envía la imagen clasificada al backend de anotación | `portal/src/lib/annotation-portal.ts`, `POST /api/annotation` |
| Inference enlaza a «Anotar ahora» y «Ver pendientes» | `portal/src/components/InferenceDashboard.tsx` |
| La sugerencia se ve en la tarjeta de búsqueda y en la pantalla de anotación | `portal/src/p2/components/shared/ModelSuggestionBadge.tsx` |
| Se eliminó `annotation_queue` (tabla, API, página y entrada del menú) | `portal/drizzle/0003_drop_annotation_queue.sql` |

La sugerencia es solo una ayuda: nunca crea una anotación por sí sola; la persona dibuja
la caja y elige la categoría.

## Evidencia

- Integración (backend): `annotation-backend/tests/inference-suggestion.test.ts` sube una
  imagen con la sugerencia como lo hace Inference y la encuentra `pending` en la búsqueda
  de pendientes y en el detalle que lee la pantalla de anotación.
- Portal: `portal/src/lib/annotation-portal.test.ts` (qué se envía al backend),
  `portal/src/app/api/annotation/route.test.ts` (contrato y ausencia de la cola vieja),
  `portal/src/p2/tests/model-suggestion.test.tsx` (la vista de anotación la muestra).
- Punta a punta con el stack arriba y un modelo publicado: `scripts/e2e_inference_anotacion.sh`.
- CI: job `annotation-backend-tests`.
