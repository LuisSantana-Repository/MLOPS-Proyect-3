import { z } from "zod";
import { imageRefSchema, modelVersionSchema } from "./inference";

/**
 * «Enviar a anotación» desde Inference (P0-3).
 *
 * La imagen clasificada entra al flujo de anotación del portal (Proyecto 1): se
 * registra en su tabla `images` como `pending`, con la clase sugerida por el modelo
 * y sus probabilidades como metadato, y se anota desde la pantalla de anotación de
 * siempre (`/annotate/<id>`). No existe una cola aparte.
 */

/** Cuerpo de POST /api/annotation. */
export const sendToAnnotationSchema = z.object({
  image: imageRefSchema,
  modelVersion: modelVersionSchema,
  suggestedClass: z.string().min(1).max(128),
  probabilities: z
    .record(z.string().min(1).max(128), z.number().min(0).max(1))
    .refine((p) => Object.keys(p).length >= 2, "Se esperan probabilidades de al menos 2 clases"),
});

export type SendToAnnotationInput = z.infer<typeof sendToAnnotationSchema>;

/** Respuesta de POST /api/annotation: la imagen ya registrada en el portal de anotación. */
export interface AnnotationSubmission {
  /** Id de la imagen en el portal de anotación (tabla `images`). */
  imageId: number;
  filename: string;
  /** Toda imagen nueva entra pendiente de anotar. */
  status: "pending";
  modelVersion: string;
  suggestedClass: string;
  probabilities: Record<string, number>;
  /** Pantalla de anotación de esa imagen. */
  annotateUrl: string;
  /** Búsqueda del portal filtrada a las imágenes pendientes. */
  pendingUrl: string;
}
