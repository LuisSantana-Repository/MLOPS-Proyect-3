import type { CSSProperties } from "react";
import type { TestEvaluation } from "@/contracts";
import { formatPercent, heatmapRows } from "@/lib/ui/evaluation";

/**
 * Matriz de confusión como tabla: filas = clase real, columnas = predicha.
 * La intensidad del color es la proporción dentro de la fila, pero cada celda lleva
 * su número y una etiqueta accesible, así que no depende solo del color.
 */
export function ConfusionHeatmap({ confusion }: { confusion: TestEvaluation["confusionMatrix"] }) {
  const rows = heatmapRows(confusion);
  return (
    <table className="table heatmap">
      <caption className="muted">Filas: clase real · Columnas: clase predicha</caption>
      <thead>
        <tr>
          <th scope="col">Real \ Predicha</th>
          {confusion.labels.map((label) => (
            <th key={label} scope="col" className="num">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            {row.cells.map((cell) => (
              <td
                key={cell.predicted}
                className={`num heat ${cell.correct ? "heat-ok" : "heat-bad"}`}
                style={{ "--share": cell.share.toFixed(3) } as CSSProperties}
                aria-label={`real ${row.label}, predicha ${cell.predicted}: ${cell.value} (${formatPercent(cell.share)} de ${row.label})`}
              >
                {cell.value}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
