import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApprovedRelease, ExperimentRun } from "@/contracts";
import { ExperimentsDashboard } from "./ExperimentsDashboard";
import { JobProgress } from "./JobProgress";
import { MetricsChart } from "./MetricsChart";
import { ReleaseSelector } from "./ReleaseSelector";
import { RunsTable } from "./RunsTable";
import { StateMessage } from "./StateMessage";
import { TrainingDashboard } from "./TrainingDashboard";
import { TrainingForm } from "./TrainingForm";

const noop = () => {};

const release: ApprovedRelease = {
  tag: "proyecto2 v1.1.0@dc9376e",
  provenance: {
    sourceCommit: "dc9376eeb7f6dade3cfca4c0b8d95fd8773d8e57",
    annotationsMd5: "72e5f4025c4dbe7eb1e2420a9b4dbf9a",
    manifestMd5: "e75a07ce3b75455514f044b23e0d1b29",
    cropsMd5: null,
  },
  classes: ["person", "car"],
  split: {
    seed: 42,
    totals: { train: 944, val: 270, test: 135, total: 1349 },
    byClass: {
      car: { train: 375, val: 108, test: 54, total: 537 },
      person: { train: 569, val: 162, test: 81, total: 812 },
    },
    leakage: 0,
    testFingerprint: "2da0",
  },
};

function run(id: string, loss: number): ExperimentRun {
  return {
    runId: `${id}0000000000`,
    runName: `exp-${id}`,
    experimentId: "1",
    status: "FINISHED",
    startTime: null,
    endTime: null,
    params: { optimizer: "adamw", lr: "0.001" },
    metrics: { best_val_loss: loss, best_val_acc: 0.97 },
    tags: {},
  };
}

describe("StateMessage", () => {
  it("error con alerta y reintento", () => {
    const html = renderToStaticMarkup(
      <StateMessage kind="error" message="MLflow caído" onRetry={noop} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("MLflow caído");
    expect(html).toContain("Reintentar");
  });

  it("carga y vacío sin botón", () => {
    for (const kind of ["loading", "empty"] as const) {
      const html = renderToStaticMarkup(<StateMessage kind={kind} message="x" onRetry={noop} />);
      expect(html).toContain('role="status"');
      expect(html).not.toContain("Reintentar");
    }
  });
});

describe("ReleaseSelector", () => {
  it("muestra hash, procedencia y conteos 70/20/10", () => {
    const html = renderToStaticMarkup(
      <ReleaseSelector releases={[release]} selectedTag={release.tag} onChange={noop} />,
    );
    expect(html).toContain("proyecto2 v1.1.0@dc9376e");
    expect(html).toContain("dc9376eeb7f6"); // commit acortado
    expect(html).toContain("72e5f4025c4d");
    expect(html).toContain("944 (70%)");
    expect(html).toContain("270 (20%)");
    expect(html).toContain("135 (10%)");
    expect(html).toContain("fuga 0 ✓");
  });
});

describe("TrainingForm", () => {
  it("muestra los 7 hiperparámetros y 3 semillas con los defaults del baseline", () => {
    const html = renderToStaticMarkup(<TrainingForm release={release.tag} onLaunched={noop} />);
    for (const id of [
      "optimizer",
      "batch_size",
      "max_epochs",
      "lr",
      "img_size",
      "hidden_layers",
      "dropout",
      "shuffle_seed",
      "aug_seed",
      "init_seed",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('value="0.001"');
  });

  it("sin release el botón de lanzar queda deshabilitado", () => {
    const html = renderToStaticMarkup(<TrainingForm release={null} onLaunched={noop} />);
    expect(html).toMatch(/<button type="submit" disabled="">/);
  });
});

describe("RunsTable", () => {
  it("ordena por mejor val_loss y marca el candidato", () => {
    const html = renderToStaticMarkup(
      <RunsTable
        runs={[run("a", 0.06), run("b", 0.046)]}
        candidateRunId="b0000000000"
        selectedRunId={null}
        onSelect={noop}
      />,
    );
    expect(html.indexOf("exp-b")).toBeLessThan(html.indexOf("exp-a"));
    expect(html).toContain("★");
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain("0.0460");
    expect(html).toContain("97.0%");
  });
});

describe("MetricsChart", () => {
  const pts = (v: number[]) => v.map((value, i) => ({ step: i + 1, value, timestamp: 0 }));

  it("una línea por serie y leyenda", () => {
    const html = renderToStaticMarkup(
      <MetricsChart
        title="Pérdida"
        yLabel="loss"
        series={[
          { name: "train_loss", points: pts([0.9, 0.5]) },
          { name: "val_loss", points: pts([0.8, 0.6]) },
        ]}
      />,
    );
    expect(html.match(/<path /g)).toHaveLength(2);
    expect(html).toContain("<title");
    expect(html).toContain("train_loss");
  });

  it("estado vacío si el run no registró la métrica", () => {
    const html = renderToStaticMarkup(
      <MetricsChart title="Accuracy" yLabel="acc" series={[{ name: "val_acc", points: [] }]} />,
    );
    expect(html).not.toContain("<svg");
    expect(html).toContain("no registró val_acc");
  });
});

describe("estado inicial de las vistas con datos remotos", () => {
  it("Training, Experiments y el progreso empiezan cargando, sin datos inventados", () => {
    expect(renderToStaticMarkup(<TrainingDashboard />)).toContain("Cargando releases");
    expect(renderToStaticMarkup(<ExperimentsDashboard initialRunId={null} />)).toContain(
      "Cargando runs",
    );
    expect(renderToStaticMarkup(<JobProgress jobId="job-1" />)).toContain("Consultando el job");
  });
});
