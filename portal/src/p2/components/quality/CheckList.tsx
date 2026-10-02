import type { CheckResult } from "../../api/quality";
import { QualityStatusBadge } from "./QualityStatusBadge";

function formatValue(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toLocaleString("es") : value.toFixed(2);
  }
  if (typeof value === "boolean") return value ? "sí" : "no";
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Lista de checks del gate con su umbral y su valor observado. `observed`
 * es un diccionario distinto por analizador, así que se renderiza de forma
 * genérica: el portal nunca inventa una cifra, solo pinta lo que el pipeline
 * reportó.
 */
export function CheckList({ checks }: { checks: CheckResult[] }) {
  if (checks.length === 0) {
    return <p className="text-sm text-ink-faint">El pipeline no reportó checks.</p>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-sidebar text-left text-xs uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-2.5 font-medium">Check</th>
            <th className="px-4 py-2.5 font-medium">Estado</th>
            <th className="px-4 py-2.5 font-medium">Umbral</th>
            <th className="px-4 py-2.5 font-medium">Observado</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check) => (
            <tr key={check.name} className="border-b border-border last:border-b-0">
              <td className="px-4 py-2.5 font-medium text-ink">{check.name}</td>
              <td className="px-4 py-2.5">
                <QualityStatusBadge status={check.status} />
              </td>
              <td className="px-4 py-2.5 text-ink-muted">{formatValue(check.threshold)}</td>
              <td className="px-4 py-2.5 text-ink-muted">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {Object.entries(check.observed).map(([key, value]) => (
                    <span key={key}>
                      <span className="text-ink-faint">{key}:</span> {formatValue(value)}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
