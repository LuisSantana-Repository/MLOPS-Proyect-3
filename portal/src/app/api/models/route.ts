import { NextResponse } from "next/server";
import type { ListModelsResponse, ModelVersionInfo } from "@/contracts";
import { handleRouteError } from "@/lib/http";
import { getRun, s3KeyFromSource, searchModelVersions } from "@/lib/mlflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tag del run de origen donde `trainer/tracking.py` guarda el hash de pesos. */
const WEIGHTS_TAG = "weights_sha256";

/**
 * GET /api/models
 * Versiones de modelo del Model Registry de MLflow: versión, run de origen,
 * llave S3 (MinIO) del artefacto y hash de los pesos.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const versions = await searchModelVersions();

    // El hash vive como tag del run de origen; lo resolvemos una vez por run.
    const runCache = new Map<string, string | null>();
    async function weightsHash(mv: (typeof versions)[number]): Promise<string | null> {
      if (mv.tags[WEIGHTS_TAG]) return mv.tags[WEIGHTS_TAG];
      if (!mv.runId) return null;
      if (!runCache.has(mv.runId)) {
        const run = await getRun(mv.runId);
        runCache.set(mv.runId, run?.tags[WEIGHTS_TAG] ?? null);
      }
      return runCache.get(mv.runId) ?? null;
    }

    const models: ModelVersionInfo[] = await Promise.all(
      versions.map(async (mv) => ({
        name: mv.name,
        version: mv.version,
        stage: mv.stage,
        status: mv.status,
        runId: mv.runId,
        s3Key: s3KeyFromSource(mv.source),
        weightsSha256: await weightsHash(mv),
        creationTimestamp: mv.creationTimestamp,
        lastUpdatedTimestamp: mv.lastUpdatedTimestamp,
        description: mv.description,
      })),
    );

    const body: ListModelsResponse = { models };
    return NextResponse.json(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
