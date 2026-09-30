import type { JobStatus } from "@/contracts";

/** Cada cuánto consulta la UI GET /api/training/jobs/[id]. */
export const POLL_INTERVAL_MS = 3000;

const TERMINAL: readonly JobStatus[] = ["succeeded", "failed", "canceled"];

/** Un job terminado ya no cambia: se deja de consultar. */
export function isTerminal(status: JobStatus): boolean {
  return TERMINAL.includes(status);
}

export const STATUS_LABELS: Record<JobStatus, string> = {
  queued: "En cola",
  running: "Entrenando",
  succeeded: "Terminado",
  failed: "Falló",
  canceled: "Cancelado",
};
