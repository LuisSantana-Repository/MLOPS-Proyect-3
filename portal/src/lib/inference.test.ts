import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePrediction, predictImage } from "./inference";

/**
 * Cliente del servicio de T10. La UI solo muestra predicciones coherentes:
 * versión correcta, probabilidades que suman ≈ 1 y clase predicha = argmax.
 */

const OK = {
  version: "1.0.0",
  predicted_class: "car",
  probabilities: { person: 0.08, car: 0.92 },
};

describe("parsePrediction", () => {
  it("ordena las probabilidades de mayor a menor", () => {
    const p = parsePrediction(OK, "1.0.0");
    expect(p.predictedClass).toBe("car");
    expect(p.probabilities).toEqual([
      { className: "car", probability: 0.92 },
      { className: "person", probability: 0.08 },
    ]);
  });

  it.each([
    ["suma distinta de 1", { ...OK, probabilities: { person: 0.5, car: 0.6 } }, "suman"],
    ["otra versión", { ...OK, version: "0.9.0" }, "versión 0.9.0"],
    ["clase que no es la máxima", { ...OK, predicted_class: "person" }, "mayor probabilidad"],
    ["una sola clase", { ...OK, probabilities: { car: 1 } }, "menos de 2"],
    ["forma inesperada", { foo: 1 }, "forma inesperada"],
  ])("502 si %s", (_name, body, message) => {
    expect(() => parsePrediction(body, "1.0.0")).toThrow(message);
    try {
      parsePrediction(body, "1.0.0");
    } catch (err) {
      expect((err as { status: number }).status).toBe(502);
    }
  });
});

describe("predictImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  const input = {
    version: "1.0.0",
    bytes: new Uint8Array([0xff, 0xd8, 0xff]),
    filename: "a.jpg",
    contentType: "image/jpeg",
  };

  it("envía versión e imagen como multipart a POST /predict", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(OK), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = await predictImage(input);
    expect(p.predictedClass).toBe("car");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/predict$/);
    const form = init.body as FormData;
    expect(form.get("version")).toBe("1.0.0");
    expect((form.get("file") as File).name).toBe("a.jpg");
  });

  it.each([
    [404, "not_found"],
    [400, "bad_request"],
    [502, "integrity_error"],
    [500, "upstream_error"],
  ])("traduce el status %i del servicio a %s", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "x" }), { status })),
    );
    await expect(predictImage(input)).rejects.toMatchObject({ code });
  });

  it("servicio apagado → 502 con pista para levantarlo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(predictImage(input)).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("docker compose up -d inference"),
    });
  });
});
