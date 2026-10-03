import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato de GET /api/evaluation/[modelVersion] (T09 / T14).
 * Resuelve "nombre:version", lee métricas de test + matriz de confusión + clases
 * del run de origen. 400 si el identificador es ambiguo, 404 si no existe.
 */

const getModelVersion = vi.fn();
const getRun = vi.fn();
const fetchMlflowArtifact = vi.fn();

vi.mock("@/lib/mlflow", () => ({
  getModelVersion: (...a: unknown[]) => getModelVersion(...a),
  getRun: (...a: unknown[]) => getRun(...a),
}));

// T13: versiones semánticas publicadas por T10 (tabla published_models).
const readPublishedRow = vi.fn();
vi.mock("@/lib/published-models", () => ({
  readPublishedRow: (...a: unknown[]) => readPublishedRow(...a),
}));

// T12: predictions.csv de T08, artefacto del run en MLflow.
vi.mock("@/lib/test-evaluation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/test-evaluation")>()),
  fetchMlflowArtifact: (...a: unknown[]) => fetchMlflowArtifact(...a),
}));

// 6.3: selección congelada por T07 (reports/t07/selection.json). Por defecto, la del run evaluado.
const readCandidateSelection = vi.fn();
vi.mock("@/lib/repo-artifacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/repo-artifacts")>()),
  readCandidateSelection: (...a: unknown[]) => readCandidateSelection(...a),
}));

import { notFound } from "@/lib/http";
import { GET } from "./route";

const selection = (runId: string, testSplitUsed = false) => ({
  runId,
  runName: null,
  selectedAt: "2026-09-28T03:21:04+00:00",
  criterion: { metric: "best_val_loss", mode: "min", split: "val" },
  testSplitUsed,
});

const ctx = (seg: string) => ({ params: Promise.resolve({ modelVersion: seg }) });
const req = (qs = "") => new Request(`http://localhost/api/evaluation/x${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
  getModelVersion.mockResolvedValue({ runId: "run-1" });
  getRun.mockResolvedValue({
    metrics: { test_accuracy: 0.81, test_macro_f1: 0.79, test_loss: 0.53 },
    tags: { confusion_matrix: "[[40,5],[7,38]]", classes: '["person","car"]' },
    params: {},
  });
  fetchMlflowArtifact.mockResolvedValue(null);
  readCandidateSelection.mockResolvedValue(selection("run-1"));
});

describe("GET /api/evaluation/[modelVersion]", () => {
  it('200: forma "nombre:version" -> métricas, matriz y clases', async () => {
    const res = await GET(req(), ctx("clasificador:3"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      modelName: "clasificador",
      modelVersion: "3",
      runId: "run-1",
    });
    expect(body.metrics.accuracy).toBe(0.81);
    expect(body.metrics.macroF1).toBe(0.79);
    expect(body.metrics.extra).toHaveProperty("test_loss", 0.53);
    expect(body.confusionMatrix).toEqual([
      [40, 5],
      [7, 38],
    ]);
    expect(body.classes).toEqual(["person", "car"]);
    expect(getModelVersion).toHaveBeenCalledWith("clasificador", "3");
  });

  it("200: versión en la ruta + ?name=", async () => {
    const res = await GET(req("?name=clasificador"), ctx("3"));
    expect(res.status).toBe(200);
    expect(getModelVersion).toHaveBeenCalledWith("clasificador", "3");
  });

  it("400: identificador ambiguo (sin ':' ni ?name)", async () => {
    const res = await GET(req(), ctx("3"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("T13: versión semántica publicada -> run de published_models, sin tocar el registry", async () => {
    readPublishedRow.mockResolvedValue({
      name: "clasificador",
      version: "1.0.0",
      runId: "run-pub",
    });
    readCandidateSelection.mockResolvedValue(selection("run-pub"));
    const res = await GET(req(), ctx("clasificador:1.0.0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ modelVersion: "1.0.0", runId: "run-pub" });
    expect(readPublishedRow).toHaveBeenCalledWith("1.0.0");
    expect(getModelVersion).not.toHaveBeenCalled();
    expect(getRun).toHaveBeenCalledWith("run-pub");
  });

  it("T13: 404 si la versión semántica no está publicada", async () => {
    readPublishedRow.mockResolvedValue(null);
    const res = await GET(req(), ctx("clasificador:9.9.9"));
    expect(res.status).toBe(404);
  });

  it("400: versión que no es entero ni semántica", async () => {
    const res = await GET(req(), ctx("clasificador:latest"));
    expect(res.status).toBe(400);
  });

  it("404: la versión no existe en el registry", async () => {
    getModelVersion.mockResolvedValue(null);
    const res = await GET(req(), ctx("clasificador:9"));
    expect(res.status).toBe(404);
  });

  it("T12: incluye la evaluación de test calculada desde predictions.csv del run", async () => {
    getRun.mockResolvedValue({ metrics: { test_accuracy: 0.5 }, tags: {}, params: {} });
    fetchMlflowArtifact.mockResolvedValue(
      [
        "crop_path,ann_id,image_id,y_true,y_pred,correct,prob_person,prob_car",
        "crops/1_1.jpg,1,1,person,person,1,0.900000,0.100000",
        "crops/2_2.jpg,2,2,car,person,0,0.600000,0.400000",
      ].join("\n"),
    );
    const body = await (await GET(req(), ctx("clasificador:3"))).json();
    expect(fetchMlflowArtifact).toHaveBeenCalledWith("run-1", "test/predictions.csv");
    expect(body.source).toBe("mlflow");
    expect(body.test).toMatchObject({ source: "mlflow", nSamples: 2, accuracy: 0.5 });
    // Sin tags, la matriz y las clases salen de predictions.csv.
    expect(body.confusionMatrix).toEqual([
      [1, 0],
      [1, 0],
    ]);
    expect(body.classes).toEqual(["person", "car"]);
  });

  it("T12: test = null si el run todavía no tiene evaluación de test", async () => {
    const body = await (await GET(req(), ctx("clasificador:3"))).json();
    expect(body.test).toBeNull();
  });

  it("T12: sin métricas test_ no se pide el artefacto a MLflow", async () => {
    getRun.mockResolvedValue({ metrics: { best_val_loss: 0.04 }, tags: {}, params: {} });
    const body = await (await GET(req(), ctx("clasificador:3"))).json();
    expect(body.test).toBeNull();
    expect(fetchMlflowArtifact).not.toHaveBeenCalled();
  });

  it("T12: 502 si no se puede leer predictions.csv", async () => {
    const { upstreamError } = await import("@/lib/http");
    fetchMlflowArtifact.mockRejectedValue(upstreamError("MLflow caído"));
    const res = await GET(req(), ctx("clasificador:3"));
    expect(res.status).toBe(502);
  });

  it("T12: predictions.csv corrupto -> 500", async () => {
    fetchMlflowArtifact.mockResolvedValue("no,es,el,csv");
    const res = await GET(req(), ctx("clasificador:3"));
    expect(res.status).toBe(500);
  });

  describe("6.3: sin selección congelada no hay resultados de test", () => {
    it("409 si falta reports/t07/selection.json: ni accuracy ni matriz", async () => {
      readCandidateSelection.mockRejectedValue(notFound("Todavía no hay candidato congelado"));
      const res = await GET(req(), ctx("clasificador:3"));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.message).toContain("reports/t07/selection.json");
      expect(body).not.toHaveProperty("metrics");
      expect(body).not.toHaveProperty("test");
      expect(fetchMlflowArtifact).not.toHaveBeenCalled();
    });

    it("409 si la selección congelada es de otro run", async () => {
      readCandidateSelection.mockResolvedValue(selection("otro-run"));
      const res = await GET(req(), ctx("clasificador:3"));
      expect(res.status).toBe(409);
      expect((await res.json()).error.message).toContain("otro-run");
    });

    it("409 si la selección dice que se usó el test para elegir", async () => {
      readCandidateSelection.mockResolvedValue(selection("run-1", true));
      expect((await GET(req(), ctx("clasificador:3"))).status).toBe(409);
    });

    it("un run sin métricas test_ se muestra sin pedir la selección (no revela nada del test)", async () => {
      getRun.mockResolvedValue({ metrics: { best_val_loss: 0.05 }, tags: {}, params: {} });
      readCandidateSelection.mockRejectedValue(notFound("sin selección"));
      const res = await GET(req(), ctx("clasificador:3"));
      expect(res.status).toBe(200);
      expect((await res.json()).test).toBeNull();
    });
  });
});
