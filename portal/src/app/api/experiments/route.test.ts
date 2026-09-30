import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato de GET /api/experiments (T09 / T14).
 * Lista runs del experimento; por defecto solo los de selección (sweep + FINISHED,
 * sin smoke) ordenados por best_val_loss. 404 si el experimento no existe.
 */

const getExperimentIdByName = vi.fn();
const searchRuns = vi.fn();

vi.mock("@/lib/mlflow", () => ({
  getExperimentIdByName: (...a: unknown[]) => getExperimentIdByName(...a),
  searchRuns: (...a: unknown[]) => searchRuns(...a),
}));

import { GET } from "./route";

const run = (over: Record<string, unknown> = {}) => ({
  runId: "run-1",
  runName: "baseline",
  experimentId: "10",
  status: "FINISHED",
  startTime: 1,
  endTime: 2,
  params: {},
  metrics: { best_val_loss: 0.5 },
  tags: { sweep: "t07" },
  ...over,
});

const call = (qs = "") => GET(new Request(`http://localhost/api/experiments${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  getExperimentIdByName.mockResolvedValue("10");
  searchRuns.mockResolvedValue({ runs: [run()], nextPageToken: null });
});

describe("GET /api/experiments", () => {
  it("200: devuelve runs y describe el filtro de selección aplicado", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toHaveLength(1);
    expect(body.selection).toMatchObject({
      onlySelected: true,
      sweep: "t07",
      orderedBy: "best_val_loss ASC",
    });
    // El filtro por defecto restringe a sweep + FINISHED.
    const opts = searchRuns.mock.calls[0][0];
    expect(opts.filter).toContain("tags.sweep = 't07'");
    expect(opts.filter).toContain("attributes.status = 'FINISHED'");
  });

  it("200: descarta runs de humo (smoke) del lado del cliente", async () => {
    searchRuns.mockResolvedValue({
      runs: [run(), run({ runId: "smoke-1", tags: { sweep: "t07", smoke: "true" } })],
      nextPageToken: null,
    });
    const body = await (await call()).json();
    expect(body.runs.map((r: { runId: string }) => r.runId)).toEqual(["run-1"]);
  });

  it("404: el experimento no existe en MLflow", async () => {
    getExperimentIdByName.mockResolvedValue(null);
    const res = await call("?experiment=inexistente");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("400: query param inválido (maxResults fuera de rango)", async () => {
    const res = await call("?maxResults=99999");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });
});
