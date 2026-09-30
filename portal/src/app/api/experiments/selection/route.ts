import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { handleRouteError } from "@/lib/http";
import { readCandidateSelection } from "@/lib/repo-artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/experiments/selection
 * Run candidato congelado por T07 (criterio predeclarado sobre validación).
 */
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await readCandidateSelection(env.REPO_ROOT));
  } catch (err) {
    return handleRouteError(err);
  }
}
