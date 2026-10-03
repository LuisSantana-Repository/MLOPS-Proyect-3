import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLEAN_MANIFEST, writeRegistry, writeRelease } from "@/lib/testing/release-fixture";

/**
 * POST /api/training/jobs valida el release y su manifiesto ACTUAL antes de crear la fila
 * (P1-1 y Actividad A, 6.1). No se simula la validación: se lee un repo de prueba en disco.
 */

const state = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/env", () => ({
  env: {
    get REPO_ROOT() {
      return state.root;
    },
  },
}));

const createJob = vi.fn();
const enqueueTrainingJob = vi.fn();
vi.mock("@/lib/jobs", () => ({ createJob: (...a: unknown[]) => createJob(...a) }));
vi.mock("@/lib/queue", () => ({
  enqueueTrainingJob: (...a: unknown[]) => enqueueTrainingJob(...a),
}));

import { POST } from "./route";

const V110 = "proyecto2 v1.1.0@dc9376e";
const V100 = "proyecto2 v1.0.0@9c0b9a4";

function req(body: unknown): Request {
  return new Request("http://localhost/api/training/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function expectNoJob() {
  expect(createJob).not.toHaveBeenCalled();
  expect(enqueueTrainingJob).not.toHaveBeenCalled();
}

beforeEach(async () => {
  vi.clearAllMocks();
  state.root = await mkdtemp(join(tmpdir(), "jobs-"));
  await writeRegistry(state.root);
  createJob.mockImplementation(async (release: string, params: unknown) => ({
    id: "job-1",
    status: "queued",
    release,
    params,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }));
  enqueueTrainingJob.mockResolvedValue(undefined);
});

afterEach(async () => {
  await rm(state.root, { recursive: true, force: true });
});

describe("P1-1: el release debe existir y estar aprobado", () => {
  it("400: un release no aprobado no crea fila en training_jobs ni se encola", async () => {
    await writeRelease(state.root);
    const res = await POST(req({ release: "v9.9.9@noaprobado" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
    expect(body.error.message).toContain("v9.9.9@noaprobado");
    expect(body.error.details).toHaveProperty("release");
    expectNoJob();
  });

  it("201: el release aprobado por la compuerta de calidad sí crea el job", async () => {
    await writeRelease(state.root);
    const res = await POST(req({ release: V110 }));
    expect(res.status).toBe(201);
    expect(createJob).toHaveBeenCalledOnce();
    expect(createJob.mock.calls[0][0]).toBe(V110);
  });
});

describe("Actividad A (6.1): el manifiesto actual se revisa antes de encolar", () => {
  it("400: manifiesto con fuga inyectada (image_id 61 / ann_id 80 en train, el resto del original en test)", async () => {
    // El reporte de fuga sigue diciendo 0: lo que cuenta es el manifiesto de ahora.
    await writeRelease(state.root, {
      manifest: CLEAN_MANIFEST.replace(
        "crops/61_80.jpg,80,61,1,person,0,img000061,test",
        "crops/61_80.jpg,80,61,1,person,0,img000061,train",
      ),
      leakTotal: 0,
    });

    const res = await POST(req({ release: V110 }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("fuga entre particiones");
    expect(body.error.message).toContain("image_id 61");
    expect(body.error.details.release).toContain("image_id=61: test, train");
    expectNoJob();
  });

  it("400: el manifiesto fue modificado y ya no es el versionado en DVC", async () => {
    await writeRelease(state.root, { manifestDvcMd5: "e75a07ce3b75455514f044b23e0d1b29" });
    const res = await POST(req({ release: V110 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("no es el versionado en DVC");
    expectNoJob();
  });

  it("400: sin el archivo del manifiesto no se puede revisar, así que no se encola", async () => {
    await writeRelease(state.root, { manifest: null });
    const res = await POST(req({ release: V110 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("dvc pull");
    expectNoJob();
  });
});

describe("Actividad A (1.1): cada release entrena con su propio manifiesto", () => {
  beforeEach(async () => {
    await writeRelease(state.root);
    await writeRelease(state.root, { version: "v1.0.0" });
  });

  it("el release entregado usa data/splits y data/crops", async () => {
    expect((await POST(req({ release: V110 }))).status).toBe(201);
    expect(enqueueTrainingJob.mock.calls[0][0].params).toMatchObject({
      release: V110,
      manifest_path: "data/splits/manifest.csv",
      classes_path: "data/crops/classes.json",
      data_root: "data/crops",
    });
  });

  it("el segundo release usa su manifiesto derivado en data/releases/v1.0.0", async () => {
    expect((await POST(req({ release: V100 }))).status).toBe(201);
    expect(enqueueTrainingJob.mock.calls[0][0].params).toMatchObject({
      release: V100,
      manifest_path: "data/releases/v1.0.0/splits/manifest.csv",
      classes_path: "data/releases/v1.0.0/crops/classes.json",
      data_root: "data/releases/v1.0.0/crops",
    });
  });
});
