import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { CreateTrainingJobParams, JobLogEntry, TrainingJobResponse } from "@/contracts";
import { getDb } from "@/lib/db/client";
import type { TrainingJobRow } from "@/lib/db/schema";
import { trainingJobs } from "@/lib/db/schema";

/**
 * Repositorio de jobs de entrenamiento. Aísla el acceso Drizzle del route
 * handler y mapea la fila de MariaDB a la forma del contrato T09.
 */

function toResponse(row: TrainingJobRow): TrainingJobResponse {
  return {
    id: row.id,
    status: row.status,
    release: row.release,
    params: row.params,
    runId: row.runId ?? null,
    error: row.error ?? null,
    logs: row.logs ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Crea un job en estado `queued` y devuelve la fila insertada. */
export async function createJob(
  release: string,
  params: CreateTrainingJobParams,
): Promise<TrainingJobRow> {
  const db = getDb();
  const id = randomUUID();
  const now = new Date();
  const logs: JobLogEntry[] = [
    { ts: now.toISOString(), level: "info", message: `Job encolado para el release ${release}` },
  ];

  await db.insert(trainingJobs).values({
    id,
    status: "queued",
    release,
    params,
    logs,
    createdAt: now,
    updatedAt: now,
  });

  const row = await getJobRow(id);
  if (!row) throw new Error("El job se insertó pero no pudo releerse");
  return row;
}

export async function getJobRow(id: string): Promise<TrainingJobRow | null> {
  const db = getDb();
  const rows = await db.select().from(trainingJobs).where(eq(trainingJobs.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Devuelve el job en forma de contrato, o null si no existe. */
export async function getJob(id: string): Promise<TrainingJobResponse | null> {
  const row = await getJobRow(id);
  return row ? toResponse(row) : null;
}

export { toResponse as jobRowToResponse };
