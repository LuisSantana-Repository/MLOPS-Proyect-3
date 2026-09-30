import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMlflowArtifact, loadTestEvaluation, PREDICTIONS_ARTIFACT, readRepoPredictions } from "./test-evaluation";

const RUN = "fe32e1388dbd465cae714a69bf80f685";
const CSV = [
  "crop_path,ann_id,image_id,y_true,y_pred,correct,prob_person,prob_car",
  "crops/1_1.jpg,1,1,person,person,1,0.900000,0.100000",
  "crops/2_2.jpg,2,2,car,person,0,0.600000,0.400000",
].join("\n");

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "t08-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRepoReport(runId: string, csv = CSV) {
  await mkdir(join(root, "reports", "t08"), { recursive: true });
  await writeFile(join(root, "reports", "t08", "metrics.json"), JSON.stringify({ run_id: runId, accuracy: 0.5 }));
  await writeFile(join(root, "reports", "t08", "predictions.csv"), csv);
}

const respond = (status: number, body = "") =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("fetchMlflowArtifact", () => {
  it("pide el artefacto del run al servidor de MLflow", async () => {
    const fetchImpl = respond(200, CSV);
    expect(await fetchMlflowArtifact(RUN, PREDICTIONS_ARTIFACT, fetchImpl)).toBe(CSV);
    const url = new URL(String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0][0]));
    expect(url.pathname).toMatch(/\/get-artifact$/);
    expect(url.searchParams.get("path")).toBe("test/predictions.csv");
    expect(url.searchParams.get("run_uuid")).toBe(RUN);
  });

  it("404 -> null (el run no tiene ese artefacto)", async () => {
    expect(await fetchMlflowArtifact(RUN, PREDICTIONS_ARTIFACT, respond(404))).toBeNull();
  });

  it("error del servidor -> 502", async () => {
    await expect(fetchMlflowArtifact(RUN, PREDICTIONS_ARTIFACT, respond(500, "boom"))).rejects.toMatchObject({
      status: 502,
    });
  });

  it("MLflow caído -> 502", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(fetchMlflowArtifact(RUN, PREDICTIONS_ARTIFACT, down)).rejects.toMatchObject({ status: 502 });
  });
});

describe("readRepoPredictions", () => {
  it("lee reports/t08 si su metrics.json es del mismo run", async () => {
    await writeRepoReport(RUN);
    expect(await readRepoPredictions(root, RUN)).toBe(CSV);
  });

  it("ignora reports/t08 de otro run", async () => {
    await writeRepoReport("otro-run");
    expect(await readRepoPredictions(root, RUN)).toBeNull();
  });

  it("null si todavía no existe reports/t08", async () => {
    expect(await readRepoPredictions(root, RUN)).toBeNull();
  });
});

describe("loadTestEvaluation", () => {
  const evaluated = { test_accuracy: 0.5, test_f1_macro: 1 / 3 };

  it("usa predictions.csv de MLflow cuando el run ya tiene métricas de test", async () => {
    const ev = await loadTestEvaluation(RUN, evaluated, { root, fetchImpl: respond(200, CSV) });
    expect(ev?.source).toBe("mlflow");
    expect(ev?.nSamples).toBe(2);
    expect(ev?.accuracy).toBe(0.5);
    expect(ev?.checks.find((c) => c.metric === "test_accuracy")?.matches).toBe(true);
  });

  it("sin métricas test_ no llama a MLflow y usa el repo si coincide el run", async () => {
    await writeRepoReport(RUN);
    const fetchImpl = respond(200, "no debería usarse");
    const ev = await loadTestEvaluation(RUN, {}, { root, fetchImpl });
    expect(ev?.source).toBe("repo");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("MLflow caído: usa el repo como respaldo", async () => {
    await writeRepoReport(RUN);
    const ev = await loadTestEvaluation(RUN, evaluated, { root, fetchImpl: respond(503) });
    expect(ev?.source).toBe("repo");
  });

  it("MLflow caído y sin respaldo: propaga el 502", async () => {
    await expect(loadTestEvaluation(RUN, evaluated, { root, fetchImpl: respond(503) })).rejects.toMatchObject({
      status: 502,
    });
  });

  it("todavía sin evaluación de test (T08 no se ha corrido) -> null", async () => {
    expect(await loadTestEvaluation(RUN, { best_val_loss: 0.04 }, { root, fetchImpl: respond(404) })).toBeNull();
  });

  it("predictions.csv corrupto -> 500 con mensaje", async () => {
    await expect(
      loadTestEvaluation(RUN, evaluated, { root, fetchImpl: respond(200, "no,es,el,csv") }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
