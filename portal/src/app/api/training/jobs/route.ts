import { NextResponse } from "next/server";
import { type CreateTrainingJobResponse, createTrainingJobSchema } from "@/contracts";
import { badRequest, handleRouteError, parseOrThrow } from "@/lib/http";
import { createJob } from "@/lib/jobs";
import { enqueueTrainingJob } from "@/lib/queue";
import { toTrainerParams } from "@/lib/trainer-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/training/jobs
 * Valida release + 7 hiperparámetros + semillas, persiste el job en MariaDB
 * (estado `queued`) y lo encola en Redis para el worker.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const raw = await request.json().catch(() => {
      throw badRequest("El cuerpo debe ser JSON válido");
    });
    const { release, ...rest } = parseOrThrow(createTrainingJobSchema, raw, "cuerpo");

    // Persistimos primero: la tabla es la fuente de verdad del estado.
    const row = await createJob(release, rest);

    // Luego encolamos con la forma que espera worker.py: { id, params }.
    await enqueueTrainingJob({ id: row.id, params: toTrainerParams(release, rest) });

    const body: CreateTrainingJobResponse = {
      id: row.id,
      status: row.status,
      release: row.release,
      params: row.params,
      createdAt: row.createdAt.toISOString(),
    };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
