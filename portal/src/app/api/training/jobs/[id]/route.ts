import { NextResponse } from "next/server";
import { handleRouteError, notFound } from "@/lib/http";
import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/training/jobs/[id]
 * Estado y logs persistentes del job.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const job = await getJob(id);
    if (!job) throw notFound(`No existe el job "${id}"`);
    return NextResponse.json(job);
  } catch (err) {
    return handleRouteError(err);
  }
}
