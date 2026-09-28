# Experimentos t07: comparación y candidato

- Experimento MLflow: `proyecto3-clasificador` · runs válidos: **10**
- Datos: release `proyecto2 v1.1.0@dc9376e` · manifiesto sha256 `0bdfd6d7efd40f17903df10695b3e34177d535071b76ac0c5404a215428ed578`
- Clases: ["person", "car"]
- Criterio predeclarado: **min `best_val_loss`** en validación; desempates `best_val_acc` (max), `start_time` (min). El split test no se usó.
- Seleccionado: **exp-07** · run `fe32e1388dbd465cae714a69bf80f685` · pesos sha256 `e5aa4f73e607bf593eade2cc9c0194e468a425613aea8042f155c4a3e82af630` · congelado 2026-09-28T03:21:04+00:00

| # | Exp | Run ID | optimizer | batch | max_ep | lr | img | hidden | dropout | otros cambios | best_val_loss | best_val_acc | mejor ép. | paró | motivo | min |
|---|---|---|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|
| 1 | exp-07 ★ | `fe32e1388dbd465cae714a69bf80f685` | adamw | 32 | 30 | 0.001 | 160 | [256] | 0.3 | — | 0.0463 | 0.9778 | 10 | 15 | early_stopping | 13.8 |
| 2 | exp-09 | `441d9178d044416fad3a7c320a3ef4d4` | adamw | 32 | 30 | 0.001 | 224 | [] | 0.0 | — | 0.0531 | 0.9815 | 4 | 9 | early_stopping | 12.7 |
| 3 | exp-10 | `aa2339fd6c2540b0a317aa65215f7c0a` | adamw | 32 | 30 | 0.001 | 224 | [512, 128] | 0.5 | — | 0.0544 | 0.9741 | 4 | 9 | early_stopping | 12.6 |
| 4 | exp-06 | `1632cb5aacd84bf39e01fc33185053f5` | adamw | 64 | 30 | 0.001 | 224 | [256] | 0.3 | — | 0.0549 | 0.9852 | 6 | 11 | early_stopping | 15.8 |
| 5 | exp-01 | `7693ef54d0884ebba1fc40348010bf29` | adamw | 32 | 30 | 0.001 | 224 | [256] | 0.3 | — | 0.0587 | 0.9778 | 7 | 12 | early_stopping | 17.0 |
| 6 | exp-02 | `8bc900a845854b039f7b3fbe369fa750` | sgd | 32 | 30 | 0.01 | 224 | [256] | 0.3 | — | 0.0598 | 0.9741 | 2 | 7 | early_stopping | 10.1 |
| 7 | exp-03 | `d698044c827542d3b1bc6b934f6fafa4` | adamw | 32 | 30 | 0.001 | 224 | [256] | 0.3 | weight_decay=0.01 | 0.0641 | 0.9778 | 8 | 13 | early_stopping | 18.4 |
| 8 | exp-04 | `5cc00060f0324c3c88f11fe47ed3ea68` | adamw | 32 | 45 | 0.0003 | 224 | [256] | 0.3 | — | 0.0686 | 0.9778 | 1 | 6 | early_stopping | 8.1 |
| 9 | exp-05 | `0571cb54407c42688e081a9361061d6d` | adamw | 16 | 30 | 0.001 | 224 | [256] | 0.3 | — | 0.0689 | 0.9741 | 4 | 9 | early_stopping | 13.9 |
| 10 | exp-08 | `8c744818af8c42e7a2f1cfda0090c0e4` | adamw | 32 | 30 | 0.001 | 288 | [256] | 0.3 | — | 0.0839 | 0.9667 | 6 | 11 | early_stopping | 24.0 |

## Cobertura de los 7 parámetros

| Parámetro | Valores probados |
|---|---|
| `optimizer` | adamw, sgd |
| `batch_size` | 16, 32, 64 |
| `max_epochs` | 30, 45 |
| `lr` | 0.0003, 0.001, 0.01 |
| `img_size` | 160, 224, 288 |
| `hidden_layers` | [256], [512, 128], [] |
| `dropout` | 0.0, 0.3, 0.5 |

## Pregunta de cada experimento

- **exp-01**: Línea base: AdamW, lr 1e-3, batch 32, 224 px, cabeza [256], dropout 0.3, layer4 entrenable.
- **exp-02**: ¿SGD con momentum iguala a AdamW? SGD necesita un lr mayor, por eso lr=1e-2.
- **exp-03**: ¿Weight decay desacoplado (AdamW, 0.01) regulariza mejor que la base sin decay?
- **exp-04**: ¿Un lr 3x menor, con más margen de épocas (45) para converger, generaliza mejor?
- **exp-05**: ¿Batch 16 (más pasos y más ruido por época) mejora la validación?
- **exp-06**: ¿Batch 64 (menos pasos, gradiente más estable) empeora o acelera?
- **exp-07**: ¿Imágenes de 160 px bastan? Recortes más baratos de entrenar e inferir.
- **exp-08**: ¿Imágenes de 288 px aportan detalle útil a pesar del costo?
- **exp-09**: ¿Una cabeza lineal sin capa oculta ni dropout es suficiente sobre features de ResNet18?
- **exp-10**: ¿Una cabeza más profunda [512, 128] con dropout 0.5 regulariza mejor?

## Runs excluidos

- `a5d818719f07400f84c1334daef29f0b`: estado KILLED (detenido a mano: con weight_decay=0 Adam es idéntico a AdamW (repetía exp-01); exp-03 se rediseñó)

## Nota de trazabilidad

Las corridas se lanzaron con cambios sin commit (`git_dirty=true`). Cada run guarda `source/source_diff.patch`; aplicado sobre `git_commit` reconstruye el código exacto usado.
