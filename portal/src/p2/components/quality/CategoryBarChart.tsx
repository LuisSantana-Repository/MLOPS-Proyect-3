import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface CategoryBarDatum {
  name: string;
  value: number;
}

/**
 * Gráfica de barras por categoría compartida por los paneles. Alimentada
 * siempre con los valores que devolvió el analizador, nunca con una paleta
 * ni cifras inventadas.
 */
export function CategoryBarChart({
  data,
  valueLabel,
  color = "#7C6FEA",
}: {
  data: CategoryBarDatum[];
  valueLabel: string;
  color?: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-2xl border border-border bg-surface text-sm text-ink-faint">
        Sin categorías para graficar.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
      <h3 className="mb-3 text-sm font-medium text-ink">{valueLabel}</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E7E5E1" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: "#8A8782" }}
              axisLine={{ stroke: "#E7E5E1" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#8A8782" }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip
              cursor={{ fill: "#F5F4F1" }}
              contentStyle={{ borderRadius: 12, border: "1px solid #E7E5E1", fontSize: 12 }}
            />
            <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
