import type { ReactNode } from "react";

/**
 * Tarjeta pequeña de etiqueta + valor usada por todos los paneles de
 * analizadores, para que las cinco pestañas se vean consistentes.
 */
export function QualityStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
