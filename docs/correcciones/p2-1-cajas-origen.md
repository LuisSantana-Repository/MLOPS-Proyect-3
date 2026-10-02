# P2-1 — Coordenadas de origen de cada recorte

**Hallazgo:** ni `crops.csv` ni `manifest.csv` guardaban la `bbox` de origen de cada recorte.

**Corrección:** sin modificar `crops.csv`, los recortes ni el manifiesto, se agrega
`data/crops/crops_source_boxes.csv` (una fila por recorte, mismo orden que `crops.csv`):

```
ann_id, image_id, category_id, bbox_x, bbox_y, bbox_w, bbox_h, crop_left, crop_top, crop_right, crop_bottom
```

`bbox_*` es la caja COCO `[x, y, w, h]` del release; `crop_*` es el rectángulo que recortó
T03 (floor/ceil, acotado a la imagen), así que `crop_right - crop_left` y
`crop_bottom - crop_top` son el ancho y alto del recorte guardado.

| Qué | Dónde |
|---|---|
| Archivo versionado del release actual (1349 filas) | `data/crops/crops_source_boxes.csv` |
| Script que lo genera desde `crops.csv` + COCO, validando que sean el mismo release | `ml/make_source_boxes.py` |
| `make_crops.py` lo escribe en generaciones futuras (`crop_bounds`, `source_box_rows`) | `ml/make_crops.py` |
| La API de recortes expone `sourceBox` por recorte | `portal/src/lib/crop-catalog.ts`, `GET /api/crops` |
| El generador de la tarjeta lo enlaza en «Datos de origen» (**solo tarjetas que se generen desde ahora**) | `serving/model_card.py` |

```bash
python ml/make_source_boxes.py --annotations data/source/coco-dataset.json --crops-dir data/crops
# 1349 cajas de origen escritas en data/crops/crops_source_boxes.csv
git status --short data/     # solo aparece el archivo nuevo: crops.csv y los .dvc no cambian
```

**Sobre la tarjeta publicada.** La tarjeta de `1.0.0` que está en el repo y en S3 **no**
menciona este archivo: se generó antes y no se regenera para no tocar la versión publicada.
El enlace aparecerá en la tarjeta de la siguiente versión que se publique (p. ej. `1.0.1`, P1-4).

## Evidencia

- `ml/tests/test_source_boxes.py`:
  - **Las 1349 filas** contra el COCO del release: caja idéntica y rectángulo floor/ceil
    exacto (sin abrir imágenes; necesita `dvc pull` de `data/source`).
  - **20 recortes al azar** además abren el `.jpg`: el tamaño del recorte guardado es el del
    rectángulo (necesita `dvc pull`; en CI se omite porque no hay datos).
  - **Huella SHA-256 del archivo versionado**: corre siempre, también en CI. Si cambia
    cualquier celda de cualquier fila (p. ej. `crop_right` 584→590 o `bbox_w` 236.8→200.5
    en el `ann_id` 2), falla.
  - El archivo versionado tiene una fila por recorte de `crops.csv` (1349), con la misma
    anotación, imagen y clase.
  - `make_source_boxes.py` no modifica `crops.csv` y da el mismo resultado que `make_crops.py`;
    falla (exit 2) si el COCO no es el de los recortes.
- `portal/src/lib/crop-catalog.test.ts`: la API devuelve la caja de origen.
- `tests/serving/test_model_card.py`: el generador de la tarjeta enlaza el archivo.

No cambian `crops.csv`, `crops.dvc`, el manifiesto (`e75a07ce…`) ni la huella del test.
