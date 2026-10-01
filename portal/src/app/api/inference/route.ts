import { NextResponse } from "next/server";
import {
  cropPathSchema,
  type ImageRef,
  type InferenceResponse,
  modelVersionSchema,
} from "@/contracts";
import { readCropImage } from "@/lib/crops";
import { env } from "@/lib/env";
import { badRequest, handleRouteError, parseOrThrow } from "@/lib/http";
import { storeUpload, uploadKey, validateUpload } from "@/lib/images";
import { predictImage } from "@/lib/inference";
import { checkPublication, requirePublishedRow } from "@/lib/published-models";
import { modelStore } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/inference  (multipart/form-data: `version` y `file` **o** `cropPath`)
 *
 * 1. Valida la versión: debe estar en `published_models` y su paquete existir en S3.
 * 2. Toma la imagen: un archivo nuevo (JPEG/PNG por firma de bytes, tamaño máximo)
 *    o un recorte de T03 del portal (`crops/<nombre>.jpg`, servido por T12).
 * 3. Reenvía al servicio de T10 (`POST /predict`), que usa los pesos publicados.
 * 4. Si es un archivo nuevo, lo guarda en MinIO para poder enviarlo a anotación;
 *    los recortes ya están versionados en DVC y se referencian por su `crop_path`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw badRequest(
        "Se esperaba multipart/form-data con 'version' y 'file' (imagen nueva) o 'cropPath' (recorte)",
      );
    }
    const version = parseOrThrow(modelVersionSchema, form.get("version"), "Versión de modelo");
    const cropField = form.get("cropPath");
    const fileField = form.get("file");
    if (cropField !== null && fileField !== null) {
      throw badRequest("Envía una imagen nueva ('file') o un recorte ('cropPath'), no ambos");
    }

    const row = await requirePublishedRow(version);
    const publication = await checkPublication(modelStore(), version);
    if (publication.status !== "published") {
      throw badRequest(
        `La versión ${version} no se puede usar: ${publication.message ?? "paquete incompleto en S3"}`,
      );
    }

    let image: ImageRef;
    let input: { bytes: Uint8Array; filename: string; contentType: string };
    let upload: Awaited<ReturnType<typeof validateUpload>> | null = null;
    if (cropField !== null) {
      const cropPath = parseOrThrow(cropPathSchema, cropField, "Recorte");
      const bytes = await readCropImage(env.REPO_ROOT, cropPath.split("/"));
      image = { kind: "crop", cropPath };
      input = { bytes, filename: cropPath.split("/")[1], contentType: "image/jpeg" };
    } else {
      upload = await validateUpload(fileField);
      image = {
        kind: "upload",
        key: uploadKey(upload),
        sha256: upload.sha256,
        contentType: upload.contentType,
      };
      input = upload;
    }

    const prediction = await predictImage({ version, ...input });
    if (upload) await storeUpload(upload);

    const body: InferenceResponse = {
      version: prediction.version,
      weightsSha256: row.sha256,
      predictedClass: prediction.predictedClass,
      probabilities: prediction.probabilities,
      image,
    };
    return NextResponse.json(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
