import Redis from "ioredis";
import type { CreateTrainingJobParams } from "@/contracts";
import { env } from "@/lib/env";
import { upstreamError } from "@/lib/http";

/**
 * Cola de jobs sobre Redis. `worker.py` hace `blpop('ml_jobs')` y espera un
 * JSON `{ id, params }`, así que publicamos exactamente esa forma con `rpush`
 * (FIFO junto con blpop).
 */

const globalForRedis = globalThis as unknown as { __portalRedis?: Redis };

function getClient(): Redis {
  if (!globalForRedis.__portalRedis) {
    globalForRedis.__portalRedis = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
    // Evita que un error de conexión tire el proceso; se reporta al encolar.
    globalForRedis.__portalRedis.on("error", (err) => {
      console.error("[redis] error de conexión:", err.message);
    });
  }
  return globalForRedis.__portalRedis;
}

export interface QueuedJob {
  id: string;
  params: CreateTrainingJobParams & { release: string };
}

/** Encola un job para el worker. Lanza ApiError 502 si Redis no responde. */
export async function enqueueTrainingJob(job: QueuedJob): Promise<void> {
  try {
    await getClient().rpush(env.ML_JOBS_QUEUE, JSON.stringify(job));
  } catch (cause) {
    throw upstreamError(
      `No se pudo encolar el job en Redis (${env.REDIS_HOST}:${env.REDIS_PORT}): ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}
