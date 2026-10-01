import { NextResponse } from "next/server";
import { z } from "zod";
import type { ListCropsResponse } from "@/contracts";
import { readCropCatalog } from "@/lib/crop-catalog";
import { env } from "@/lib/env";
import { handleRouteError, parseOrThrow } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  className: z.string().trim().min(1).nullable().default(null),
  split: z.string().trim().min(1).nullable().default(null),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(24),
});

/**
 * GET /api/crops?className=car&split=test&offset=0&limit=24
 * Recortes del manifiesto de T04 para elegir uno en /inference (T13).
 * Cada recorte se ve con GET /api/crops/<crop_path> (T12).
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const p = new URL(request.url).searchParams;
    const q = parseOrThrow(
      querySchema,
      {
        className: p.get("className"),
        split: p.get("split"),
        offset: p.get("offset") ?? undefined,
        limit: p.get("limit") ?? undefined,
      },
      "Consulta",
    );
    const all = await readCropCatalog(env.REPO_ROOT);
    const filtered = all.filter(
      (c) => (!q.className || c.className === q.className) && (!q.split || c.split === q.split),
    );
    const body: ListCropsResponse = {
      crops: filtered.slice(q.offset, q.offset + q.limit),
      total: filtered.length,
      classes: [...new Set(all.map((c) => c.className))].sort(),
      splits: [...new Set(all.map((c) => c.split))].sort(),
    };
    return NextResponse.json(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
