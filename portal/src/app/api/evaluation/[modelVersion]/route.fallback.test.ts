import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P1-3 — Evaluation funciona con los artefactos versionados.
 *
 * Tres casos de GET /api/evaluation/[modelVersion]:
 *   1. el run está en MLflow                      → fuente "mlflow"
 *   2. el run no está, `reports/t08` es del mismo run y de los mismos pesos → fuente "repo"
 *   3. `reports/t08` es del mismo run pero de otros pesos → 409
 *
 * Solo se simulan MLflow y la tabla `published_models`; `reports/t08`, `reports/t07` y el
 * cálculo de métricas son los reales del repo.
 */

const getRun = vi.fn();
const getModelVersion = vi.fn();
vi.mock("@/lib/mlflow", () => ({
  getRun: (...a: unknown[]) => getRun(...a),
  getModelVersion: (...a: unknown[]) => getModelVersion(...a),
}));

const readPublishedRow = vi.fn();
vi.mock("@/lib/published-models", () => ({
  readPublishedRow: (...a: unknown[]) => readPublishedRow(...a),
}));

import { upstreamError } from "@/lib/http";
import { GET as EXPORT } from "./predictions/route";
import { GET } from "./route";

const REPO = resolve(process.cwd(), "..");
const RUN_ID = "fe32e1388dbd465cae714a69bf80f685";
const WEIGHTS = "e5aa4f73e607bf593eade2cc9c0194e468a425613aea8042f155c4a3e82af630";
const PREDICTIONS = readFileSync(resolve(REPO, "reports/t08/predictions.csv"), "utf-8");

const ctx = (seg: string) => ({ params: Promise.resolve({ modelVersion: seg }) });
const req = () => new Request("http://localhost/api/evaluation/x");
const published = (sha256 = WEIGHTS) => ({
  name: "clasificador",
  version: "1.0.0",
  runId: RUN_ID,
  sha256,
});

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  readPublishedRow.mockResolvedValue(published());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("P1-3: GET /api/evaluation/[modelVersion]", () => {
  it("caso 1 — MLflow: usa el run y su predictions.csv, fuente 'mlflow'", async () => {
    getRun.mockResolvedValue({
      runId: RUN_ID,
      metrics: { test_accuracy: 128 / 135, test_f1_macro: 0.9458173269881314 },
      tags: {},
      params: {},
    });
    fetchMock.mockResolvedValue(new Response(PREDICTIONS, { status: 200 }));

    const res = await GET(req(), ctx("clasificador:1.0.0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("mlflow");
    expect(body.test.source).toBe("mlflow");
    expect(body.test.nSamples).toBe(135);
    expect(String(fetchMock.mock.calls[0][0])).toContain("get-artifact");
  });

  it("caso 2 — respaldo válido: el run no está en MLflow y reports/t08 es de esa versión", async () => {
    getRun.mockResolvedValue(null);

    const res = await GET(req(), ctx("clasificador:1.0.0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ runId: RUN_ID, source: "repo" });
    expect(body.test.source).toBe("repo");
    expect(body.test.nSamples).toBe(135);
    expect(body.test.accuracy).toBeCloseTo(128 / 135, 12);
    expect(body.metrics.accuracy).toBeCloseTo(0.9481481481481482, 12);
    // Las cifras calculadas desde el CSV coinciden con las de reports/t08/metrics.json.
    expect(body.test.checks.every((c: { matches: boolean | null }) => c.matches === true)).toBe(
      true,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caso 2 — la galería trae los 7 errores del test con recorte, etiqueta real y predicción", async () => {
    getRun.mockResolvedValue(null);
    const body = await (await GET(req(), ctx("clasificador:1.0.0"))).json();
    expect(body.test.errors).toHaveLength(7);
    for (const error of body.test.errors) {
      expect(error.cropPath).toMatch(/^crops\/\d+_\d+\.jpg$/);
      expect(["person", "car"]).toContain(error.yTrue);
      expect(["person", "car"]).toContain(error.yPred);
      expect(error.yPred).not.toBe(error.yTrue);
    }
  });

  it("caso 2 — también sirve de respaldo si MLflow está caído", async () => {
    getRun.mockRejectedValue(upstreamError("MLflow no responde"));
    const res = await GET(req(), ctx("clasificador:1.0.0"));
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe("repo");
  });

  it("caso 3 — respaldo con hash distinto: 409, no se muestran resultados de otros pesos", async () => {
    getRun.mockResolvedValue(null);
    readPublishedRow.mockResolvedValue(published("0".repeat(64)));

    const res = await GET(req(), ctx("clasificador:1.0.0"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("conflict");
    expect(body.error.message).toContain("no corresponde a los pesos publicados");
  });

  it("sin run en MLflow y con reports/t08 de otro run: 404 como antes", async () => {
    getRun.mockResolvedValue(null);
    readPublishedRow.mockResolvedValue({ ...published(), runId: "otro-run" });
    expect((await GET(req(), ctx("clasificador:1.0.0"))).status).toBe(404);
  });

  it("MLflow caído y sin respaldo aplicable: se conserva el 502", async () => {
    getRun.mockRejectedValue(upstreamError("MLflow no responde"));
    readPublishedRow.mockResolvedValue({ ...published(), runId: "otro-run" });
    expect((await GET(req(), ctx("clasificador:1.0.0"))).status).toBe(502);
  });
});

describe("P1-3: GET /api/evaluation/[modelVersion]/predictions (exportar)", () => {
  it("descarga predictions.csv del repo verificado cuando MLflow no lo tiene", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));

    const res = await EXPORT(req(), ctx("clasificador:1.0.0"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="predictions-clasificador-1.0.0.csv"',
    );
    expect(res.headers.get("X-Evaluation-Source")).toBe("repo");
    expect(await res.text()).toBe(PREDICTIONS);
  });

  it("descarga el artefacto del run cuando está en MLflow", async () => {
    fetchMock.mockResolvedValue(new Response(PREDICTIONS, { status: 200 }));
    const res = await EXPORT(req(), ctx("clasificador:1.0.0"));
    expect(res.headers.get("X-Evaluation-Source")).toBe("mlflow");
    expect((await res.text()).split("\n")[0]).toContain("crop_path");
  });

  it("409 si el reporte del repo es de otros pesos", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    readPublishedRow.mockResolvedValue(published("0".repeat(64)));
    expect((await EXPORT(req(), ctx("clasificador:1.0.0"))).status).toBe(409);
  });
});
