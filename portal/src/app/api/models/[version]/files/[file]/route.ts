import { NextResponse } from "next/server";
import { z } from "zod";
import { modelVersionSchema } from "@/contracts";
import { handleRouteError, notFound, parseOrThrow } from "@/lib/http";
import { requirePublishedRow } from "@/lib/published-models";
import {
  MODEL_CARD_FILE,
  MODEL_PACKAGE_FILES,
  modelKey,
  modelStore,
  objectExists,
  presignedGetUrl,
} from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fileSchema = z.enum([...MODEL_PACKAGE_FILES, MODEL_CARD_FILE], {
  error: `Archivo no descargable; permitidos: ${[...MODEL_PACKAGE_FILES, MODEL_CARD_FILE].join(", ")}`,
});

/**
 * GET /api/models/[version]/files/[file]
 * Redirige (302) a una URL firmada de S3 para descargar un archivo del paquete
 * publicado. Solo archivos del paquete y solo si existen de verdad en el bucket.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ version: string; file: string }> },
): Promise<NextResponse> {
  try {
    const raw = await params;
    const version = parseOrThrow(modelVersionSchema, raw.version, "Versión");
    const file = parseOrThrow(fileSchema, raw.file, "Archivo");
    const row = await requirePublishedRow(version);
    const store = modelStore();
    const key = modelKey(version, file, row.name);
    if (!(await objectExists(store, key))) {
      throw notFound(`${file} de la versión ${version} no existe en ${store.label}`);
    }
    const url = await presignedGetUrl(store, key, `${row.name}-${version}-${file}`);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    return handleRouteError(err);
  }
}
