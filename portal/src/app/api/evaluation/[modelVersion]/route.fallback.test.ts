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

// 6.3: por defecto, la selección REAL del repo; algunas pruebas la quitan.
const readCandidateSelection = vi.fn();
vi.mock("@/lib/repo-artifacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/repo-artifacts")>()),
  readCandidateSelection: (...a: unknown[]) => readCandidateSelection(...a),
}));

import { notFound, upstreamError } from "@/lib/http";
import type * as artifacts from "@/lib/repo-artifacts";
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

beforeEach(async () => {
  vi.clearAllMocks();
  const real = await vi.importActual<typeof artifacts>("@/lib/repo-artifacts");
  readCandidateSelection.mockImplementation((root: string) => real.readCandidateSelection(root));
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

  // --- Revisión del PR #23: el run SÍ está en MLflow pero sin predictions.csv de test. ---
  // El respaldo debe ser el MISMO verificado (run + pesos + selección), nunca solo por run_id.

  const runWithoutTest = (metrics: Record<string, number>) => ({
    runId: RUN_ID,
    metrics,
    tags: {},
    params: {},
  });

  it("run en MLflow sin artefacto de test y mismos pesos: respaldo verificado, fuente 'repo'", async () => {
    getRun.mockResolvedValue(runWithoutTest({ test_accuracy: 128 / 135 }));
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));

    const res = await GET(req(), ctx("clasificador:1.0.0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("repo");
    expect(body.test.source).toBe("repo");
    expect(body.test.nSamples).toBe(135);
  });

  it("run en MLflow sin artefacto de test y pesos distintos: 409", async () => {
    getRun.mockResolvedValue(runWithoutTest({ test_accuracy: 128 / 135 }));
    fetchMock.mockResolvedValue(new Response("", { status: 404 }));
    readPublishedRow.mockResolvedValue(published("0".repeat(64)));

    expect((await GET(req(), ctx("clasificador:1.0.0"))).status).toBe(409);
  });

  it("run en MLflow sin métricas test_ y pesos distintos: 409 (no se usa el repo sin verificar)", async () => {
    getRun.mockResolvedValue(runWithoutTest({ best_val_loss: 0.046 }));
    readPublishedRow.mockResolvedValue(published("0".repeat(64)));

    expect((await GET(req(), ctx("clasificador:1.0.0"))).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("run en MLflow sin métricas test_ y mismos pesos: respaldo verificado, fuente 'repo'", async () => {
    getRun.mockResolvedValue(runWithoutTest({ best_val_loss: 0.046 }));

    const body = await (await GET(req(), ctx("clasificador:1.0.0"))).json();
    expect(body.source).toBe("repo");
    expect(body.test.accuracy).toBeCloseTo(128 / 135, 12);
    expect(body.metrics.accuracy).toBeCloseTo(128 / 135, 12);
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

describe("P1-3: no queda un camino sin verificar", () => {
  it("test-evaluation ya no ofrece el respaldo que solo comparaba run_id", async () => {
    const legacy = await import("@/lib/test-evaluation");
    expect(Object.keys(legacy)).not.toContain("readRepoPredictions");
    expect(Object.keys(legacy)).not.toContain("loadTestEvaluation");
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

describe("Actividad B: selección congelada, versión del dataset y galería (6.3, 4.4)", () => {
  const withRun = () =>
    getRun.mockResolvedValue({
      runId: RUN_ID,
      metrics: { test_accuracy: 128 / 135, test_f1_macro: 0.9458173269881314 },
      tags: {
        dvc_release: "proyecto2 v1.1.0@dc9376e",
        manifest_dvc_md5: "e75a07ce3b75455514f044b23e0d1b29",
        manifest_sha256: "0bdfd6d7efd40f17903df10695b3e34177d535071b76ac0c5404a215428ed578",
      },
      params: {},
    });

  it("sin selection.json: 409 en MLflow, en el respaldo y en la exportación (sin 94.8 %)", async () => {
    readCandidateSelection.mockRejectedValue(notFound("Todavía no hay candidato congelado"));
    fetchMock.mockResolvedValue(new Response(PREDICTIONS, { status: 200 }));

    withRun();
    const viaMlflow = await GET(req(), ctx("clasificador:1.0.0"));
    expect(viaMlflow.status).toBe(409);
    expect(JSON.stringify(await viaMlflow.json())).not.toContain("0.948");
    expect(fetchMock).not.toHaveBeenCalled();

    getRun.mockResolvedValue(null);
    expect((await GET(req(), ctx("clasificador:1.0.0"))).status).toBe(409);
    expect((await EXPORT(req(), ctx("clasificador:1.0.0"))).status).toBe(409);
  });

  it("muestra el release y los hashes del dataset (también desde el respaldo)", async () => {
    withRun();
    fetchMock.mockResolvedValue(new Response(PREDICTIONS, { status: 200 }));
    const fromMlflow = (await (await GET(req(), ctx("clasificador:1.0.0"))).json()).dataset;
    getRun.mockResolvedValue(null);
    const fromRepo = (await (await GET(req(), ctx("clasificador:1.0.0"))).json()).dataset;

    for (const dataset of [fromMlflow, fromRepo]) {
      expect(dataset).toMatchObject({
        release: "proyecto2 v1.1.0@dc9376e",
        rawDvcMd5: "1fdb1dcea3218ad2fb0edf985984a929.dir",
        annotationsMd5: "72e5f4025c4dbe7eb1e2420a9b4dbf9a",
        manifestDvcMd5: "e75a07ce3b75455514f044b23e0d1b29",
      });
    }
    expect(fromMlflow.manifestSha256).toBe(
      "0bdfd6d7efd40f17903df10695b3e34177d535071b76ac0c5404a215428ed578",
    );
  });

  it("trae las 135 predicciones del test: 128 aciertos y 7 errores, todas con recorte", async () => {
    getRun.mockResolvedValue(null);
    const { test } = await (await GET(req(), ctx("clasificador:1.0.0"))).json();
    const predictions: { cropPath: string; yTrue: string; yPred: string }[] = test.predictions;
    expect(predictions).toHaveLength(135);
    expect(predictions.filter((p) => p.yTrue === p.yPred)).toHaveLength(128);
    expect(predictions.filter((p) => p.yTrue !== p.yPred)).toHaveLength(7);
    expect(new Set(predictions.map((p) => p.cropPath)).size).toBe(135);
    for (const p of predictions) expect(p.cropPath).toMatch(/^crops\/\d+_\d+\.jpg$/);
  });
});
