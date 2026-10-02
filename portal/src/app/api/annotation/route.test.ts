import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Contrato de POST /api/annotation (P0-3). */

const sendToAnnotation = vi.fn();
vi.mock("@/lib/annotation-portal", () => ({
  sendToAnnotation: (...a: unknown[]) => sendToAnnotation(...a),
}));

import { POST } from "./route";

const SHA = "a".repeat(64);
const VALID = {
  image: { kind: "upload", key: `uploads/${SHA}.jpg`, sha256: SHA, contentType: "image/jpeg" },
  modelVersion: "1.0.0",
  suggestedClass: "car",
  probabilities: { car: 0.92, person: 0.08 },
};

function post(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/annotation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sendToAnnotation.mockResolvedValue({
    imageId: 41,
    filename: "inference-aaaaaaaaaaaa.jpg",
    status: "pending",
    modelVersion: "1.0.0",
    suggestedClass: "car",
    probabilities: VALID.probabilities,
    annotateUrl: "/annotate/41",
    pendingUrl: "/search?status=pending",
  });
});

describe("POST /api/annotation", () => {
  it("201: la imagen queda pendiente en el portal de anotación, con su pantalla de anotación", async () => {
    const res = await POST(post(VALID));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      imageId: 41,
      status: "pending",
      suggestedClass: "car",
      annotateUrl: "/annotate/41",
    });
    expect(sendToAnnotation).toHaveBeenCalledWith(VALID);
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
    expect(sendToAnnotation).not.toHaveBeenCalled();
  });

  it("400: cuerpo que no es JSON", async () => {
    expect((await POST(post("{no-json", true))).status).toBe(400);
  });
});

describe("P0-3: ya no hay una cola aparte", () => {
  const src = resolve(__dirname, "../../..");

  it("no existen la página ni la API de annotation_queue", () => {
    expect(existsSync(resolve(src, "app/annotation-queue"))).toBe(false);
    expect(existsSync(resolve(src, "app/api/annotation-queue"))).toBe(false);
    expect(existsSync(resolve(src, "lib/annotation-queue.ts"))).toBe(false);
  });

  it("el esquema del portal ya no define la tabla annotation_queue", async () => {
    const schema = await import("@/lib/db/schema");
    expect(Object.keys(schema)).not.toContain("annotationQueue");
  });
});
