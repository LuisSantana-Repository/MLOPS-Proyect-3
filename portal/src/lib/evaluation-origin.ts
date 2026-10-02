import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvaluationMetrics, EvaluationResponse } from "@/contracts";
import { env } from "@/lib/env";
import { type ApiError, badRequest, conflict, notFound } from "@/lib/http";
import { getModelVersion, getRun, type NormalizedRun } from "@/lib/mlflow";
import { readPublishedRow } from "@/lib/published-models";
import { computeTestEvaluation, parsePredictionsCsv } from "./evaluation-metrics";
import {
  fetchMlflowArtifact,
  loadTestEvaluation,
  PREDICTIONS_ARTIFACT,
  REPO_REPORT_DIR,
} from "./test-evaluation";

/**
 * De dónde sale la evaluación de una versión de modelo (P1-3).
 *
 * 1. **MLflow** (fuente principal): el run de origen y su `test/predictions.csv`.
 * 2. **Repo verificado** (respaldo): si el run no se puede consultar en MLflow, se usan
 *    los artefactos versionados de `reports/t08/`, pero SOLO si son de la misma versión
 *    publicada: mismo `run_id` y mismo `weights_sha256`. Si el hash no coincide es 409:
 *    esos resultados son de otros pesos y no se muestran.
 *
 * En ambos casos se mantiene la regla de T07/T08: no hay resultados de test sin
 * `reports/t07/selection.json` del mismo run con `test_split_used=false`.
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

interface SelectionFile {
  run_id?: string;
  test_split_used?: boolean;
}

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

  const selection = parseJson<SelectionFile>(await readOptional(join(root, SELECTION)));
  if (selection?.run_id !== origin.runId || selection.test_split_used !== false) {
    throw conflict(
      `No se muestran resultados de test sin ${SELECTION} de este run con test_split_used=false`,
    );
  }

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
    const { confusionMatrix, classes } = confusionAndClasses(run);
    const test = await loadTestEvaluation(origin.runId ?? run.runId, run.metrics);
    return {
      modelName: name,
      modelVersion: version,
      runId: origin.runId,
      source: "mlflow",
      metrics: evaluationMetrics(run.metrics),
      confusionMatrix: confusionMatrix ?? test?.confusionMatrix.matrix ?? null,
      classes: classes ?? test?.confusionMatrix.labels ?? null,
      test,
    };
  }

  const report = await readVerifiedRepoReport(root, origin);
  if (!report) throw error ?? noOrigin(name, version);

  const { logged } = report;
  const { classes, rows } = parsePredictionsCsv(report.predictionsCsv);
  const test = computeTestEvaluation(classes, rows, logged, "repo");
  return {
    modelName: name,
    modelVersion: version,
    runId: origin.runId,
    source: "repo",
    metrics: evaluationMetrics(logged),
    confusionMatrix: test.confusionMatrix.matrix,
    classes: test.confusionMatrix.labels,
    test,
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
