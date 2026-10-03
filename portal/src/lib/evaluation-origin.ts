import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  EvaluationDataset,
  EvaluationMetrics,
  EvaluationResponse,
  TestEvaluation,
  TestPrediction,
} from "@/contracts";
import { env } from "@/lib/env";
import { ApiError, badRequest, conflict, notFound } from "@/lib/http";
import { getModelVersion, getRun, type NormalizedRun } from "@/lib/mlflow";
import { readPublishedRow } from "@/lib/published-models";
import { dvcMd5, readCandidateSelection, releaseLayouts } from "@/lib/repo-artifacts";
import { computeTestEvaluation, parsePredictionsCsv } from "./evaluation-metrics";
import { fetchMlflowArtifact, PREDICTIONS_ARTIFACT, REPO_REPORT_DIR } from "./test-evaluation";

/**
 * De dónde sale la evaluación de una versión de modelo (P1-3).
 *
 * 1. **MLflow** (fuente principal): el run de origen y su `test/predictions.csv`.
 * 2. **Repo verificado** (respaldo): si el run no se puede consultar en MLflow, o está
 *    pero sin su `test/predictions.csv`, se usan los artefactos versionados de
 *    `reports/t08/`, pero SOLO si son de la misma versión publicada: mismo `run_id` y
 *    mismo `weights_sha256`. Si el hash no coincide es 409: esos resultados son de otros
 *    pesos y no se muestran. Es el único camino hacia `reports/t08`.
 *
 * Las versiones enteras del Model Registry no tienen hash publicado con qué verificar,
 * así que no tienen respaldo: sin artefacto en MLflow, su evaluación de test es `null`.
 *
 * En todos los casos se mantiene la regla de T07/T08 (6.3): no hay resultados de test
 * sin `reports/t07/selection.json` del mismo run con `test_split_used=false`. Sin esa
 * selección congelada la API responde 409 y no entrega accuracy, matriz ni predicciones.
 */

const SELECTION = "reports/t07/selection.json";
const SEMVER = /^\d+\.\d+\.\d+$/;

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function parseJson<T>(text: string | null): T | null {
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export interface ModelOrigin {
  runId: string | null;
  /** SHA-256 de los pesos de la versión publicada; null si la versión solo está en el registry. */
  weightsSha256: string | null;
}

/** "modelo:3", "modelo:1.0.0" o "3" + ?name=modelo → { name, version }. */
export function resolveNameVersion(segment: string, nameQuery: string | null) {
  const decoded = decodeURIComponent(segment);
  if (decoded.includes(":")) {
    const idx = decoded.lastIndexOf(":");
    return { name: decoded.slice(0, idx), version: decoded.slice(idx + 1) };
  }
  if (nameQuery) return { name: nameQuery, version: decoded };
  throw badRequest('Indica el modelo como "nombre:version" en la ruta o pasa ?name=<modelo>');
}

/** Run de origen de la versión: `published_models` (semver) o Model Registry (entero). */
export async function resolveOrigin(name: string, version: string): Promise<ModelOrigin> {
  if (SEMVER.test(version)) {
    const row = await readPublishedRow(version);
    if (!row || row.name !== name) {
      throw notFound(`No existe la versión publicada ${version} del modelo "${name}"`);
    }
    return { runId: row.runId, weightsSha256: row.sha256 ?? null };
  }
  const mv = await getModelVersion(name, version);
  if (!mv) throw notFound(`No existe la versión ${version} del modelo "${name}"`);
  return { runId: mv.runId, weightsSha256: null };
}

/**
 * 6.3: los resultados de test solo se muestran si T07 congeló la selección ANTES del test,
 * para ESTE run y sin usar el test. Si no, 409 (no se revela accuracy, matriz ni predicciones).
 */
export async function requireFrozenSelection(root: string, runId: string | null): Promise<void> {
  let selection: Awaited<ReturnType<typeof readCandidateSelection>>;
  try {
    selection = await readCandidateSelection(root);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw conflict(
        `No se muestran resultados de test sin ${SELECTION}: falta el candidato congelado por validación (T07)`,
      );
    }
    throw err;
  }
  if (!runId || selection.runId !== runId) {
    throw conflict(
      `No se muestran resultados de test: ${SELECTION} congeló el run ${selection.runId}, no ${runId ?? "—"}`,
    );
  }
  if (selection.testSplitUsed !== false) {
    throw conflict(
      `No se muestran resultados de test: ${SELECTION} indica que el test se usó para elegir`,
    );
  }
}

function hasTestResults(metrics: Record<string, number>): boolean {
  return Object.keys(metrics).some((k) => k.startsWith("test_"));
}

/** md5 del `data/raw.dvc` del Proyecto 2, dentro del contenido del .dvc que guardó T03. */
export function rawDvcMd5(dvcFileContent: string | undefined): string | null {
  const block = dvcFileContent?.split(/^# /m).find((b) => b.startsWith("data/raw.dvc"));
  return block?.match(/md5:\s*([0-9a-f]{32}(?:\.dir)?)/)?.[1] ?? null;
}

interface ReleaseInfoFile {
  release_tag?: string;
  annotations_md5?: string;
  dvc_file_content?: string;
}

interface ReleaseFiles {
  info: ReleaseInfoFile;
  manifestDvcMd5: string | null;
}

/**
 * Archivos versionados del release `tag` (`null` = el entregado). Se busca en el release
 * entregado y en `data/releases/*`; si ninguno tiene esa etiqueta, no hay archivos.
 */
async function readReleaseFiles(root: string, tag: string | null): Promise<ReleaseFiles | null> {
  for (const layout of await releaseLayouts(root)) {
    const info = parseJson<ReleaseInfoFile>(
      await readOptional(join(root, layout.crops, "release_info.json")),
    );
    if (!info || (tag !== null && info.release_tag !== tag)) continue;
    return {
      info,
      manifestDvcMd5: dvcMd5(await readOptional(join(root, layout.splits, "manifest.csv.dvc"))),
    };
  }
  return null;
}

/**
 * Release y hashes DVC de los datos (6.3). Las etiquetas del run tienen prioridad; lo que
 * falte se completa con los archivos del MISMO release (`dvc_release`), nunca con los de
 * otro: un release que no está en el repo deja esos hashes en `null`.
 */
export async function readDatasetVersion(
  root: string,
  runTags: Record<string, string> | null,
): Promise<EvaluationDataset> {
  const files = await readReleaseFiles(root, runTags?.dvc_release ?? null);
  return {
    release: runTags?.dvc_release ?? files?.info.release_tag ?? null,
    rawDvcMd5: rawDvcMd5(files?.info.dvc_file_content),
    annotationsMd5: runTags?.release_annotations_md5 ?? files?.info.annotations_md5 ?? null,
    manifestDvcMd5: runTags?.manifest_dvc_md5 ?? files?.manifestDvcMd5 ?? null,
    manifestSha256: runTags?.manifest_sha256 ?? null,
  };
}

/** La evaluación con TODAS las predicciones del test para la galería (4.4). */
function withPredictions(test: TestEvaluation, rows: TestPrediction[]): TestEvaluation {
  return { ...test, predictions: rows };
}

export interface VerifiedRepoReport {
  runId: string;
  weightsSha256: string;
  /** Métricas que T08 dejó en `reports/t08` (mismos nombres `test_*` que registra en MLflow). */
  logged: Record<string, number>;
  predictionsCsv: string;
}

interface RepoMetricsFile {
  run_id?: string;
  weights_sha256?: string;
  accuracy?: number;
  f1_macro?: number;
  n_samples?: number;
}

type ClassReportFile = Record<string, Record<string, number>>;

/**
 * `reports/t08` como respaldo, verificado contra la versión publicada.
 * - null: no hay reporte, es de otro run, o la versión no tiene hash publicado con qué verificar.
 * - 409: el reporte es del mismo run pero de otros pesos, o falta la selección de T07.
 */
export async function readVerifiedRepoReport(
  root: string,
  origin: ModelOrigin,
): Promise<VerifiedRepoReport | null> {
  if (!origin.runId || !origin.weightsSha256) return null;

  const metrics = parseJson<RepoMetricsFile>(
    await readOptional(join(root, REPO_REPORT_DIR, "metrics.json")),
  );
  if (!metrics || metrics.run_id !== origin.runId) return null;

  if (metrics.weights_sha256 !== origin.weightsSha256) {
    throw conflict(
      `${REPO_REPORT_DIR} no corresponde a los pesos publicados: el reporte es de ` +
        `${metrics.weights_sha256 ?? "pesos sin hash"} y la versión publicada es ${origin.weightsSha256}`,
    );
  }

  await requireFrozenSelection(root, origin.runId);

  const predictionsCsv = await readOptional(join(root, REPO_REPORT_DIR, "predictions.csv"));
  if (predictionsCsv === null) return null;

  const logged: Record<string, number> = {};
  const put = (name: string, value: unknown) => {
    if (typeof value === "number") logged[name] = value;
  };
  put("test_accuracy", metrics.accuracy);
  put("test_f1_macro", metrics.f1_macro);
  put("test_n_samples", metrics.n_samples);
  const perClass = parseJson<ClassReportFile>(
    await readOptional(join(root, REPO_REPORT_DIR, "classification_report.json")),
  );
  for (const [cls, values] of Object.entries(perClass ?? {})) {
    for (const key of ["precision", "recall", "f1", "support"]) {
      put(`test_${key}_${cls}`, values?.[key]);
    }
  }

  return {
    runId: origin.runId,
    weightsSha256: origin.weightsSha256,
    logged,
    predictionsCsv,
  };
}

/** Run de MLflow, o null si no existe; si MLflow falla, devuelve el error para decidir después. */
async function tryGetRun(
  runId: string | null,
): Promise<{ run: NormalizedRun | null; error: ApiError | null }> {
  if (!runId) return { run: null, error: null };
  try {
    return { run: await getRun(runId), error: null };
  } catch (err) {
    return { run: null, error: err as ApiError };
  }
}

/** Extrae accuracy, macro-F1 y demás métricas de evaluación del run. */
function evaluationMetrics(metrics: Record<string, number>): EvaluationMetrics {
  const pick = (...names: string[]) => {
    for (const n of names) {
      if (typeof metrics[n] === "number") return metrics[n];
    }
    return null;
  };
  const extra: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (/^(test_|eval_)/.test(key)) extra[key] = value;
  }
  return {
    accuracy: pick("test_accuracy", "eval_accuracy", "test_acc", "accuracy"),
    macroF1: pick("test_macro_f1", "test_f1_macro", "eval_macro_f1", "macro_f1"),
    extra,
  };
}

/** Lee la matriz de confusión y clases desde tags/params JSON del run. */
function confusionAndClasses(run: NormalizedRun) {
  return {
    confusionMatrix:
      parseJson<number[][]>(run.tags.confusion_matrix ?? run.params.confusion_matrix ?? null) ??
      null,
    classes: parseJson<string[]>(run.tags.classes ?? null) ?? null,
  };
}

function noOrigin(name: string, version: string): ApiError {
  return notFound(`La versión ${version} de "${name}" no tiene run de origen con métricas`);
}

/** Evaluación de una versión: MLflow si el run está disponible; si no, el repo verificado. */
export async function loadEvaluation(
  name: string,
  version: string,
  root: string = env.REPO_ROOT,
): Promise<EvaluationResponse> {
  const origin = await resolveOrigin(name, version);
  const { run, error } = await tryGetRun(origin.runId);

  if (run) {
    const runId = origin.runId ?? run.runId;
    const { confusionMatrix, classes } = confusionAndClasses(run);
    const dataset = await readDatasetVersion(root, run.tags);

    // 6.3: antes de exponer cualquier métrica test_, la selección congelada de este run.
    if (hasTestResults(run.metrics)) await requireFrozenSelection(root, runId);

    // predictions.csv del run. Solo se pide si T08 ya registró métricas de test.
    let csv: string | null = null;
    let artifactError: ApiError | null = null;
    if (typeof run.metrics.test_accuracy === "number") {
      try {
        csv = await fetchMlflowArtifact(runId, PREDICTIONS_ARTIFACT);
      } catch (err) {
        artifactError = err as ApiError;
      }
    }

    if (csv !== null) {
      const parsed = parsePredictionsCsv(csv);
      const test = withPredictions(
        computeTestEvaluation(parsed.classes, parsed.rows, run.metrics, "mlflow"),
        parsed.rows,
      );
      return {
        modelName: name,
        modelVersion: version,
        runId: origin.runId,
        source: "mlflow",
        metrics: evaluationMetrics(run.metrics),
        confusionMatrix: confusionMatrix ?? test.confusionMatrix.matrix,
        classes: classes ?? test.confusionMatrix.labels,
        test,
        dataset,
      };
    }

    // El run está en MLflow pero sin predicciones de test: mismo respaldo verificado que
    // cuando el run no está (409 si es de otros pesos o falta la selección de T07).
    const report = await readVerifiedRepoReport(root, origin);
    if (report) {
      const logged = { ...report.logged, ...run.metrics };
      const parsed = parsePredictionsCsv(report.predictionsCsv);
      const test = withPredictions(
        computeTestEvaluation(parsed.classes, parsed.rows, logged, "repo"),
        parsed.rows,
      );
      return {
        modelName: name,
        modelVersion: version,
        runId: origin.runId,
        source: "repo",
        metrics: evaluationMetrics(logged),
        confusionMatrix: confusionMatrix ?? test.confusionMatrix.matrix,
        classes: classes ?? test.confusionMatrix.labels,
        test,
        dataset,
      };
    }
    if (artifactError) throw artifactError;

    return {
      modelName: name,
      modelVersion: version,
      runId: origin.runId,
      source: "mlflow",
      metrics: evaluationMetrics(run.metrics),
      confusionMatrix,
      classes,
      test: null,
      dataset,
    };
  }

  const report = await readVerifiedRepoReport(root, origin);
  if (!report) throw error ?? noOrigin(name, version);

  const { logged } = report;
  const { classes, rows } = parsePredictionsCsv(report.predictionsCsv);
  const test = withPredictions(computeTestEvaluation(classes, rows, logged, "repo"), rows);
  return {
    modelName: name,
    modelVersion: version,
    runId: origin.runId,
    source: "repo",
    metrics: evaluationMetrics(logged),
    confusionMatrix: test.confusionMatrix.matrix,
    classes: test.confusionMatrix.labels,
    test,
    dataset: await readDatasetVersion(root, null),
  };
}

/** predictions.csv de la versión, de la misma fuente que la evaluación (para exportar). */
export async function loadPredictionsCsv(
  name: string,
  version: string,
  root: string = env.REPO_ROOT,
): Promise<{ csv: string; source: "mlflow" | "repo"; runId: string }> {
  const origin = await resolveOrigin(name, version);
  if (!origin.runId) throw noOrigin(name, version);

  // Exportar predicciones también es revelar el test: misma regla de la selección (6.3).
  await requireFrozenSelection(root, origin.runId);

  let mlflowError: ApiError | null = null;
  try {
    const csv = await fetchMlflowArtifact(origin.runId, PREDICTIONS_ARTIFACT);
    if (csv !== null) return { csv, source: "mlflow", runId: origin.runId };
  } catch (err) {
    mlflowError = err as ApiError;
  }

  const report = await readVerifiedRepoReport(root, origin);
  if (report) return { csv: report.predictionsCsv, source: "repo", runId: origin.runId };
  throw (
    mlflowError ??
    notFound(`La versión ${version} de "${name}" todavía no tiene predictions.csv de test`)
  );
}
