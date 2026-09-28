import { env } from "@/lib/env";
import { notFound, upstreamError } from "@/lib/http";

/**
 * Cliente mínimo de la REST API de MLflow (`/api/2.0/mlflow`).
 * Solo cubre lo que necesita el portal (T09): experimentos, runs, historial de
 * métricas y model registry. Los errores de red o HTTP se traducen a ApiError.
 */

const API_BASE = `${env.MLFLOW_TRACKING_URI.replace(/\/$/, "")}/api/2.0/mlflow`;

// --- Formas crudas de la REST API de MLflow ----------------------------------

interface RawKeyValue {
  key: string;
  value: string;
}

interface RawMetric {
  key: string;
  value: number;
  timestamp: number;
  step: number;
}

interface RawRun {
  info: {
    run_id: string;
    run_name?: string;
    experiment_id: string;
    status: string;
    start_time?: number;
    end_time?: number;
  };
  data?: {
    params?: RawKeyValue[];
    metrics?: RawMetric[];
    tags?: RawKeyValue[];
  };
}

interface RawModelVersion {
  name: string;
  version: string;
  current_stage?: string;
  status?: string;
  run_id?: string;
  source?: string;
  creation_timestamp?: number;
  last_updated_timestamp?: number;
  description?: string;
  tags?: RawKeyValue[];
}

// --- HTTP --------------------------------------------------------------------

async function request<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const { query, ...rest } = init;
  const url = new URL(`${API_BASE}/${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { "Content-Type": "application/json", ...rest.headers },
      cache: "no-store",
    });
  } catch (cause) {
    throw upstreamError(
      `No se pudo contactar a MLflow en ${env.MLFLOW_TRACKING_URI}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }

  const text = await res.text();
  const body = text ? safeJson(text) : {};

  if (!res.ok) {
    const detail = (body as { message?: string })?.message ?? `${res.status} ${res.statusText}`;
    if (res.status === 404) throw notFound(`MLflow: ${detail}`);
    throw upstreamError(`MLflow respondió ${res.status}: ${detail}`);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function kvToRecord(pairs: RawKeyValue[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of pairs ?? []) out[key] = value;
  return out;
}

// --- API pública -------------------------------------------------------------

/** Devuelve el experiment_id para un nombre, o null si no existe. */
export async function getExperimentIdByName(name: string): Promise<string | null> {
  try {
    const data = await request<{ experiment?: { experiment_id: string } }>(
      "experiments/get-by-name",
      { query: { experiment_name: name } },
    );
    return data.experiment?.experiment_id ?? null;
  } catch (err) {
    // get-by-name devuelve 404 cuando el experimento no existe: lo tratamos como null.
    if (err && typeof err === "object" && "status" in err && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export interface NormalizedRun {
  runId: string;
  runName: string | null;
  experimentId: string;
  status: string;
  startTime: number | null;
  endTime: number | null;
  params: Record<string, string>;
  metrics: Record<string, number>;
  tags: Record<string, string>;
}

function normalizeRun(run: RawRun): NormalizedRun {
  const metrics: Record<string, number> = {};
  for (const m of run.data?.metrics ?? []) metrics[m.key] = m.value;
  return {
    runId: run.info.run_id,
    runName: run.info.run_name ?? null,
    experimentId: run.info.experiment_id,
    status: run.info.status,
    startTime: run.info.start_time ?? null,
    endTime: run.info.end_time ?? null,
    params: kvToRecord(run.data?.params),
    metrics,
    tags: kvToRecord(run.data?.tags),
  };
}

/** Busca runs de uno o más experimentos, con paginación, filtro y orden. */
export async function searchRuns(options: {
  experimentIds: string[];
  maxResults: number;
  pageToken?: string;
  /** Expresión `filter` de la REST API de MLflow (p. ej. tags/métricas). */
  filter?: string;
  /** `order_by` de MLflow; por defecto por fecha de inicio descendente. */
  orderBy?: string[];
}): Promise<{ runs: NormalizedRun[]; nextPageToken: string | null }> {
  const data = await request<{ runs?: RawRun[]; next_page_token?: string }>("runs/search", {
    method: "POST",
    body: JSON.stringify({
      experiment_ids: options.experimentIds,
      max_results: options.maxResults,
      filter: options.filter,
      order_by: options.orderBy ?? ["attributes.start_time DESC"],
      page_token: options.pageToken,
    }),
  });
  return {
    runs: (data.runs ?? []).map(normalizeRun),
    nextPageToken: data.next_page_token ?? null,
  };
}

/** Historial completo de una métrica (todos los steps/épocas). */
export async function getMetricHistory(runId: string, metricKey: string): Promise<RawMetric[]> {
  const collected: RawMetric[] = [];
  let pageToken: string | undefined;
  do {
    const data = await request<{ metrics?: RawMetric[]; next_page_token?: string }>(
      "metrics/get-history",
      {
        query: { run_id: runId, metric_key: metricKey, max_results: 25000, page_token: pageToken },
      },
    );
    collected.push(...(data.metrics ?? []));
    pageToken = data.next_page_token;
  } while (pageToken);
  return collected;
}

/** Obtiene un run por id (para evaluación y model lineage). */
export async function getRun(runId: string): Promise<NormalizedRun | null> {
  try {
    const data = await request<{ run?: RawRun }>("runs/get", { query: { run_id: runId } });
    return data.run ? normalizeRun(data.run) : null;
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && err.status === 404) return null;
    throw err;
  }
}

export interface NormalizedModelVersion {
  name: string;
  version: string;
  stage: string | null;
  status: string | null;
  runId: string | null;
  source: string | null;
  creationTimestamp: number | null;
  lastUpdatedTimestamp: number | null;
  description: string | null;
  tags: Record<string, string>;
}

function normalizeModelVersion(mv: RawModelVersion): NormalizedModelVersion {
  return {
    name: mv.name,
    version: mv.version,
    stage: mv.current_stage ?? null,
    status: mv.status ?? null,
    runId: mv.run_id ?? null,
    source: mv.source ?? null,
    creationTimestamp: mv.creation_timestamp ?? null,
    lastUpdatedTimestamp: mv.last_updated_timestamp ?? null,
    description: mv.description ?? null,
    tags: kvToRecord(mv.tags),
  };
}

/** Todas las versiones de modelo registradas (paginado). */
export async function searchModelVersions(filter?: string): Promise<NormalizedModelVersion[]> {
  const collected: NormalizedModelVersion[] = [];
  let pageToken: string | undefined;
  do {
    const data = await request<{
      model_versions?: RawModelVersion[];
      next_page_token?: string;
    }>("model-versions/search", {
      query: { filter, max_results: 200, page_token: pageToken },
    });
    collected.push(...(data.model_versions ?? []).map(normalizeModelVersion));
    pageToken = data.next_page_token;
  } while (pageToken);
  return collected;
}

/** Una versión concreta de un modelo. */
export async function getModelVersion(
  name: string,
  version: string,
): Promise<NormalizedModelVersion | null> {
  try {
    const data = await request<{ model_version?: RawModelVersion }>("model-versions/get", {
      query: { name, version },
    });
    return data.model_version ? normalizeModelVersion(data.model_version) : null;
  } catch (err) {
    if (err && typeof err === "object" && "status" in err && err.status === 404) return null;
    throw err;
  }
}

/**
 * Convierte un `source` de MLflow (p. ej. `s3://bucket/1/<run>/artifacts/model`)
 * en la llave S3 relativa al bucket. Devuelve el source tal cual si no es s3://.
 */
export function s3KeyFromSource(source: string | null): string | null {
  if (!source) return null;
  const match = source.match(/^s3:\/\/[^/]+\/(.+)$/);
  return match ? match[1] : source;
}
