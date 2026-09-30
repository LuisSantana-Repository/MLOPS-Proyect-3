import type { MetricPoint } from "@/contracts";

/**
 * Geometría de la gráfica de curvas (SVG propio, sin librería de gráficas).
 * Todo es puro: recibe series y dimensiones, devuelve paths y marcas de ejes.
 */

export interface Series {
  name: string;
  points: MetricPoint[];
}

export interface ChartLayout {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

export interface ChartGeometry {
  empty: boolean;
  paths: { name: string; d: string; last: { x: number; y: number } | null }[];
  xTicks: { value: number; x: number }[];
  yTicks: { value: number; y: number }[];
}

export const DEFAULT_LAYOUT: ChartLayout = {
  width: 640,
  height: 300,
  padding: { top: 16, right: 16, bottom: 36, left: 56 },
};

/** Marcas "bonitas" (1, 2, 5 × 10^n) entre min y max. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}

export function buildChart(series: Series[], layout: ChartLayout = DEFAULT_LAYOUT): ChartGeometry {
  const all = series.flatMap((s) => s.points).filter((p) => Number.isFinite(p.value));
  if (all.length === 0) return { empty: true, paths: [], xTicks: [], yTicks: [] };

  const { width, height, padding } = layout;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  let xMin = Math.min(...all.map((p) => p.step));
  let xMax = Math.max(...all.map((p) => p.step));
  let yMin = Math.min(...all.map((p) => p.value));
  let yMax = Math.max(...all.map((p) => p.value));
  if (xMin === xMax) {
    xMin -= 1;
    xMax += 1;
  }
  if (yMin === yMax) {
    const pad = Math.abs(yMin) * 0.1 || 1;
    yMin -= pad;
    yMax += pad;
  }

  const sx = (step: number) => padding.left + ((step - xMin) / (xMax - xMin)) * innerW;
  const sy = (value: number) => padding.top + (1 - (value - yMin) / (yMax - yMin)) * innerH;
  const r = (n: number) => Math.round(n * 100) / 100;

  const paths = series.map((s) => {
    const pts = [...s.points]
      .filter((p) => Number.isFinite(p.value))
      .sort((a, b) => a.step - b.step);
    const d = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${r(sx(p.step))},${r(sy(p.value))}`)
      .join(" ");
    const lastPoint = pts.at(-1);
    return {
      name: s.name,
      d,
      last: lastPoint ? { x: r(sx(lastPoint.step)), y: r(sy(lastPoint.value)) } : null,
    };
  });

  return {
    empty: false,
    paths,
    xTicks: niceTicks(xMin, xMax, 6)
      .filter((v) => Number.isInteger(v))
      .map((v) => ({ value: v, x: r(sx(v)) })),
    yTicks: niceTicks(yMin, yMax, 5).map((v) => ({ value: v, y: r(sy(v)) })),
  };
}
