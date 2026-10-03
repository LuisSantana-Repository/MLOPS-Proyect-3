import type { CreateTrainingJobParams, ReleasePaths } from "@/contracts";
import { DEFAULT_RELEASE_PATHS } from "@/lib/repo-artifacts";

/**
 * Traduce los parámetros validados del portal a la forma que consume el
 * pipeline de entrenamiento (`trainer/config.py::TrainConfig`), añadiendo las
 * rutas de datos del release elegido (cada release tiene su propio manifiesto) y el
 * `dvc_release` como tag.
 *
 * El worker recibe `{ id, params }`; `params` aquí es un superconjunto listo
 * para `load_config(overrides=...)` más `release` para trazabilidad.
 */
export function toTrainerParams(
  release: string,
  input: CreateTrainingJobParams,
  paths: ReleasePaths = DEFAULT_RELEASE_PATHS,
): CreateTrainingJobParams & {
  release: string;
  manifest_path: string;
  classes_path: string;
  data_root: string;
} {
  return {
    ...input,
    release,
    // Rutas del release DVC del Proyecto 2 elegido (contrato T03/T04).
    manifest_path: paths.manifest,
    classes_path: paths.classes,
    data_root: paths.dataRoot,
  };
}
