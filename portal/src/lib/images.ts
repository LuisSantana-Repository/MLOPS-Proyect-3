import { createHash } from "node:crypto";
import { INFERENCE_LIMITS, type InferenceMimeType } from "@/contracts";
import { badRequest } from "@/lib/http";
import { annotationStore, ensureAnnotationBucket, putObject } from "@/lib/s3";

/**
 * Validación y almacenamiento de imágenes subidas desde /inference (T13).
 *
 * El tipo se decide por la firma de los bytes, no por el `Content-Type` que manda
 * el navegador: un .txt renombrado a .jpg se rechaza antes de llegar al modelo.
 */

const SIGNATURES: { type: InferenceMimeType; ext: "jpg" | "png"; magic: number[] }[] = [
  { type: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  { type: "image/png", ext: "png", magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

export function sniffImageType(bytes: Uint8Array): (typeof SIGNATURES)[number] | null {
  return SIGNATURES.find((s) => s.magic.every((b, i) => bytes[i] === b)) ?? null;
}

export interface ValidatedImage {
  bytes: Uint8Array;
  contentType: InferenceMimeType;
  ext: "jpg" | "png";
  sha256: string;
  filename: string;
}

const MAX_MB = INFERENCE_LIMITS.maxBytes / (1024 * 1024);

/** Valida tamaño y tipo real de la imagen; lanza 400 con un mensaje para el usuario. */
export async function validateUpload(file: unknown): Promise<ValidatedImage> {
  if (!(file instanceof Blob)) {
    throw badRequest("Falta la imagen: envía un archivo en el campo 'file'", {
      file: ["Requerido"],
    });
  }
  if (file.size === 0) throw badRequest("La imagen está vacía", { file: ["Archivo vacío"] });
  if (file.size > INFERENCE_LIMITS.maxBytes) {
    throw badRequest(`La imagen pesa más de ${MAX_MB} MB`, {
      file: [`Máximo ${MAX_MB} MB; recibido ${(file.size / (1024 * 1024)).toFixed(1)} MB`],
    });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImageType(bytes);
  if (!kind) {
    throw badRequest("Tipo de archivo no soportado: solo JPEG o PNG", {
      file: [`Tipos permitidos: ${INFERENCE_LIMITS.mimeTypes.join(", ")}`],
    });
  }
  const name = "name" in file && typeof file.name === "string" && file.name ? file.name : null;
  return {
    bytes,
    contentType: kind.type,
    ext: kind.ext,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    filename: name ?? `imagen.${kind.ext}`,
  };
}

/** Llave estable por contenido: subir dos veces la misma imagen no la duplica. */
export function uploadKey(image: Pick<ValidatedImage, "sha256" | "ext">): string {
  return `uploads/${image.sha256}.${image.ext}`;
}

/** Guarda la imagen en el bucket de anotación de MinIO y devuelve su llave. */
export async function storeUpload(image: ValidatedImage): Promise<string> {
  const store = annotationStore();
  await ensureAnnotationBucket(store);
  const key = uploadKey(image);
  await putObject(store, key, image.bytes, image.contentType);
  return key;
}
