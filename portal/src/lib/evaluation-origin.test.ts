import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mlflow", () => ({ getRun: vi.fn(), getModelVersion: vi.fn() }));
vi.mock("@/lib/published-models", () => ({ readPublishedRow: vi.fn() }));

import { readVerifiedRepoReport } from "./evaluation-origin";

/** P1-3 — reglas del respaldo `reports/t08` (verificado contra la versión publicada). */

const RUN = "fe32";
const SHA = "e5aa".padEnd(64, "0");
const CSV = "crop_path,ann_id,image_id,y_true,y_pred,correct,prob_person,prob_car\n";

let root: string;

async function write(path: string, content: string) {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
}

async function writeReport({
  runId = RUN,
  weights = SHA,
  selection = { run_id: RUN, test_split_used: false } as object | null,
} = {}) {
  await write(
    "reports/t08/metrics.json",
    JSON.stringify({ run_id: runId, weights_sha256: weights, accuracy: 0.9, f1_macro: 0.8 }),
  );
  await write("reports/t08/predictions.csv", CSV);
  if (selection) await write("reports/t07/selection.json", JSON.stringify(selection));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "eval-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readVerifiedRepoReport", () => {
  const origin = { runId: RUN, weightsSha256: SHA };

  it("acepta el reporte si run_id y weights_sha256 coinciden con la versión publicada", async () => {
    await writeReport();
    expect(await readVerifiedRepoReport(root, origin)).toEqual({
      runId: RUN,
      weightsSha256: SHA,
      logged: { test_accuracy: 0.9, test_f1_macro: 0.8 },
      predictionsCsv: CSV,
    });
  });

  it("null si no hay reporte o es de otro run", async () => {
    expect(await readVerifiedRepoReport(root, origin)).toBeNull();
    await writeReport({ runId: "otro" });
    expect(await readVerifiedRepoReport(root, origin)).toBeNull();
  });

  it("null si la versión no tiene hash publicado con qué verificar", async () => {
    await writeReport();
    expect(await readVerifiedRepoReport(root, { runId: RUN, weightsSha256: null })).toBeNull();
  });

  it("409 si el hash de pesos no coincide", async () => {
    await writeReport({ weights: "f".repeat(64) });
    await expect(readVerifiedRepoReport(root, origin)).rejects.toMatchObject({ status: 409 });
  });

  it("409 si no existe selection.json: no hay resultados de test antes de la selección", async () => {
    await writeReport({ selection: null });
    await expect(readVerifiedRepoReport(root, origin)).rejects.toMatchObject({ status: 409 });
  });

  it("409 si la selección usó el split de test o es de otro run", async () => {
    await writeReport({ selection: { run_id: RUN, test_split_used: true } });
    await expect(readVerifiedRepoReport(root, origin)).rejects.toMatchObject({ status: 409 });
    await writeReport({ selection: { run_id: "otro", test_split_used: false } });
    await expect(readVerifiedRepoReport(root, origin)).rejects.toMatchObject({ status: 409 });
  });
});
