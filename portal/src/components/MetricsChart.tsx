import { buildChart, DEFAULT_LAYOUT, type Series } from "@/lib/ui/chart";

const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"];

/** Curvas por época en SVG (sin librería de gráficas). */
export function MetricsChart({
  title,
  series,
  yLabel,
}: {
  title: string;
  series: Series[];
  yLabel: string;
}) {
  const g = buildChart(series);
  const { width, height, padding } = DEFAULT_LAYOUT;
  const bottom = height - padding.bottom;

  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      {g.empty ? (
        <p className="muted">Este run no registró {series.map((s) => s.name).join(" ni ")}.</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${title}-t`}>
            <title id={`${title}-t`}>{title}</title>
            {g.yTicks.map((t) => (
              <g key={`y${t.value}`}>
                <line
                  className="grid-line"
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={t.y}
                  y2={t.y}
                />
                <text
                  className="tick"
                  x={padding.left - 8}
                  y={t.y}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {t.value}
                </text>
              </g>
            ))}
            {g.xTicks.map((t) => (
              <text
                key={`x${t.value}`}
                className="tick"
                x={t.x}
                y={bottom + 18}
                textAnchor="middle"
              >
                {t.value}
              </text>
            ))}
            <line
              className="axis"
              x1={padding.left}
              x2={width - padding.right}
              y1={bottom}
              y2={bottom}
            />
            <text
              className="axis-label"
              x={(padding.left + width - padding.right) / 2}
              y={height - 2}
              textAnchor="middle"
            >
              época
            </text>
            <text
              className="axis-label"
              transform={`translate(12 ${height / 2}) rotate(-90)`}
              textAnchor="middle"
            >
              {yLabel}
            </text>
            {g.paths.map((p, i) => (
              <g key={p.name}>
                <path d={p.d} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={2} />
                {p.last ? (
                  <circle cx={p.last.x} cy={p.last.y} r={3} fill={COLORS[i % COLORS.length]} />
                ) : null}
              </g>
            ))}
          </svg>
          <ul className="legend">
            {g.paths.map((p, i) => (
              <li key={p.name}>
                <span className="swatch" style={{ background: COLORS[i % COLORS.length] }} />
                {p.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </figure>
  );
}
