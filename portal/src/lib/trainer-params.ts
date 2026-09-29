import type { CreateTrainingJobParams } from "@/contracts";

/**
 * Traduce los parámetros validados del portal a la forma que consume el
 * pipeline de entrenamiento (`trainer/config.py::TrainConfig`), añadiendo las
 * rutas de datos por defecto del repo (T03/T04) y el `dvc_release` como tag.
 *
 * El worker recibe `{ id, params }`; `params` aquí es un superconjunto listo
 * para `load_config(overrides=...)` más `release` para trazabilidad.
 */
export function toTrainerParams(
  release: string,
  input: CreateTrainingJobParams,
): CreateTrainingJobParams & {
  release: string;
  manifest_path: string;
  classes_path: string;
  data_root: string;
} {
  return {
    ...input,
    release,
    // Rutas del release DVC del Proyecto 2 (contrato T03/T04).
    manifest_path: "data/splits/manifest.csv",
    classes_path: "data/crops/classes.json",
    data_root: "data/crops",
  };
}
