import { z } from "zod";
import type { ClassProbability } from "@/contracts";
import { env } from "@/lib/env";
import { ApiError, badRequest, notFound, upstreamError } from "@/lib/http";

/**
 * Cliente del servicio de inferencia de T10 (`POST /predict`).
 *
 * La predicción sale de los pesos que el servicio descarga de S3 y carga con
 * `trainer.load_model`; aquí solo se reenvía la imagen y se valida que la
 * respuesta sea coherente antes de mostrarla.
 */

/** Tolerancia para la suma de probabilidades (softmax en float32). */
export const PROBABILITY_SUM_TOLERANCE = 1e-3;

const predictResponseSchema = z.object({
  version: z.string(),
  predicted_class: z.string(),
  probabilities: z.record(z.string(), z.number().min(0).max(1)),
});

export interface Prediction {
  version: string;
  predictedClass: string;
  probabilities: ClassProbability[];
}

/** Valida la respuesta del servicio; cualquier incoherencia es un 502 (no se muestra). */
export function parsePrediction(body: unknown, requestedVersion: string): Prediction {
  const parsed = predictResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw upstreamError("El servicio de inferencia respondió con una forma inesperada");
  }
  const { version, predicted_class, probabilities } = parsed.data;
  if (version !== requestedVersion) {
    throw upstreamError(
      `El servicio usó la versión ${version} en lugar de la pedida (${requestedVersion})`,
    );
  }
  const entries = Object.entries(probabilities);
  if (entries.length < 2) {
    throw upstreamError("El servicio devolvió probabilidades de menos de 2 clases");
  }
  const sum = entries.reduce((acc, [, p]) => acc + p, 0);
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
    throw upstreamError(`Las probabilidades suman ${sum.toFixed(4)}, no 1`);
  }
  const sorted = entries
    .map(([className, probability]) => ({ className, probability }))
    .sort((a, b) => b.probability - a.probability);
  if (sorted[0].className !== predicted_class) {
    throw upstreamError(
      `La clase predicha (${predicted_class}) no es la de mayor probabilidad (${sorted[0].className})`,
    );
  }
  return { version, predictedClass: predicted_class, probabilities: sorted };
}

async function detailOf(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { detail?: unknown };
    return typeof body.detail === "string" ? body.detail : text;
  } catch {
    return text || `${res.status} ${res.statusText}`;
  }
}

export async function predictImage(input: {
  version: string;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}): Promise<Prediction> {
  const form = new FormData();
  form.set("version", input.version);
  form.set(
    "file",
    new Blob([new Uint8Array(input.bytes)], { type: input.contentType }),
    input.filename,
  );

  let res: Response;
  try {
    res = await fetch(`${env.INFERENCE_URL}/predict`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(env.INFERENCE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (cause) {
    throw upstreamError(
      `El servicio de inferencia no responde en ${env.INFERENCE_URL} ` +
        `(¿docker compose up -d inference?): ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (!res.ok) {
    const detail = await detailOf(res);
    if (res.status === 404) throw notFound(`Modelo no disponible en S3: ${detail}`);
    if (res.status === 400 || res.status === 422) throw badRequest(`Imagen rechazada: ${detail}`);
    if (res.status === 502) {
      throw new ApiError(502, "integrity_error", `El modelo no pasó la verificación: ${detail}`);
    }
    throw upstreamError(`El servicio de inferencia respondió ${res.status}: ${detail}`);
  }
  return parsePrediction(await res.json().catch(() => null), input.version);
}
