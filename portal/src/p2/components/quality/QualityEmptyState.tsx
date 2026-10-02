interface QualityEmptyStateProps {
  message: string;
  title?: string;
}

/**
 * Estado "sin datos" explícito. Se distingue del error a propósito: que un
 * artefacto todavía no exista es normal durante el desarrollo, no una falla.
 *
 * Además del mensaje, muestra el comando exacto que genera los artefactos
 * (C-03.3): antes solo mandaba a /settings, que no resuelve nada.
 */
export function QualityEmptyState({ message, title = "Sin datos" }: QualityEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-16 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="max-w-lg text-sm text-ink-muted">{message}</p>
      <div className="mt-1 w-full max-w-md rounded-xl border border-border bg-canvas p-3 text-left">
        <p className="text-xs font-medium text-ink-muted">
          Genera los artefactos del pipeline y vuelve a intentar:
        </p>
        <pre className="mt-1 overflow-x-auto font-mono text-xs text-ink">
          <code>{"dvc pull -r prod && dvc repro\ndocker compose up --build"}</code>
        </pre>
        <p className="mt-2 text-xs text-ink-muted">
          Sin acceso a los remotos de DVC, genera datos de ejemplo con{" "}
          <code className="font-mono text-ink">make demo</code>.
        </p>
      </div>
    </div>
  );
}
