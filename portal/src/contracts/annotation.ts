import { z } from "zod";
import { type ImageRef, imageRefSchema, modelVersionSchema } from "./inference";

/**
 * Cola de anotación (T13).
 *
 * Equivale a las imágenes `pending` del portal del Proyecto 2: cada elemento es
 * una imagen que un anotador debe revisar, con la clase que sugirió el modelo.
 */

export const ANNOTATION_STATUSES = ["pending", "annotated", "discarded"] as const;
export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];

/** Cuerpo de POST /api/annotation-queue. */
export const createAnnotationItemSchema = z.object({
  image: imageRefSchema,
  modelVersion: modelVersionSchema,
  suggestedClass: z.string().min(1).max(128),
  probabilities: z
    .record(z.string().min(1).max(128), z.number().min(0).max(1))
    .refine((p) => Object.keys(p).length >= 2, "Se esperan probabilidades de al menos 2 clases"),
});

export type CreateAnnotationItemInput = z.infer<typeof createAnnotationItemSchema>;

export interface AnnotationQueueItem {
  id: string;
  status: AnnotationStatus;
  image: ImageRef;
  /** URL del portal para ver la imagen. */
  imageUrl: string;
  modelVersion: string;
  suggestedClass: string;
  probabilities: Record<string, number>;
  createdAt: string;
}

/** Respuesta de GET /api/annotation-queue. */
export interface ListAnnotationQueueResponse {
  items: AnnotationQueueItem[];
  counts: Record<AnnotationStatus, number>;
}
