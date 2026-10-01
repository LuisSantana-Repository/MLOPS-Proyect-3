import { beforeEach, describe, expect, it, vi } from "vitest";

/** Contrato de GET/POST /api/annotation-queue (T13). */

const createAnnotationItem = vi.fn();
const listAnnotationItems = vi.fn();
vi.mock("@/lib/annotation-queue", () => ({
  createAnnotationItem: (...a: unknown[]) => createAnnotationItem(...a),
  listAnnotationItems: (...a: unknown[]) => listAnnotationItems(...a),
}));

import { GET, POST } from "./route";

const SHA = "a".repeat(64);
const VALID = {
  image: { kind: "upload", key: `uploads/${SHA}.jpg`, sha256: SHA, contentType: "image/jpeg" },
  modelVersion: "1.0.0",
  suggestedClass: "car",
  probabilities: { car: 0.92, person: 0.08 },
};

function post(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/annotation-queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  createAnnotationItem.mockImplementation(async (input) => ({
    id: "00000000-0000-4000-8000-000000000000",
    status: "pending",
    ...input,
  }));
  listAnnotationItems.mockResolvedValue({
    items: [],
    counts: { pending: 0, annotated: 0, discarded: 0 },
  });
});

describe("POST /api/annotation-queue", () => {
  it("201: crea el elemento pendiente con la predicción sugerida", async () => {
    const res = await POST(post(VALID));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "pending", suggestedClass: "car" });
    expect(createAnnotationItem).toHaveBeenCalledWith(VALID);
  });

  it.each([
    ["llave fuera de uploads/", { ...VALID, image: { ...VALID.image, key: "../secreto.jpg" } }],
    [
      "recorte fuera de crops/",
      { ...VALID, image: { kind: "crop", cropPath: "../../etc/passwd" } },
    ],
    ["probabilidad fuera de [0, 1]", { ...VALID, probabilities: { car: 1.5, person: 0 } }],
    ["una sola clase", { ...VALID, probabilities: { car: 1 } }],
    ["versión inválida", { ...VALID, modelVersion: "latest" }],
  ])("400: %s", async (_name, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(createAnnotationItem).not.toHaveBeenCalled();
  });

  it("400: cuerpo que no es JSON", async () => {
    expect((await POST(post("{no-json", true))).status).toBe(400);
  });
});

describe("GET /api/annotation-queue", () => {
  it("200: filtra por estado y limita", async () => {
    const res = await GET(
      new Request("http://localhost/api/annotation-queue?status=pending&limit=5"),
    );
    expect(res.status).toBe(200);
    expect(listAnnotationItems).toHaveBeenCalledWith("pending", 5);
  });

  it("200: sin filtro devuelve todos", async () => {
    await GET(new Request("http://localhost/api/annotation-queue"));
    expect(listAnnotationItems).toHaveBeenCalledWith(null, 100);
  });

  it("400: estado desconocido", async () => {
    const res = await GET(new Request("http://localhost/api/annotation-queue?status=todo"));
    expect(res.status).toBe(400);
  });
});
