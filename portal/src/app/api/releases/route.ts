import { NextResponse } from "next/server";
import type { ListReleasesResponse } from "@/contracts";
import { env } from "@/lib/env";
import { handleRouteError } from "@/lib/http";
import { readApprovedReleases } from "@/lib/repo-artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/releases
 * Releases DVC aprobados con su procedencia (hashes, commit del Proyecto 2)
 * y el split 70/20/10 de T04. Se leen de los artefactos versionados en Git.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const body: ListReleasesResponse = { releases: await readApprovedReleases(env.REPO_ROOT) };
    return NextResponse.json(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
