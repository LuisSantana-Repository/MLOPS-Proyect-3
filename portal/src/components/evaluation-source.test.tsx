import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvaluationResponse, TestEvaluation } from "@/contracts";
import { EvaluationSource } from "./EvaluationDashboard";

/** P1-3 — la página dice de dónde salió la evaluación y deja exportar predictions.csv. */

function data(source: "mlflow" | "repo"): EvaluationResponse {
  const test = { source, nSamples: 135 } as TestEvaluation;
  return {
    modelName: "clasificador",
    modelVersion: "1.0.0",
    runId: "fe32e1388dbd465cae714a69bf80f685",
    source,
    metrics: { accuracy: 0.948, macroF1: 0.945, extra: {} },
    confusionMatrix: null,
    classes: null,
    test,
    dataset: {
      release: "proyecto2 v1.1.0@dc9376e",
      rawDvcMd5: null,
      annotationsMd5: null,
      manifestDvcMd5: null,
      manifestSha256: null,
    },
  };
}

describe("P1-3: fuente de la evaluación", () => {
  it("indica «MLflow» cuando el run está en el tracking server", () => {
    const html = renderToStaticMarkup(<EvaluationSource data={data("mlflow")} />);
    expect(html).toContain("Fuente:");
    expect(html).toContain("<strong>MLflow</strong>");
    expect(html).not.toContain("repo verificado");
  });

  it("indica «repo verificado» cuando se usó el respaldo", () => {
    const html = renderToStaticMarkup(<EvaluationSource data={data("repo")} />);
    expect(html).toContain("<strong>repo verificado</strong>");
    expect(html).toContain("mismo SHA-256 de pesos");
    expect(html).toContain("reports/t08/predictions.csv");
  });

  it("enlaza a la exportación de predictions.csv de esa versión", () => {
    const html = renderToStaticMarkup(<EvaluationSource data={data("repo")} />);
    expect(html).toContain('href="/api/evaluation/clasificador%3A1.0.0/predictions"');
    expect(html).toContain("Exportar predictions.csv");
  });

  it("sin evaluación de test no ofrece exportar", () => {
    const html = renderToStaticMarkup(
      <EvaluationSource data={{ ...data("mlflow"), test: null }} />,
    );
    expect(html).not.toContain("Exportar predictions.csv");
  });
});
