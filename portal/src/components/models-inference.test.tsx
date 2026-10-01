import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ModelVersionInfo } from "@/contracts";
import { cropsQuery, pickVersion, usableVersions, validateImageFile } from "@/lib/ui/models";
import { AnnotationQueueDashboard } from "./AnnotationQueueDashboard";
import { InferenceDashboard } from "./InferenceDashboard";
import { ModelsDashboard } from "./ModelsDashboard";
import { ModelsTable } from "./ModelsTable";
import { ProbabilityBars } from "./ProbabilityBars";

const noop = () => {};

function model(
  version: string,
  status: ModelVersionInfo["publication"]["status"],
): ModelVersionInfo {
  return {
    name: "clasificador",
    version,
    stage: null,
    status: null,
    runId: "fe32e1388dbd465cae714a69bf80f685",
    s3Key: `models/clasificador/${version}`,
    weightsSha256: "e5aa4f73e607bf593eade2cc9c0194e468a425613aea8042f155c4a3e82af630",
    creationTimestamp: null,
    lastUpdatedTimestamp: null,
    description: null,
    dvcRelease: "proyecto2 v1.1.0@dc9376e",
    s3Bucket: "modelos",
    s3Uri: `s3://modelos/models/clasificador/${version}`,
    publishedAt: "2026-09-30T20:00:00.000Z",
    publication: { status, missingFiles: [], checkedAt: "2026-09-30T20:00:00.000Z", message: null },
    files: status === "published" ? ["weights.pt"] : [],
    hasModelCard: false,
    mlflowRunUrl: "http://127.0.0.1:5000/#/experiments/1/runs/fe32e138",
    metrics: { bestValLoss: 0.0463, bestValAcc: 0.9778, testAccuracy: 0.9481, testF1Macro: 0.9458 },
  };
}

describe("ModelsTable", () => {
  it("separa versión de modelo y release DVC, y enlaza run e inferencia", () => {
    const html = renderToStaticMarkup(
      <ModelsTable
        models={[model("1.0.0", "published")]}
        selectedVersion="1.0.0"
        onSelect={noop}
      />,
    );
    expect(html).toContain("Versión de modelo");
    expect(html).toContain("Release DVC (dataset)");
    expect(html).toContain("proyecto2 v1.1.0@dc9376e");
    expect(html).toContain("Publicado en S3");
    expect(html).toContain('href="/inference?version=1.0.0"');
    expect(html).toContain('href="/api/models/1.0.0/files/weights.pt"');
    expect(html).toContain("#/experiments/1/runs/fe32e138");
    expect(html).toContain("94.81 %");
  });

  it("un paquete incompleto no ofrece descarga ni inferencia", () => {
    const html = renderToStaticMarkup(
      <ModelsTable
        models={[model("0.9.0", "incomplete")]}
        selectedVersion={null}
        onSelect={noop}
      />,
    );
    expect(html).toContain("Incompleto en S3");
    expect(html).toContain("No disponible");
    expect(html).not.toContain("/inference?version");
    expect(html).not.toContain("/files/");
  });
});

describe("ProbabilityBars", () => {
  it("una barra por clase con porcentaje en texto y la predicha resaltada", () => {
    const html = renderToStaticMarkup(
      <ProbabilityBars
        predictedClass="car"
        probabilities={[
          { className: "car", probability: 0.92 },
          { className: "person", probability: 0.08 },
        ]}
      />,
    );
    expect(html).toContain('class="predicted"');
    expect(html).toContain("92.00 %");
    expect(html).toContain("8.00 %");
    expect(html).toContain("width:92.0%");
  });
});

describe("dashboards (render inicial)", () => {
  it("muestran estado de carga, no datos inventados", () => {
    expect(renderToStaticMarkup(<ModelsDashboard />)).toContain("Consultando versiones");
    expect(renderToStaticMarkup(<InferenceDashboard requestedVersion={null} />)).toContain(
      "Cargando versiones publicadas",
    );
    expect(renderToStaticMarkup(<AnnotationQueueDashboard />)).toContain("Cargando cola");
  });
});

describe("lógica de UI", () => {
  const models = [
    model("1.1.0", "incomplete"),
    model("1.0.0", "published"),
    model("0.9.0", "published"),
  ];

  it("solo se puede inferir con versiones verificadas en S3", () => {
    expect(usableVersions(models).map((m) => m.version)).toEqual(["1.0.0", "0.9.0"]);
  });

  it("respeta ?version= si es usable; si no, la publicada más reciente", () => {
    expect(pickVersion(models, "0.9.0")).toBe("0.9.0");
    expect(pickVersion(models, "1.1.0")).toBe("1.0.0");
    expect(pickVersion(models, null)).toBe("1.0.0");
    expect(pickVersion([], null)).toBeNull();
  });

  it("valida tipo y tamaño antes de enviar", () => {
    expect(validateImageFile(null)).toContain("Elige");
    expect(validateImageFile({ size: 10, type: "image/gif" })).toContain("JPEG o PNG");
    expect(validateImageFile({ size: 6 * 1024 * 1024, type: "image/jpeg" })).toContain("5 MB");
    expect(validateImageFile({ size: 10, type: "image/png" })).toBeNull();
  });
});

describe("cropsQuery", () => {
  it("omite filtros vacíos", () => {
    expect(cropsQuery({ className: null, split: null, offset: 0, limit: 24 })).toBe(
      "offset=0&limit=24",
    );
    expect(cropsQuery({ className: "car", split: "test", offset: 24, limit: 24 })).toBe(
      "offset=24&limit=24&className=car&split=test",
    );
  });
});
