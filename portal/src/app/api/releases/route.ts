import { NextResponse } from "next/server";
import type { ListReleasesResponse } from "@/contracts";
import { env } from "@/lib/env";
import { handleRouteError } from "@/lib/http";
import { readApprovedReleases } from "@/lib/repo-artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/releases
 * Releases del Proyecto 2 con compuerta de calidad APROBADA: procedencia (hashes, commit),
 * evidencia de la compuerta (reporte y política) y el split 70/20/10 de T04.
 * Un release con compuerta fallida o sin reporte no aparece.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const body: ListReleasesResponse = { releases: await readApprovedReleases(env.REPO_ROOT) };
    return NextResponse.json(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
