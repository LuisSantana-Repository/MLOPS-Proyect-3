import { beforeEach, describe, expect, it, vi } from "vitest";
import { notFound } from "@/lib/http";

const readCandidateSelection = vi.fn();
vi.mock("@/lib/repo-artifacts", () => ({
  readCandidateSelection: (...a: unknown[]) => readCandidateSelection(...a),
}));

import { GET } from "./route";

describe("GET /api/experiments/selection", () => {
  beforeEach(() => {
    readCandidateSelection.mockReset();
  });

  it("200 con el candidato congelado", async () => {
    readCandidateSelection.mockResolvedValue({ runId: "fe32", testSplitUsed: false });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).runId).toBe("fe32");
  });

  it("404 si todavía no hay candidato", async () => {
    readCandidateSelection.mockRejectedValue(notFound("sin candidato"));
    const res = await GET();
    expect(res.status).toBe(404);
  });
});
