import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { QUALITY_ARTIFACTS } from "./release-gate";
import {
  ARTIFACTS,
  dvcMd5,
  parseSplitReport,
  readApprovedReleases,
  readCandidateSelection,
  requireApprovedRelease,
  sourceCommit,
} from "./repo-artifacts";
import {
  CLEAN_MANIFEST,
  md5,
  writeRelease as writeFixtureRelease,
  writeRegistry,
} from "./testing/release-fixture";

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
      dvc_file_content:
        "# proyecto2 v1.1.0 @ dc9376eeb7f6dade3cfca4c0b8d95fd8773d8e57\n" +
        "# data/raw.dvc\nouts:\n- md5: 1fdb1dcea3218ad2fb0edf985984a929.dir\n  path: raw\n",
    }),
  );
  await writeGate();
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
  await write("data/splits/manifest.csv", CLEAN_MANIFEST);
  await write(
    ARTIFACTS.cropsDvc,
    "outs:\n- md5: f839dd62b048da0186ade1e382bb7f66.dir\n  path: crops\n",
  );
}

/** Registro de releases y reporte de la compuerta del Proyecto 2 (P1-1). */
async function writeGate({
  status = "pass",
  exitCode = 0,
  reportVersion = "v1.1.0",
  dataHash = "1fdb1dcea3218ad2fb0edf985984a929",
}: {
  status?: string;
  exitCode?: number;
  reportVersion?: string;
  dataHash?: string;
} = {}) {
  await write(
    QUALITY_ARTIFACTS.registry,
    JSON.stringify({
      versions: [
        { version: "v1.0.0", commit: "7e36ecc", dvcRevision: "2ae957bda56b5cf9293fd620b781e699" },
        { version: "v1.1.0", commit: "e4e33de", dvcRevision: dataHash },
      ],
    }),
  );
  await write(
    QUALITY_ARTIFACTS.gateReport,
    JSON.stringify({
      dataset_version: reportVersion,
      generated_at: "2026-09-19T03:06:11.894570Z",
      quality: {
        overall_status: status,
        exit_code: exitCode,
        checks: [
          { name: "min_images_per_class", status, severity: "fail", threshold: 300 },
          { name: "invalid_boxes", status: "pass", severity: "fail", threshold: 0 },
        ],
      },
    }),
  );
  await write(QUALITY_ARTIFACTS.policy, "checks:\n  invalid_boxes:\n    threshold: 0\n");
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

  it("sin split_report.csv el release no se lista (no tiene manifiesto 70/20/10)", async () => {
    await writeRelease();
    await rm(join(root, ARTIFACTS.splitReport));
    expect(await readApprovedReleases(root)).toEqual([]);
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

describe("P1-1: compuerta de calidad del Proyecto 2", () => {
  it("el release aprobado expone la evidencia de la compuerta: reporte, política y checks", async () => {
    await writeRelease();
    const [release] = await readApprovedReleases(root);
    expect(release.quality).toMatchObject({
      status: "pass",
      exitCode: 0,
      version: "v1.1.0",
      registryCommit: "e4e33de",
      dataHash: "1fdb1dcea3218ad2fb0edf985984a929",
      generatedAt: "2026-09-19T03:06:11.894570Z",
      registryFile: QUALITY_ARTIFACTS.registry,
      reportFile: QUALITY_ARTIFACTS.gateReport,
      policyFile: QUALITY_ARTIFACTS.policy,
    });
    expect(release.quality.reportMd5).toMatch(/^[0-9a-f]{32}$/);
    expect(release.quality.policySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(release.quality.checks.map((c) => c.name)).toEqual([
      "min_images_per_class",
      "invalid_boxes",
    ]);
  });

  it("un release con compuerta fallida no aparece", async () => {
    await writeRelease();
    await writeGate({ status: "fail", exitCode: 1 });
    expect(await readApprovedReleases(root)).toEqual([]);
  });

  it("sin reporte de la compuerta, el release no aparece", async () => {
    await writeRelease();
    await rm(join(root, QUALITY_ARTIFACTS.gateReport));
    expect(await readApprovedReleases(root)).toEqual([]);
  });

  it("un reporte de otra versión no aprueba este release", async () => {
    await writeRelease();
    await writeGate({ reportVersion: "v1.0.0" });
    expect(await readApprovedReleases(root)).toEqual([]);
  });

  it("si los datos no son los del registro del Proyecto 2, el release no aparece", async () => {
    await writeRelease();
    await writeGate({ dataHash: "0".repeat(32) });
    expect(await readApprovedReleases(root)).toEqual([]);
  });

  it("un manifiesto con fuga no se puede usar", async () => {
    await writeRelease();
    await write(ARTIFACTS.leakageReport, JSON.stringify({ semilla: 42, fuga: { total: 3 } }));
    expect(await readApprovedReleases(root)).toEqual([]);
    await expect(requireApprovedRelease(root, "proyecto2 v1.1.0@dc9376e")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("fuga"),
    });
  });

  it("requireApprovedRelease: devuelve el release aprobado", async () => {
    await writeRelease();
    await write(
      ARTIFACTS.manifestDvc,
      `outs:\n- md5: ${md5(CLEAN_MANIFEST)}\n  path: manifest.csv\n`,
    );
    const release = await requireApprovedRelease(root, "proyecto2 v1.1.0@dc9376e");
    expect(release.quality.status).toBe("pass");
  });

  it("requireApprovedRelease: 400 para un release que no existe", async () => {
    await writeRelease();
    await expect(requireApprovedRelease(root, "v9.9.9@noaprobado")).rejects.toMatchObject({
      status: 400,
      details: { release: [expect.stringContaining("proyecto2 v1.1.0@dc9376e")] },
    });
  });

  it("requireApprovedRelease: 400 con el motivo si la compuerta falló", async () => {
    await writeRelease();
    await writeGate({ status: "fail", exitCode: 1 });
    await expect(requireApprovedRelease(root, "proyecto2 v1.1.0@dc9376e")).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("no pasó"),
    });
  });

  it("el release real del repo pasa la compuerta con el reporte del Proyecto 2", async () => {
    const [release] = await readApprovedReleases(resolve(process.cwd(), ".."));
    expect(release.tag).toBe("proyecto2 v1.1.0@dc9376e");
    expect(release.quality).toMatchObject({ status: "pass", exitCode: 0, version: "v1.1.0" });
    // MD5 de reports/release.json en el dvc.lock del Proyecto 2 (etapa `release`).
    expect(release.quality.reportMd5).toBe("7975c619c6b2dc99ba4a052f70d522b0");
    expect(release.quality.checks).toHaveLength(6);
    expect(release.split.totals).toEqual({ train: 944, val: 270, test: 135, total: 1349 });
  });
});

describe("Actividad A (1.1): varios releases aprobados", () => {
  const V110 = "proyecto2 v1.1.0@dc9376e";
  const V100 = "proyecto2 v1.0.0@9c0b9a4";

  beforeEach(async () => {
    await writeRegistry(root);
    await writeFixtureRelease(root);
    await writeFixtureRelease(root, { version: "v1.0.0" });
  });

  it("lista los dos releases, cada uno con sus conteos, su hash y su manifiesto", async () => {
    const releases = await readApprovedReleases(root);
    expect(releases.map((r) => r.tag)).toEqual([V110, V100]);

    const [current, previous] = releases;
    expect(current.split.totals).toEqual({ train: 944, val: 270, test: 135, total: 1349 });
    expect(previous.split.totals).toEqual({ train: 945, val: 270, test: 135, total: 1350 });
    expect(current.quality.dataHash).toBe("1fdb1dcea3218ad2fb0edf985984a929");
    expect(previous.quality.dataHash).toBe("2ae957bda56b5cf9293fd620b781e699");
    expect(previous.provenance.annotationsMd5).not.toBe(current.provenance.annotationsMd5);
    expect(current.paths.manifest).toBe("data/splits/manifest.csv");
    expect(previous.paths).toEqual({
      manifest: "data/releases/v1.0.0/splits/manifest.csv",
      classes: "data/releases/v1.0.0/crops/classes.json",
      dataRoot: "data/releases/v1.0.0/crops",
    });
  });

  it("cada release se aprueba con el reporte de compuerta de SU versión", async () => {
    const [current, previous] = await readApprovedReleases(root);
    expect(current.quality).toMatchObject({
      version: "v1.1.0",
      reportFile: "annotation-backend/quality/reports/release.json",
    });
    expect(previous.quality).toMatchObject({
      version: "v1.0.0",
      reportFile: "annotation-backend/quality/releases/v1.0.0/release.json",
    });
  });

  it("si la compuerta del segundo release falló, solo aparece el primero", async () => {
    await writeFixtureRelease(root, { version: "v1.0.0", gate: { status: "fail", exitCode: 1 } });
    expect((await readApprovedReleases(root)).map((r) => r.tag)).toEqual([V110]);
  });

  it("el reporte de v1.1.0 no sirve para aprobar v1.0.0", async () => {
    await rm(join(root, "annotation-backend/quality/releases"), { recursive: true });
    expect((await readApprovedReleases(root)).map((r) => r.tag)).toEqual([V110]);
  });

  it("una carpeta de data/releases sin release_info.json se ignora", async () => {
    await write("data/releases/v0.0.1/notas.txt", "vacío");
    expect(await readApprovedReleases(root)).toHaveLength(2);
  });

  it("requireApprovedRelease encuentra cualquiera de los dos y revisa su manifiesto", async () => {
    expect((await requireApprovedRelease(root, V100)).tag).toBe(V100);
    expect((await requireApprovedRelease(root, V110)).tag).toBe(V110);
    await expect(requireApprovedRelease(root, "v9.9.9@noaprobado")).rejects.toMatchObject({
      status: 400,
      details: { release: [expect.stringContaining(V100)] },
    });
  });

  it("la fuga en el manifiesto de un release no bloquea al otro", async () => {
    await writeFixtureRelease(root, {
      version: "v1.0.0",
      manifest: CLEAN_MANIFEST.replace(
        "img000061,test\ncrops/61_81",
        "img000061,train\ncrops/61_81",
      ),
    });
    await expect(requireApprovedRelease(root, V100)).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("fuga entre particiones"),
    });
    expect((await requireApprovedRelease(root, V110)).tag).toBe(V110);
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
