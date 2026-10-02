import type { CategoryRef, SpatialBiasReport, SpatialStats } from "../../../api/quality";
import { QualityStat } from "../QualityStat";

function StatsTable({ title, stats }: { title: string; stats: SpatialStats }) {
  const rows: Array<[string, number, number]> = [
    ["Media", stats.mean_x, stats.mean_y],
    ["Mediana", stats.median_x, stats.median_y],
    ["Desviación", stats.std_x, stats.std_y],
    ["Percentil 25", stats.p25_x, stats.p25_y],
    ["Percentil 75", stats.p75_x, stats.p75_y],
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
      <div className="border-b border-border bg-sidebar px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {title}
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-2 font-medium">Estadístico</th>
            <th className="px-4 py-2 font-medium">Centro X</th>
            <th className="px-4 py-2 font-medium">Centro Y</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, x, y]) => (
            <tr key={label} className="border-b border-border last:border-b-0">
              <td className="px-4 py-2 font-medium text-ink">{label}</td>
              <td className="px-4 py-2 text-ink-muted">{x.toFixed(3)}</td>
              <td className="px-4 py-2 text-ink-muted">{y.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SCATTER_COLORS = ["#7C6FEA", "#2FAF87", "#B08900", "#4A6FE0", "#C2410C", "#9333EA"];

/**
 * Scatter SVG de los centros normalizados por categoría. Punto = centro
 * medio; caja = rango intercuartílico (p25–p75). Es un gráfico real, no un
 * adorno: se ve dónde se concentran los objetos de cada clase.
 */
function SpatialScatter({
  entries,
  names,
}: {
  entries: Array<[string, SpatialStats]>;
  names: Map<number, string>;
}) {
  const size = 320;
  const pad = 32;
  const inner = size - 2 * pad;
  const toX = (value: number) => pad + value * inner;
  const toY = (value: number) => size - pad - value * inner;

  return (
    <svg
      data-testid="spatial-scatter"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Dispersión de los centros normalizados por categoría"
      className="mx-auto h-auto w-full max-w-sm"
    >
      <rect x={pad} y={pad} width={inner} height={inner} fill="#FAFAF9" stroke="#DDE3E9" />
      <line
        x1={toX(0.5)}
        y1={pad}
        x2={toX(0.5)}
        y2={size - pad}
        stroke="#E7E5E1"
        strokeDasharray="3 3"
      />
      <line
        x1={pad}
        y1={toY(0.5)}
        x2={size - pad}
        y2={toY(0.5)}
        stroke="#E7E5E1"
        strokeDasharray="3 3"
      />

      {entries.map(([categoryId, stats], index) => {
        const color = SCATTER_COLORS[index % SCATTER_COLORS.length] ?? "#7C6FEA";
        const name = names.get(Number(categoryId)) ?? `#${categoryId}`;
        const boxX = Math.min(toX(stats.p25_x), toX(stats.p75_x));
        const boxY = Math.min(toY(stats.p25_y), toY(stats.p75_y));
        const boxWidth = Math.max(2, Math.abs(toX(stats.p75_x) - toX(stats.p25_x)));
        const boxHeight = Math.max(2, Math.abs(toY(stats.p25_y) - toY(stats.p75_y)));
        return (
          <g key={categoryId}>
            <rect
              x={boxX}
              y={boxY}
              width={boxWidth}
              height={boxHeight}
              fill={color}
              fillOpacity={0.15}
              stroke={color}
            />
            <circle cx={toX(stats.mean_x)} cy={toY(stats.mean_y)} r={5} fill={color} />
            <text x={toX(stats.mean_x) + 8} y={toY(stats.mean_y) - 6} fontSize="10" fill="#333333">
              {name}
            </text>
          </g>
        );
      })}

      <text x={pad} y={size - 10} fontSize="9" fill="#8A8782">
        0
      </text>
      <text x={size - pad - 4} y={size - 10} fontSize="9" fill="#8A8782">
        1
      </text>
    </svg>
  );
}

export function SpatialBiasPanel({
  report,
  categories,
}: {
  report: SpatialBiasReport;
  categories: CategoryRef[];
}) {
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const entries = Object.entries(report.stats_by_category);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <QualityStat label="Objetos medidos" value={report.global_stats.count} />
        <QualityStat label="Centro medio X" value={report.global_stats.mean_x.toFixed(3)} />
        <QualityStat label="Centro medio Y" value={report.global_stats.mean_y.toFixed(3)} />
        <QualityStat label="Dispersión X" value={report.global_stats.std_x.toFixed(3)} />
        <QualityStat label="Umbral" value={report.threshold} />
        <QualityStat label="Severidad" value={report.severity} />
      </div>

      <StatsTable title="Estadística global (centro normalizado 0–1)" stats={report.global_stats} />

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <h3 className="mb-3 text-sm font-medium text-ink">Centro medio por categoría</h3>
        <SpatialScatter entries={entries} names={names} />
        <p className="mt-2 text-center text-xs text-ink-faint">
          Punto = centro medio; caja = rango intercuartílico (p25–p75). Coordenadas normalizadas 0–1
          sobre el tamaño de cada imagen.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {entries.map(([categoryId, stats]) => (
          <StatsTable
            key={categoryId}
            title={`Categoría ${names.get(Number(categoryId)) ?? `#${categoryId}`} (${stats.count} objetos)`}
            stats={stats}
          />
        ))}
      </div>
    </div>
  );
}
