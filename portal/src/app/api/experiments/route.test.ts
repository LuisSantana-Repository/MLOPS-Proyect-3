import { beforeEach, describe, expect, it, vi } from "vitest";

const getExperimentIdByName = vi.fn();
const searchRuns = vi.fn();

vi.mock("@/lib/mlflow", () => ({
  getExperimentIdByName: (...a: unknown[]) => getExperimentIdByName(...a),
  searchRuns: (...a: unknown[]) => searchRuns(...a),
}));

import { GET } from "./route";

const call = (qs = "") => GET(new Request(`http://localhost/api/experiments${qs}`));

describe("GET /api/experiments", () => {
  beforeEach(() => {
    getExperimentIdByName.mockReset();
    searchRuns.mockReset();
  });

  it("lista runs con parámetros y métricas finales", async () => {
    getExperimentIdByName.mockResolvedValue("7");
    searchRuns.mockResolvedValue({
      runs: [
        {
          runId: "run-1",
          runName: "job_1",
          experimentId: "7",
          status: "FINISHED",
          startTime: 1,
          endTime: 2,
          params: { lr: "0.001", optimizer: "adamw" },
          metrics: { best_val_loss: 0.12, best_val_acc: 0.95 },
          tags: { dvc_release: "proyecto2 v1.1.0@dc9376e" },
        },
      ],
      nextPageToken: null,
    });

    const res = await call("?maxResults=10");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.experiment).toBe("proyecto3-clasificador");
    expect(json.runs[0].metrics.best_val_loss).toBe(0.12);
    expect(json.runs[0].params.optimizer).toBe("adamw");
  });

  it("por defecto filtra selección T07 (sweep, FINISHED, sin smoke) y ordena por best_val_loss", async () => {
    getExperimentIdByName.mockResolvedValue("7");
    searchRuns.mockResolvedValue({ runs: [], nextPageToken: null });

    const res = await call("?maxResults=10");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.selection).toEqual({
      onlySelected: true,
      sweep: "t07",
      orderedBy: "best_val_loss ASC",
    });

    const arg = searchRuns.mock.calls[0][0];
    expect(arg.filter).toContain("tags.sweep = 't07'");
    expect(arg.filter).toContain("attributes.status = 'FINISHED'");
    // smoke NO va en el filtro de MLflow (excluiría runs sin el tag); se filtra en cliente.
    expect(arg.filter).not.toContain("smoke");
    expect(arg.orderBy).toEqual(["metrics.best_val_loss ASC"]);
  });

  it("descarta runs de humo (smoke=true) del lado del cliente", async () => {
    getExperimentIdByName.mockResolvedValue("7");
    const mkRun = (runId: string, tags: Record<string, string>) => ({
      runId,
      runName: runId,
      experimentId: "7",
      status: "FINISHED",
      startTime: 1,
      endTime: 2,
      params: {},
      metrics: { best_val_loss: 0.3 },
      tags,
    });
    searchRuns.mockResolvedValue({
      runs: [mkRun("real", { sweep: "t07" }), mkRun("humo", { sweep: "t07", smoke: "true" })],
      nextPageToken: null,
    });

    const res = await call("");
    const json = await res.json();
    expect(json.runs.map((r: { runId: string }) => r.runId)).toEqual(["real"]);
  });

  it("con onlySelected=false lista todo ordenado por fecha, sin filtro", async () => {
    getExperimentIdByName.mockResolvedValue("7");
    searchRuns.mockResolvedValue({ runs: [], nextPageToken: null });

    const res = await call("?onlySelected=false");
    const json = await res.json();
    expect(json.selection.onlySelected).toBe(false);
    expect(json.selection.sweep).toBeNull();

    const arg = searchRuns.mock.calls[0][0];
    expect(arg.filter).toBeUndefined();
    expect(arg.orderBy).toEqual(["attributes.start_time DESC"]);
  });

  it("respeta un sweep personalizado (?sweep=t99)", async () => {
    getExperimentIdByName.mockResolvedValue("7");
    searchRuns.mockResolvedValue({ runs: [], nextPageToken: null });

    await call("?sweep=t99");
    const arg = searchRuns.mock.calls[0][0];
    expect(arg.filter).toContain("tags.sweep = 't99'");
  });

  it("404 si el experimento no existe", async () => {
    getExperimentIdByName.mockResolvedValue(null);
    const res = await call("?experiment=no-existe");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("400 con maxResults inválido", async () => {
    const res = await call("?maxResults=0");
    expect(res.status).toBe(400);
    expect(getExperimentIdByName).not.toHaveBeenCalled();
  });
});
