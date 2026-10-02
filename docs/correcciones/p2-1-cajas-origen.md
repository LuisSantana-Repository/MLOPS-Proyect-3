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
| La tarjeta del modelo lo enlaza en «Datos de origen» (tarjetas nuevas) | `serving/model_card.py` |

```bash
python ml/make_source_boxes.py --annotations data/source/coco-dataset.json --crops-dir data/crops
# 1349 cajas de origen escritas en data/crops/crops_source_boxes.csv
git status --short data/     # solo aparece el archivo nuevo: crops.csv y los .dvc no cambian
```

## Evidencia

- `ml/tests/test_source_boxes.py`:
  - **20 recortes al azar** del release real contra el COCO: imagen, clase, caja y tamaño del
    recorte = caja con floor/ceil (necesita `dvc pull`; en CI se omite porque no hay datos).
  - El archivo versionado tiene una fila por recorte de `crops.csv` (1349), con la misma
    anotación, imagen y clase.
  - `make_source_boxes.py` no modifica `crops.csv` y da el mismo resultado que `make_crops.py`;
    falla (exit 2) si el COCO no es el de los recortes.
- `portal/src/lib/crop-catalog.test.ts`: la API devuelve la caja de origen.

No cambian `crops.csv`, `crops.dvc`, el manifiesto (`e75a07ce…`) ni la huella del test.
