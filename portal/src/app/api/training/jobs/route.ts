import { NextResponse } from "next/server";
import { type CreateTrainingJobResponse, createTrainingJobSchema } from "@/contracts";
import { env } from "@/lib/env";
import { badRequest, handleRouteError, parseOrThrow } from "@/lib/http";
import { createJob } from "@/lib/jobs";
import { enqueueTrainingJob } from "@/lib/queue";
import { requireApprovedRelease } from "@/lib/repo-artifacts";
import { toTrainerParams } from "@/lib/trainer-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/training/jobs
 * Valida release (aprobado por la compuerta de calidad) + hiperparámetros + semillas,
 * persiste el job en MariaDB
 * (estado `queued`) y lo encola en Redis para el worker.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const raw = await request.json().catch(() => {
      throw badRequest("El cuerpo debe ser JSON válido");
    });
    const { release, ...rest } = parseOrThrow(createTrainingJobSchema, raw, "cuerpo");

    // El release se valida ANTES de crear la fila: existe, pasó la compuerta de calidad
    // del Proyecto 2 y su manifiesto 70/20/10 ACTUAL (releído ahora, no su reporte) no
    // tiene cruces entre train, val y test. Si no, 400 y no hay job.
    const approved = await requireApprovedRelease(env.REPO_ROOT, release);

    // Persistimos primero: la tabla es la fuente de verdad del estado.
    const row = await createJob(release, rest);

    // Luego encolamos con la forma que espera worker.py: { id, params }.
    await enqueueTrainingJob({
      id: row.id,
      params: toTrainerParams(release, rest, approved.paths),
    });

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
