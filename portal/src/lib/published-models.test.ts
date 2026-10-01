import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Modelos publicados (T13): `published_models` + MLflow + verificación en S3.
 * Regla clave de la rúbrica: un paquete que no existe en S3 nunca aparece como publicado.
 */

const objectExists = vi.fn();
const getRun = vi.fn();
const searchModelVersions = vi.fn();
const select = vi.fn();

vi.mock("@/lib/s3", async () => {
  const actual = await vi.importActual<typeof import("@/lib/s3")>("@/lib/s3");
  return { ...actual, objectExists: (...a: unknown[]) => objectExists(...a) };
});
vi.mock("@/lib/mlflow", () => ({
  getRun: (...a: unknown[]) => getRun(...a),
  searchModelVersions: (...a: unknown[]) => searchModelVersions(...a),
}));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ select }) }));

import type { S3Store } from "@/lib/s3";
import { checkPublication, readPublishedRows, toModelVersionInfo } from "./published-models";

const store = { bucket: "modelos", label: "s3://modelos", client: {} } as unknown as S3Store;

const row = {
  version: "1.0.0",
  name: "clasificador",
  runId: "fe32e1388dbd465cae714a69bf80f685",
  dvcRelease: "proyecto2 v1.1.0@dc9376e",
  s3Key: "models/clasificador/1.0.0",
  sha256: "e5aa4f73e607bf593eade2cc9c0194e468a425613aea8042f155c4a3e82af630",
  createdAt: new Date("2026-09-30T20:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  objectExists.mockResolvedValue(true);
  searchModelVersions.mockResolvedValue([]);
  getRun.mockResolvedValue({
    runId: row.runId,
    experimentId: "1",
    metrics: {
      best_val_loss: 0.0463,
      best_val_acc: 0.9778,
      test_accuracy: 0.9481,
      test_f1_macro: 0.9458,
    },
    tags: { dvc_release: "otro-release" },
  });
});

describe("checkPublication", () => {
  it("published cuando existen los 4 archivos del paquete", async () => {
    const pub = await checkPublication(store, "1.0.0");
    expect(pub).toMatchObject({ status: "published", missingFiles: [], message: null });
    expect(objectExists).toHaveBeenCalledWith(store, "models/clasificador/1.0.0/weights.pt");
    expect(objectExists).toHaveBeenCalledTimes(4);
  });

  it("incomplete y lista lo que falta si un archivo no está en S3", async () => {
    objectExists.mockImplementation(
      async (_s: unknown, key: string) => !key.endsWith("weights.pt"),
    );
    const pub = await checkPublication(store, "1.0.0");
    expect(pub.status).toBe("incomplete");
    expect(pub.missingFiles).toEqual(["weights.pt"]);
    expect(pub.message).toContain("weights.pt");
  });

  it("unverified si S3 no responde (nunca published)", async () => {
    objectExists.mockRejectedValue(new Error("timeout"));
    const pub = await checkPublication(store, "1.0.0");
    expect(pub.status).toBe("unverified");
    expect(pub.message).toContain("timeout");
  });
});

describe("toModelVersionInfo", () => {
  it("combina la fila publicada, el run de MLflow y el registry", async () => {
    const registry = new Map([
      ["1.0.0", { status: "READY", stage: "None", tags: { semver: "1.0.0" } } as never],
    ]);
    const info = await toModelVersionInfo(row, store, registry);
    expect(info).toMatchObject({
      version: "1.0.0",
      runId: row.runId,
      weightsSha256: row.sha256,
      dvcRelease: "proyecto2 v1.1.0@dc9376e", // de la fila, no del tag del run
      s3Uri: "s3://modelos/models/clasificador/1.0.0",
      publishedAt: "2026-09-30T20:00:00.000Z",
      status: "READY",
      files: ["weights.pt", "classes.json", "preprocess.json", "summary.json"],
      metrics: { bestValLoss: 0.0463, testAccuracy: 0.9481, testF1Macro: 0.9458 },
    });
    expect(info.mlflowRunUrl).toMatch(/#\/experiments\/1\/runs\/fe32e138/);
  });

  it("paquete incompleto: sin archivos descargables", async () => {
    objectExists.mockImplementation(
      async (_s: unknown, key: string) => !key.endsWith("summary.json"),
    );
    const info = await toModelVersionInfo(row, store, new Map());
    expect(info.publication.status).toBe("incomplete");
    expect(info.files).toEqual([]);
  });

  it("sin bucket configurado: unverified y sin URI", async () => {
    const info = await toModelVersionInfo(row, null, new Map());
    expect(info.publication.status).toBe("unverified");
    expect(info.s3Uri).toBeNull();
    expect(info.files).toEqual([]);
  });

  it("MLflow caído no impide listar: métricas null", async () => {
    getRun.mockRejectedValue(new Error("down"));
    const info = await toModelVersionInfo(row, store, new Map());
    expect(info.metrics.testAccuracy).toBeNull();
    expect(info.mlflowRunUrl).toBeNull();
    expect(info.publication.status).toBe("published");
  });
});

describe("readPublishedRows", () => {
  it("tabla inexistente → error claro para correr las migraciones", async () => {
    select.mockReturnValue({
      from: () => ({
        orderBy: () =>
          Promise.reject(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" })),
      }),
    });
    await expect(readPublishedRows()).rejects.toMatchObject({
      code: "schema_missing",
      status: 500,
    });
  });
});
