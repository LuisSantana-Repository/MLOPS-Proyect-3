import { INFERENCE_LIMITS, type ModelVersionInfo, type PublicationStatus } from "@/contracts";

/** Lógica de presentación de /models e /inference (T13), sin React para poder probarla. */

export function shortHash(hash: string | null, length = 12): string {
  return hash ? hash.slice(0, length) : "—";
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().replace("T", " ").slice(0, 16);
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)} %`;
}

export const PUBLICATION_LABELS: Record<PublicationStatus, { text: string; className: string }> = {
  published: { text: "Publicado en S3", className: "status-succeeded" },
  incomplete: { text: "Incompleto en S3", className: "status-failed" },
  unverified: { text: "Sin verificar", className: "status-queued" },
};

/** Solo las versiones cuyo paquete se verificó completo en S3 sirven para inferencia. */
export function usableVersions(models: ModelVersionInfo[]): ModelVersionInfo[] {
  return models.filter((m) => m.publication.status === "published");
}

/** Versión pedida (p. ej. ?version=) si es usable; si no, la publicada más reciente. */
export function pickVersion(models: ModelVersionInfo[], requested: string | null): string | null {
  const usable = usableVersions(models);
  if (requested && usable.some((m) => m.version === requested)) return requested;
  return usable[0]?.version ?? null;
}

const MAX_MB = INFERENCE_LIMITS.maxBytes / (1024 * 1024);

/** Validación previa en el navegador (el servidor vuelve a validar por firma de bytes). */
export function validateImageFile(file: { size: number; type: string } | null): string | null {
  if (!file) return "Elige una imagen JPEG o PNG";
  if (file.size === 0) return "La imagen está vacía";
  if (file.size > INFERENCE_LIMITS.maxBytes) return `La imagen pesa más de ${MAX_MB} MB`;
  if (!(INFERENCE_LIMITS.mimeTypes as readonly string[]).includes(file.type)) {
    return "Solo se aceptan imágenes JPEG o PNG";
  }
  return null;
}

export function inferenceHref(version: string): string {
  return `/inference?version=${encodeURIComponent(version)}`;
}

export function downloadHref(version: string, file: string): string {
  return `/api/models/${encodeURIComponent(version)}/files/${encodeURIComponent(file)}`;
}

/** Query de GET /api/crops sin parámetros vacíos. */
export function cropsQuery(q: {
  className: string | null;
  split: string | null;
  offset: number;
  limit: number;
}): string {
  const params = new URLSearchParams({ offset: String(q.offset), limit: String(q.limit) });
  if (q.className) params.set("className", q.className);
  if (q.split) params.set("split", q.split);
  return params.toString();
}

export type InferenceSource = "upload" | "crop";
