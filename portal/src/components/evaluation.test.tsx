import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TestEvaluation } from "@/contracts";
import { ClassMetricsTable } from "./ClassMetricsTable";
import { ConfusionHeatmap } from "./ConfusionHeatmap";
import { ErrorGallery } from "./ErrorGallery";
import { EvaluationDashboard } from "./EvaluationDashboard";
import { MetricCards } from "./MetricCards";

const test: TestEvaluation = {
  source: "mlflow",
  classes: ["person", "car"],
  nSamples: 135,
  accuracy: 0.9259,
  f1Macro: 0.9231,
  meetsTarget: true,
  target: 0.85,
  perClass: {
    person: { precision: 0.94, recall: 0.94, f1: 0.94, support: 81 },
    car: { precision: 0.907, recall: 0.907, f1: 0.907, support: 54 },
  },
  confusionMatrix: {
    labels: ["person", "car"],
    matrix: [
      [76, 5],
      [5, 49],
    ],
  },
  errors: [
    {
      cropPath: "crops/12_345.jpg",
      annId: "345",
      imageId: "12",
      yTrue: "car",
      yPred: "person",
      confidence: 0.91,
      probabilities: { person: 0.91, car: 0.09 },
    },
  ],
  checks: [{ metric: "test_accuracy", computed: 0.9259, logged: 0.9259, matches: true }],
};

describe("MetricCards", () => {
  it("accuracy con meta de 85% cumplida y F1 macro", () => {
    const html = renderToStaticMarkup(<MetricCards test={test} />);
    expect(html).toContain("92.6%");
    expect(html).toContain("Cumple la meta (≥ 85%)");
    expect(html).toContain("0.9231");
    expect(html).toContain("135");
  });

  it("avisa cuando no llega a la meta", () => {
    const html = renderToStaticMarkup(
      <MetricCards test={{ ...test, accuracy: 0.8, meetsTarget: false }} />,
    );
    expect(html).toContain("80.0%");
    expect(html).toContain("No llega a la meta (≥ 85%)");
  });
});

describe("ClassMetricsTable", () => {
  it("precisión, recall, F1 y soporte por clase", () => {
    const html = renderToStaticMarkup(<ClassMetricsTable test={test} />);
    for (const text of ["person", "car", "0.9400", "0.9070", ">81<", ">54<"])
      expect(html).toContain(text);
  });
});

describe("ConfusionHeatmap", () => {
  it("tabla accesible con el número en cada celda", () => {
    const html = renderToStaticMarkup(<ConfusionHeatmap confusion={test.confusionMatrix} />);
    expect(html).toContain("<table");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    for (const n of [">76<", ">5<", ">49<"]) expect(html).toContain(n);
    expect(html).toContain('aria-label="real person, predicha car: 5 (6.2% de person)"');
  });
});

describe("ErrorGallery", () => {
  it("muestra el recorte, la clase real, la predicha y su probabilidad", () => {
    const html = renderToStaticMarkup(<ErrorGallery errors={test.errors} classes={test.classes} />);
    expect(html).toContain('src="/api/crops/crops/12_345.jpg"');
    expect(html).toContain('alt="Recorte 345: real car, predicho person"');
    expect(html).toContain("91.0%");
    expect(html).toContain('id="filter-true"');
    expect(html).toContain('id="filter-pred"');
    expect(html).toContain("1 de 1 errores");
  });

  it("sin errores lo dice", () => {
    const html = renderToStaticMarkup(<ErrorGallery errors={[]} classes={test.classes} />);
    expect(html).toContain("No hay predicciones incorrectas");
  });
});

describe("EvaluationDashboard", () => {
  it("empieza cargando, sin datos inventados", () => {
    expect(renderToStaticMarkup(<EvaluationDashboard initialModel={null} />)).toContain(
      "Cargando modelos",
    );
  });
});
