import { describe, expect, it } from "vitest";
import { ApiClientError, errorMessage, fetchJson } from "./api-client";

const fakeFetch = (status: number, body: unknown) =>
  (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

describe("fetchJson", () => {
  it("devuelve el JSON si la respuesta es OK", async () => {
    expect(await fetchJson("/x", undefined, fakeFetch(200, { a: 1 }))).toEqual({ a: 1 });
  });

  it("traduce ApiErrorBody con detalles por campo", async () => {
    const body = {
      error: { code: "bad_request", message: "cuerpo inválido", details: { lr: ["muy alto"] } },
    };
    const err = await fetchJson("/x", undefined, fakeFetch(400, body)).catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 400, code: "bad_request", details: { lr: ["muy alto"] } });
  });

  it("error HTTP sin cuerpo del contrato", async () => {
    const err = await fetchJson("/x", undefined, fakeFetch(503, "caído")).catch((e) => e);
    expect(err).toMatchObject({ status: 503, code: "http_error" });
  });

  it("error de red", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const err = await fetchJson("/x", undefined, failing).catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: "network_error" });
  });
});

describe("errorMessage", () => {
  it("explica los errores de MLflow/Redis", () => {
    expect(errorMessage(new ApiClientError(502, "upstream_error", "MLflow no responde"))).toMatch(
      /MLflow/,
    );
  });

  it("acepta cualquier error", () => {
    expect(errorMessage(new Error("x"))).toBe("x");
    expect(errorMessage("raro")).toBe("Error inesperado");
  });
});
