import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato de GET /api/evaluation/[modelVersion] (T09 / T14).
 * Resuelve "nombre:version", lee métricas de test + matriz de confusión + clases
 * del run de origen. 400 si el identificador es ambiguo, 404 si no existe.
 */

const getModelVersion = vi.fn();
const getRun = vi.fn();
const loadTestEvaluation = vi.fn();

vi.mock("@/lib/mlflow", () => ({
  getModelVersion: (...a: unknown[]) => getModelVersion(...a),
  getRun: (...a: unknown[]) => getRun(...a),
}));

// T13: versiones semánticas publicadas por T10 (tabla published_models).
const readPublishedRow = vi.fn();
vi.mock("@/lib/published-models", () => ({
  readPublishedRow: (...a: unknown[]) => readPublishedRow(...a),
}));

// T12: evaluación de test calculada desde predictions.csv de T08.
vi.mock("@/lib/test-evaluation", () => ({
  loadTestEvaluation: (...a: unknown[]) => loadTestEvaluation(...a),
}));

import { GET } from "./route";

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
  loadTestEvaluation.mockResolvedValue(null);
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
    const test = {
      source: "mlflow",
      accuracy: 0.9,
      confusionMatrix: {
        labels: ["person", "car"],
        matrix: [
          [9, 1],
          [1, 9],
        ],
      },
    };
    getRun.mockResolvedValue({ metrics: { test_accuracy: 0.9 }, tags: {}, params: {} });
    loadTestEvaluation.mockResolvedValue(test);
    const body = await (await GET(req(), ctx("clasificador:3"))).json();
    expect(loadTestEvaluation).toHaveBeenCalledWith("run-1", { test_accuracy: 0.9 });
    expect(body.test).toEqual(test);
    // Sin tags, la matriz y las clases salen de predictions.csv.
    expect(body.confusionMatrix).toEqual(test.confusionMatrix.matrix);
    expect(body.classes).toEqual(["person", "car"]);
  });

  it("T12: test = null si el run todavía no tiene evaluación de test", async () => {
    const body = await (await GET(req(), ctx("clasificador:3"))).json();
    expect(body.test).toBeNull();
  });

  it("T12: 502 si no se puede leer predictions.csv", async () => {
    const { upstreamError } = await import("@/lib/http");
    loadTestEvaluation.mockRejectedValue(upstreamError("MLflow caído"));
    const res = await GET(req(), ctx("clasificador:3"));
    expect(res.status).toBe(502);
  });
});
