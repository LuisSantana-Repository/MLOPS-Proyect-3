import { beforeEach, describe, expect, it, vi } from "vitest";
import { notFound } from "@/lib/http";

const readApprovedReleases = vi.fn();
vi.mock("@/lib/repo-artifacts", () => ({
  readApprovedReleases: (...a: unknown[]) => readApprovedReleases(...a),
}));

import { GET } from "./route";

describe("GET /api/releases", () => {
  beforeEach(() => {
    readApprovedReleases.mockReset();
  });

  it("200 con la lista de releases", async () => {
    readApprovedReleases.mockResolvedValue([{ tag: "proyecto2 v1.1.0@dc9376e" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ releases: [{ tag: "proyecto2 v1.1.0@dc9376e" }] });
  });

  it("404 con la forma ApiErrorBody si no hay release", async () => {
    readApprovedReleases.mockRejectedValue(notFound("No hay release aprobado"));
    const res = await GET();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});
