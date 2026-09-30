import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARTIFACTS,
  dvcMd5,
  parseSplitReport,
  readApprovedReleases,
  readCandidateSelection,
  sourceCommit,
} from "./repo-artifacts";

const SPLIT_CSV =
  "clase,total,train,train_pct,val,val_pct,test,test_pct\r\n" +
  "car,537,375,69.8,108,20.1,54,10.1\r\n" +
  "person,812,569,70.1,162,20.0,81,10.0\r\n" +
  "TOTAL,1349,944,70.0,270,20.0,135,10.0\r\n";

let root: string;

async function write(path: string, content: string) {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
}

async function writeRelease() {
  await write(
    ARTIFACTS.releaseInfo,
    JSON.stringify({
      release_tag: "proyecto2 v1.1.0@dc9376e",
      annotations_md5: "72e5f4025c4dbe7eb1e2420a9b4dbf9a",
      dvc_file_content: "# proyecto2 v1.1.0 @ dc9376eeb7f6dade3cfca4c0b8d95fd8773d8e57\n",
    }),
  );
  await write(ARTIFACTS.classes, JSON.stringify({ "1": "car", "0": "person" }));
  await write(ARTIFACTS.splitReport, SPLIT_CSV);
  await write(
    ARTIFACTS.leakageReport,
    JSON.stringify({ semilla: 42, fuga: { total: 0 }, test_huella_sha256: "abc" }),
  );
  await write(
    ARTIFACTS.manifestDvc,
    "outs:\n- md5: e75a07ce3b75455514f044b23e0d1b29\n  path: manifest.csv\n",
  );
  await write(
    ARTIFACTS.cropsDvc,
    "outs:\n- md5: f839dd62b048da0186ade1e382bb7f66.dir\n  path: crops\n",
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "repo-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("helpers", () => {
  it("dvcMd5 lee el primer md5 y quita .dir", () => {
    expect(dvcMd5("outs:\n- md5: f839dd62b048da0186ade1e382bb7f66.dir\n")).toBe(
      "f839dd62b048da0186ade1e382bb7f66",
    );
    expect(dvcMd5(null)).toBeNull();
  });

  it("sourceCommit lee el commit del contenido del .dvc", () => {
    expect(sourceCommit("# proyecto2 v1.1.0 @ dc9376eeb7f6\n")).toBe("dc9376eeb7f6");
    expect(sourceCommit(undefined)).toBeNull();
  });

  it("parseSplitReport separa clases y totales (con CRLF)", () => {
    const { totals, byClass } = parseSplitReport(SPLIT_CSV);
    expect(totals).toEqual({ train: 944, val: 270, test: 135, total: 1349 });
    expect(byClass.person).toEqual({ train: 569, val: 162, test: 81, total: 812 });
  });

  it("parseSplitReport calcula los totales si falta la fila TOTAL", () => {
    const { totals } = parseSplitReport(SPLIT_CSV.split("\r\n").slice(0, 3).join("\n"));
    expect(totals).toEqual({ train: 944, val: 270, test: 135, total: 1349 });
  });
});

describe("readApprovedReleases", () => {
  it("arma el release con procedencia y split", async () => {
    await writeRelease();
    const [release] = await readApprovedReleases(root);
    expect(release.tag).toBe("proyecto2 v1.1.0@dc9376e");
    expect(release.provenance).toEqual({
      sourceCommit: "dc9376eeb7f6dade3cfca4c0b8d95fd8773d8e57",
      annotationsMd5: "72e5f4025c4dbe7eb1e2420a9b4dbf9a",
      manifestMd5: "e75a07ce3b75455514f044b23e0d1b29",
      cropsMd5: "f839dd62b048da0186ade1e382bb7f66",
    });
    expect(release.classes).toEqual(["person", "car"]); // ordenadas por índice
    expect(release.split.seed).toBe(42);
    expect(release.split.leakage).toBe(0);
    expect(release.split.totals.total).toBe(1349);
  });

  it("404 si no hay release_info.json", async () => {
    await expect(readApprovedReleases(root)).rejects.toMatchObject({ status: 404 });
  });

  it("404 si no hay split_report.csv", async () => {
    await writeRelease();
    await rm(join(root, ARTIFACTS.splitReport));
    await expect(readApprovedReleases(root)).rejects.toMatchObject({ status: 404 });
  });

  it("500 claro si un JSON está corrupto", async () => {
    await writeRelease();
    await write(ARTIFACTS.releaseInfo, "{no es json");
    await expect(readApprovedReleases(root)).rejects.toMatchObject({ status: 500 });
  });

  it("lee los artefactos reales del repo (T03/T04)", async () => {
    const [release] = await readApprovedReleases(resolve(process.cwd(), ".."));
    const { totals, byClass } = release.split;
    expect(release.tag).toMatch(/@/);
    expect(release.classes.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(byClass).sort()).toEqual([...release.classes].sort());
    const sum = Object.values(byClass).reduce((acc, c) => acc + c.total, 0);
    expect(totals.total).toBe(sum);
    expect(totals.train + totals.val + totals.test).toBe(totals.total);
  });
});

describe("readCandidateSelection", () => {
  it("lee el candidato congelado", async () => {
    await write(
      ARTIFACTS.selection,
      JSON.stringify({
        run_id: "fe32",
        run_name: "t07-exp-07",
        selected_at: "2026-09-28T03:21:04+00:00",
        criterion: { metric: "best_val_loss", mode: "min", split: "val", tie_breakers: [] },
        test_split_used: false,
      }),
    );
    expect(await readCandidateSelection(root)).toEqual({
      runId: "fe32",
      runName: "t07-exp-07",
      selectedAt: "2026-09-28T03:21:04+00:00",
      criterion: { metric: "best_val_loss", mode: "min", split: "val" },
      testSplitUsed: false,
    });
  });

  it("404 si no hay selección", async () => {
    await expect(readCandidateSelection(root)).rejects.toMatchObject({ status: 404 });
  });
});
