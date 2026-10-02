import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** P1-1 — GET /api/releases solo lista releases con compuerta de calidad aprobada. */

const state = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/env", () => ({
  env: {
    get REPO_ROOT() {
      return state.root;
    },
  },
}));

import { GET } from "./route";

async function write(path: string, content: string) {
  await mkdir(join(state.root, path, ".."), { recursive: true });
  await writeFile(join(state.root, path), content);
}

async function writeRepo(gate: { status: string; exitCode: number }) {
  await write(
    "data/crops/release_info.json",
    JSON.stringify({
      release_tag: "proyecto2 v1.1.0@dc9376e",
      annotations_md5: "72e5f4025c4dbe7eb1e2420a9b4dbf9a",
      dvc_file_content:
        "# proyecto2 v1.1.0 @ dc9376eeb7f6dade3cfca4c0b8d95fd8773d8e57\n" +
        "outs:\n- md5: 1fdb1dcea3218ad2fb0edf985984a929.dir\n  path: raw\n",
    }),
  );
  await write("data/crops/classes.json", JSON.stringify({ "0": "person", "1": "car" }));
  await write(
    "data/splits/split_report.csv",
    "clase,total,train,train_pct,val,val_pct,test,test_pct\n" +
      "car,537,375,69.8,108,20.1,54,10.1\nperson,812,569,70.1,162,20.0,81,10.0\n",
  );
  await write(
    "data/splits/leakage_report.json",
    JSON.stringify({ semilla: 42, fuga: { total: 0 } }),
  );
  await write("data/splits/manifest.csv.dvc", "outs:\n- md5: e75a07ce3b75455514f044b23e0d1b29\n");
  await write(
    "annotation-backend/quality/reports/versions.json",
    JSON.stringify({
      versions: [
        { version: "v1.1.0", commit: "e4e33de", dvcRevision: "1fdb1dcea3218ad2fb0edf985984a929" },
      ],
    }),
  );
  await write(
    "annotation-backend/quality/reports/release.json",
    JSON.stringify({
      dataset_version: "v1.1.0",
      quality: {
        overall_status: gate.status,
        exit_code: gate.exitCode,
        checks: [{ name: "invalid_boxes", status: gate.status, severity: "fail", threshold: 0 }],
      },
    }),
  );
}

beforeEach(async () => {
  state.root = await mkdtemp(join(tmpdir(), "releases-"));
});

afterEach(async () => {
  await rm(state.root, { recursive: true, force: true });
});

describe("P1-1: GET /api/releases", () => {
  it("un release con compuerta fallida no aparece", async () => {
    await writeRepo({ status: "fail", exitCode: 1 });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ releases: [] });
  });

  it("un release con compuerta aprobada aparece con su referencia de calidad", async () => {
    await writeRepo({ status: "pass", exitCode: 0 });
    const { releases } = await (await GET()).json();
    expect(releases).toHaveLength(1);
    expect(releases[0].tag).toBe("proyecto2 v1.1.0@dc9376e");
    expect(releases[0].quality).toMatchObject({
      status: "pass",
      version: "v1.1.0",
      reportFile: "annotation-backend/quality/reports/release.json",
      policyFile: "annotation-backend/quality/quality.yaml",
    });
  });
});
