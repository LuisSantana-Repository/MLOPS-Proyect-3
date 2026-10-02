import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato del endpoint POST /api/training/jobs (T09 / T14).
 *
 * Llama al route handler directamente con las capas de datos/cola mockeadas, así
 * el test no necesita MariaDB ni Redis. Verifica: 201 con la forma del contrato,
 * que se persiste y se encola, 400 ante cuerpo inválido o no-JSON, y 502 si la
 * cola falla.
 */

const createJob = vi.fn();
const enqueueTrainingJob = vi.fn();

vi.mock("@/lib/jobs", () => ({ createJob: (...a: unknown[]) => createJob(...a) }));
// La validación del release y de su manifiesto tiene sus propios tests (route.release.test.ts).
vi.mock("@/lib/repo-artifacts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/repo-artifacts")>();
  return {
    ...original,
    requireApprovedRelease: async () => ({ paths: original.DEFAULT_RELEASE_PATHS }),
  };
});
vi.mock("@/lib/queue", () => ({
  enqueueTrainingJob: (...a: unknown[]) => enqueueTrainingJob(...a),
}));

import { upstreamError } from "@/lib/http";
import { POST } from "./route";

function req(body: unknown, { raw = false }: { raw?: boolean } = {}): Request {
  return new Request("http://localhost/api/training/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const VALID = { release: "proyecto2 v1.1.0@dc9376e" };

beforeEach(() => {
  vi.clearAllMocks();
  createJob.mockResolvedValue({
    id: "job-1",
    status: "queued",
    release: VALID.release,
    params: { optimizer: "adamw", batch_size: 32 },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  enqueueTrainingJob.mockResolvedValue(undefined);
});

describe("POST /api/training/jobs", () => {
  it("201: persiste, encola y devuelve la forma del contrato", async () => {
    const res = await POST(req(VALID));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "job-1",
      status: "queued",
      release: VALID.release,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(createJob).toHaveBeenCalledOnce();
    expect(enqueueTrainingJob).toHaveBeenCalledOnce();
    // Se encola con { id, params } (lo que espera worker.py).
    const queued = enqueueTrainingJob.mock.calls[0][0];
    expect(queued.id).toBe("job-1");
    expect(queued.params.release).toBe(VALID.release);
  });

  it("400: cuerpo sin release (regla de negocio)", async () => {
    const res = await POST(req({ batch_size: 32 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("bad_request");
    expect(body.error.details).toHaveProperty("release");
    expect(createJob).not.toHaveBeenCalled();
    expect(enqueueTrainingJob).not.toHaveBeenCalled();
  });

  it("400: hiperparámetro fuera de rango", async () => {
    const res = await POST(req({ ...VALID, batch_size: 99999 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.details).toHaveProperty("batch_size");
  });

  it("400: cuerpo que no es JSON válido", async () => {
    const res = await POST(req("no-es-json{", { raw: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("502: la cola (Redis) no responde -> no se pierde el error", async () => {
    enqueueTrainingJob.mockRejectedValueOnce(upstreamError("Redis caído"));
    const res = await POST(req(VALID));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("upstream_error");
  });
});
