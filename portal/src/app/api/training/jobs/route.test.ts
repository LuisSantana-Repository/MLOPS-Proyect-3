import { beforeEach, describe, expect, it, vi } from "vitest";

const createJob = vi.fn();
const enqueueTrainingJob = vi.fn();

vi.mock("@/lib/jobs", () => ({ createJob: (...a: unknown[]) => createJob(...a) }));
vi.mock("@/lib/queue", () => ({
  enqueueTrainingJob: (...a: unknown[]) => enqueueTrainingJob(...a),
}));

import { POST } from "./route";

const validBody = {
  release: "proyecto2 v1.1.0@dc9376e",
  optimizer: "adamw",
  batch_size: 32,
  max_epochs: 30,
  lr: 0.001,
  img_size: 224,
  hidden_layers: [256],
  dropout: 0.3,
  shuffle_seed: 42,
  aug_seed: 43,
  init_seed: 44,
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/training/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/training/jobs", () => {
  beforeEach(() => {
    createJob.mockReset();
    enqueueTrainingJob.mockReset();
  });

  it("crea el job (201), lo persiste y lo encola", async () => {
    const now = new Date("2026-09-28T12:00:00.000Z");
    createJob.mockResolvedValue({
      id: "job-1",
      status: "queued",
      release: validBody.release,
      params: { ...validBody, release: undefined },
      createdAt: now,
    });
    enqueueTrainingJob.mockResolvedValue(undefined);

    const res = await POST(post(validBody));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.id).toBe("job-1");
    expect(json.status).toBe("queued");
    expect(json.release).toBe(validBody.release);

    // Persistió con release + params, y encoló con la forma { id, params }.
    expect(createJob).toHaveBeenCalledOnce();
    expect(createJob.mock.calls[0][0]).toBe(validBody.release);
    expect(enqueueTrainingJob).toHaveBeenCalledOnce();
    const queued = enqueueTrainingJob.mock.calls[0][0];
    expect(queued.id).toBe("job-1");
    expect(queued.params.release).toBe(validBody.release);
    expect(queued.params.manifest_path).toBe("data/splits/manifest.csv");
  });

  it("rechaza sin release con 400 y detalle de campo", async () => {
    const { release: _omit, ...noRelease } = validBody;
    const res = await POST(post(noRelease));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("bad_request");
    expect(json.error.details.release).toBeDefined();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("rechaza hiperparámetros fuera de rango (lr > 1)", async () => {
    const res = await POST(post({ ...validBody, lr: 5 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.details.lr).toBeDefined();
  });

  it("aplica defaults del baseline cuando faltan campos opcionales", async () => {
    createJob.mockResolvedValue({
      id: "job-2",
      status: "queued",
      release: validBody.release,
      params: {},
      createdAt: new Date(),
    });
    enqueueTrainingJob.mockResolvedValue(undefined);

    const minimal = { release: validBody.release };
    const res = await POST(post(minimal));
    expect(res.status).toBe(201);
    const params = createJob.mock.calls[0][1];
    expect(params.optimizer).toBe("adamw");
    expect(params.batch_size).toBe(32);
    expect(params.shuffle_seed).toBe(42);
  });

  it("responde 400 si el cuerpo no es JSON", async () => {
    const res = await POST(post("no-json{"));
    expect(res.status).toBe(400);
  });
});
