import { z } from "zod";

/**
 * Contrato de inferencia (T13).
 *
 * El portal valida la imagen y reenvía al servicio `POST /predict` de T10, que
 * descarga la versión publicada de S3, verifica su hash y la carga con
 * `trainer.load_model` (mismo preprocesamiento que la evaluación).
 */

export const INFERENCE_LIMITS = {
  /** Tamaño máximo de una imagen subida. */
  maxBytes: 5 * 1024 * 1024,
  mimeTypes: ["image/jpeg", "image/png"] as const,
} as const;

export type InferenceMimeType = (typeof INFERENCE_LIMITS.mimeTypes)[number];

/** Versión semántica de modelo publicada por T10 (`MAJOR.MINOR.PATCH`). */
export const modelVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "La versión de modelo debe tener la forma MAJOR.MINOR.PATCH");

/** Recorte de T03 (`crops/<image_id>_<ann_id>.jpg`). */
export const cropPathSchema = z
  .string()
  .regex(/^crops\/[A-Za-z0-9_-]+\.jpe?g$/, "Recorte inválido: se espera crops/<nombre>.jpg");

/** De dónde salió la imagen que se clasificó. */
export const imageRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("upload"),
    /** Llave en el bucket de imágenes de anotación (MinIO). */
    key: z.string().regex(/^uploads\/[0-9a-f]{64}\.(jpg|png)$/, "Llave de imagen inválida"),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    contentType: z.enum(INFERENCE_LIMITS.mimeTypes),
  }),
  z.object({
    kind: z.literal("crop"),
    cropPath: cropPathSchema,
  }),
]);

export type ImageRef = z.infer<typeof imageRefSchema>;

export interface ClassProbability {
  className: string;
  probability: number;
}

/** Respuesta de POST /api/inference. */
export interface InferenceResponse {
  /** Versión del modelo que se usó realmente (la que respondió el servicio). */
  version: string;
  /** SHA-256 de los pesos de esa versión, según `published_models`. */
  weightsSha256: string;
  predictedClass: string;
  /** Probabilidades por clase, ordenadas de mayor a menor (suman ≈ 1). */
  probabilities: ClassProbability[];
  image: ImageRef;
}

/** Un recorte de T03 que se puede clasificar desde /inference. */
export interface CropInfo {
  cropPath: string;
  className: string;
  /** Partición del manifiesto 70/20/10 de T04 (train/val/test). */
  split: string;
  imageId: string;
  annId: string;
  /** URL del portal para ver el recorte (`GET /api/crops/...` de T12). */
  url: string;
  /**
   * Coordenadas de origen en la imagen del release (P2-1, `crops_source_boxes.csv`):
   * la caja COCO y el rectángulo recortado. null si el archivo no está disponible.
   */
  sourceBox: CropSourceBox | null;
}

/** Caja COCO de origen `[x, y, w, h]` y rectángulo recortado (floor/ceil) de un recorte. */
export interface CropSourceBox {
  categoryId: number;
  bbox: { x: number; y: number; w: number; h: number };
  crop: { left: number; top: number; right: number; bottom: number };
}

/** Respuesta de GET /api/crops. */
export interface ListCropsResponse {
  crops: CropInfo[];
  total: number;
  classes: string[];
  splits: string[];
}
