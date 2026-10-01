import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExperimentRun, ModelVersionInfo } from "@/contracts";
import { EvaluationLinks } from "./EvaluationDashboard";
import { ModelsTable } from "./ModelsTable";
import { RunsTable } from "./RunsTable";

const noop = () => {};

function run(extra: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    runId: "abc0000000",
    runName: "exp-07",
    experimentId: "1",
    status: "FINISHED",
    startTime: null,
    endTime: null,
    params: { optimizer: "adamw" },
    metrics: { best_val_loss: 0.04 },
    tags: { dvc_release: "proyecto2 v1.1.0@dc9376e" },
    ...extra,
  };
}

function model(extra: Partial<ModelVersionInfo> = {}): ModelVersionInfo {
  return {
    name: "clasificador",
    version: "1.0.0",
    stage: null,
    status: "READY",
    runId: "fe32e138",
    s3Key: "models/clasificador/1.0.0/",
    weightsSha256: "e5aa4f73",
    creationTimestamp: null,
    lastUpdatedTimestamp: null,
    description: null,
    dvcRelease: "proyecto2 v1.1.0@dc9376e",
    s3Bucket: "bucket",
    s3Uri: "s3://bucket/models/clasificador/1.0.0",
    publishedAt: "2026-09-30T00:00:00Z",
    publication: {
      status: "published",
      missingFiles: [],
      checkedAt: "2026-09-30T00:00:00Z",
      message: null,
    },
    files: ["weights.pt"],
    hasModelCard: false,
    mlflowRunUrl: "http://localhost:5000/#/experiments/1/runs/fe32e138",
    metrics: { bestValLoss: 0.04, bestValAcc: 0.97, testAccuracy: 0.9481, testF1Macro: 0.9458 },
    ...extra,
  };
}

describe("/experiments: release y enlace a MLflow", () => {
  it("cada run muestra su release DVC y abre la UI de MLflow en otra pestaña", () => {
    const html = renderToStaticMarkup(
      <RunsTable
        runs={[run({ mlflowRunUrl: "http://localhost:5000/#/experiments/1/runs/abc0000000" })]}
        candidateRunId={null}
        selectedRunId={null}
        onSelect={noop}
      />,
    );
    expect(html).toContain("proyecto2 v1.1.0@dc9376e");
    expect(html).toContain('href="http://localhost:5000/#/experiments/1/runs/abc0000000"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("MLflow ↗");
  });

  it("sin enlace de MLflow no muestra el link", () => {
    const html = renderToStaticMarkup(
      <RunsTable
        runs={[run({ tags: {} })]}
        candidateRunId={null}
        selectedRunId={null}
        onSelect={noop}
      />,
    );
    expect(html).not.toContain("MLflow ↗");
  });
});

describe("/evaluation: enlaces al run y a la versión", () => {
  it("lleva a las curvas del run y a la versión en Models", () => {
    const html = renderToStaticMarkup(<EvaluationLinks runId="fe32e138" modelVersion="1.0.0" />);
    expect(html).toContain('href="/experiments?run=fe32e138"');
    expect(html).toContain('href="/models?version=1.0.0"');
  });

  it("sin run no muestra el enlace a las curvas", () => {
    const html = renderToStaticMarkup(<EvaluationLinks runId={null} modelVersion="1.0.0" />);
    expect(html).not.toContain("/experiments?run=");
    expect(html).toContain('href="/models?version=1.0.0"');
  });
});

describe("/models: enlaces a evaluación y curvas", () => {
  it("cada versión enlaza a su evaluación y a las curvas de su run", () => {
    const html = renderToStaticMarkup(
      <ModelsTable models={[model()]} selectedVersion={null} onSelect={noop} />,
    );
    expect(html).toContain('href="/evaluation?model=clasificador%3A1.0.0"');
    expect(html).toContain('href="/experiments?run=fe32e138"');
    expect(html).toContain("Usar en Inference");
  });

  it("aunque el paquete no esté completo en S3, se puede ir a la evaluación y a las curvas", () => {
    const incomplete = model({
      publication: {
        status: "incomplete",
        missingFiles: ["weights.pt"],
        checkedAt: "x",
        message: null,
      },
    });
    const html = renderToStaticMarkup(
      <ModelsTable models={[incomplete]} selectedVersion={null} onSelect={noop} />,
    );
    expect(html).toContain('href="/evaluation?model=clasificador%3A1.0.0"');
    expect(html).toContain('href="/experiments?run=fe32e138"');
    expect(html).not.toContain("Usar en Inference");
  });
});
