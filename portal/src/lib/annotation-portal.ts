import { basename } from "node:path";
import { z } from "zod";
import type { AnnotationSubmission, ImageRef, SendToAnnotationInput } from "@/contracts";
import { readCropImage } from "@/lib/crops";
import { env } from "@/lib/env";
import { ApiError, badRequest, upstreamError } from "@/lib/http";
import { requirePublishedRow } from "@/lib/published-models";
import { annotationStore, getObjectBytes } from "@/lib/s3";

/**
 * «Enviar a anotación» (P0-3): registra la imagen clasificada en el portal de
 * anotación del Proyecto 1 a través de su API (`POST /images` de annotation-api),
 * con la clase sugerida y las probabilidades como metadato. La imagen queda
 * `pending` y se anota desde `/annotate/<id>`, igual que una subida manual.
 */

const createdImageSchema = z.object({
  id: z.number().int().positive(),
  filename: z.string(),
  status: z.literal("pending"),
});

interface ImageFile {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

const NOT_FOUND = "La imagen no existe: vuelve a clasificarla antes de enviarla";

/** Bytes de la imagen que se clasificó: subida (MinIO) o recorte del repo. */
async function readClassifiedImage(image: ImageRef): Promise<ImageFile> {
  if (image.kind === "upload") {
    const bytes = await getObjectBytes(annotationStore(), image.key);
    if (!bytes) throw badRequest(NOT_FOUND, { image: ["No encontrada"] });
    const ext = image.contentType === "image/png" ? "png" : "jpg";
    return {
      bytes,
      contentType: image.contentType,
      filename: `inference-${image.sha256.slice(0, 12)}.${ext}`,
    };
  }
  try {
    const bytes = await readCropImage(env.REPO_ROOT, image.cropPath.split("/"));
    return { bytes, contentType: "image/jpeg", filename: basename(image.cropPath) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw badRequest(NOT_FOUND, { image: ["No encontrada"] });
    }
    throw err;
  }
}

async function backendMessage(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return `HTTP ${res.status}`;
}

export async function sendToAnnotation(
  input: SendToAnnotationInput,
  fetchImpl: typeof fetch = fetch,
): Promise<AnnotationSubmission> {
  await requirePublishedRow(input.modelVersion);

  const top = Object.entries(input.probabilities).sort((a, b) => b[1] - a[1])[0];
  if (!(input.suggestedClass in input.probabilities) || top[0] !== input.suggestedClass) {
    throw badRequest("La clase sugerida debe ser la de mayor probabilidad", {
      suggestedClass: [`Se esperaba ${top[0]}`],
    });
  }

  const file = await readClassifiedImage(input.image);

  // Mismo endpoint multipart que usa «Subir fotografías», más la sugerencia del modelo.
  const form = new FormData();
  form.append(
    "image",
    new Blob([new Uint8Array(file.bytes)], { type: file.contentType }),
    file.filename,
  );
  form.append("suggestedCategory", input.suggestedClass);
  form.append("suggestedProbabilities", JSON.stringify(input.probabilities));
  form.append("suggestedModelVersion", input.modelVersion);

  let res: Response;
  try {
    res = await fetchImpl(`${env.ANNOTATION_API_URL}/images`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(env.ANNOTATION_API_TIMEOUT_MS),
    });
  } catch {
    throw upstreamError(
      "No se pudo contactar al portal de anotación (¿está arriba el servicio annotation-api?)",
    );
  }
  if (!res.ok) {
    throw upstreamError(`El portal de anotación rechazó la imagen: ${await backendMessage(res)}`);
  }

  const created = createdImageSchema.safeParse(await res.json().catch(() => null));
  if (!created.success) {
    throw upstreamError("El portal de anotación respondió con un formato inesperado");
  }

  return {
    imageId: created.data.id,
    filename: created.data.filename,
    status: created.data.status,
    modelVersion: input.modelVersion,
    suggestedClass: input.suggestedClass,
    probabilities: input.probabilities,
    annotateUrl: `/annotate/${created.data.id}`,
    pendingUrl: "/search?status=pending",
  };
}
