import { describe, expect, it } from "vitest";
import { buildChart, DEFAULT_LAYOUT, niceTicks } from "./chart";

const pts = (values: number[]) => values.map((value, i) => ({ step: i + 1, value, timestamp: 0 }));

describe("niceTicks", () => {
  it("genera marcas redondas dentro del rango", () => {
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.5, 1]);
    expect(niceTicks(0.03, 0.31, 5)).toEqual([0.1, 0.2, 0.3]);
  });

  it("rango de un solo valor", () => {
    expect(niceTicks(2, 2)).toEqual([2]);
  });
});

describe("buildChart", () => {
  it("sin puntos es un estado vacío", () => {
    expect(buildChart([{ name: "val_loss", points: [] }]).empty).toBe(true);
  });

  it("una línea por serie, dentro del área de dibujo", () => {
    const g = buildChart([
      { name: "train_loss", points: pts([0.9, 0.5, 0.3]) },
      { name: "val_loss", points: pts([0.8, 0.6, 0.4]) },
    ]);
    expect(g.empty).toBe(false);
    expect(g.paths.map((p) => p.name)).toEqual(["train_loss", "val_loss"]);
    const { width, height, padding } = DEFAULT_LAYOUT;
    for (const p of g.paths) {
      expect(p.d.startsWith("M")).toBe(true);
      expect(p.d.split(" ")).toHaveLength(3);
      for (const [x, y] of p.d.split(" ").map((s) => s.slice(1).split(",").map(Number))) {
        expect(x).toBeGreaterThanOrEqual(padding.left);
        expect(x).toBeLessThanOrEqual(width - padding.right);
        expect(y).toBeGreaterThanOrEqual(padding.top);
        expect(y).toBeLessThanOrEqual(height - padding.bottom);
      }
    }
  });

  it("la pérdida más alta queda más arriba en pantalla (y menor)", () => {
    const g = buildChart([{ name: "loss", points: pts([1, 0]) }]);
    const [first, second] = g.paths[0].d.split(" ").map((s) => Number(s.split(",")[1]));
    expect(first).toBeLessThan(second);
  });

  it("ordena por época aunque MLflow devuelva desordenado", () => {
    const g = buildChart([
      {
        name: "loss",
        points: [
          { step: 3, value: 0.1, timestamp: 0 },
          { step: 1, value: 0.9, timestamp: 0 },
        ],
      },
    ]);
    expect(g.paths[0].d.startsWith(`M${DEFAULT_LAYOUT.padding.left},`)).toBe(true);
  });

  it("un solo punto o valores iguales no rompen la escala", () => {
    const g = buildChart([{ name: "loss", points: pts([0.5]) }]);
    expect(g.paths[0].d).not.toContain("NaN");
    expect(g.paths[0].last).not.toBeNull();
  });

  it("marcas del eje x solo en épocas enteras", () => {
    const g = buildChart([{ name: "loss", points: pts([0.5, 0.4, 0.3, 0.2]) }]);
    expect(g.xTicks.every((t) => Number.isInteger(t.value))).toBe(true);
  });
});
