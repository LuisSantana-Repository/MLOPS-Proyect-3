import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findManifestLeaks, verifyManifest } from "./manifest-leakage";
import { CLEAN_MANIFEST, MANIFEST_HEADER, md5, writeRelease } from "./testing/release-fixture";

/** Actividad A (6.1) — el manifiesto ACTUAL se revisa antes de encolar, no su reporte. */

const PATH = "data/splits/manifest.csv";

/** El caso del evaluador: del original 61, la anotación 80 pasa a train y la 81 sigue en test. */
const EVALUATOR_LEAK = CLEAN_MANIFEST.replace(
  "crops/61_80.jpg,80,61,1,person,0,img000061,test",
  "crops/61_80.jpg,80,61,1,person,0,img000061,train",
);

describe("findManifestLeaks", () => {
  it("un manifiesto limpio no tiene cruces", () => {
    expect(findManifestLeaks(CLEAN_MANIFEST)).toEqual({
      rows: 6,
      splits: { train: 3, val: 1, test: 2 },
      leaks: [],
    });
  });

  it("caso del evaluador: image_id 61 con la anotación 80 en train y otro recorte en test", () => {
    const { leaks } = findManifestLeaks(EVALUATOR_LEAK);
    expect(leaks).toContainEqual({ key: "image_id", value: "61", splits: ["test", "train"] });
    expect(leaks).toContainEqual({
      key: "group_id",
      value: "img000061",
      splits: ["test", "train"],
    });
  });

  it("detecta un grupo de casi-duplicados repartido entre particiones", () => {
    const text = [
      MANIFEST_HEADER,
      "crops/1_1.jpg,1,1,1,person,0,dup000007,train",
      "crops/2_2.jpg,2,2,1,person,0,dup000007,val",
    ].join("\n");
    expect(findManifestLeaks(text).leaks).toEqual([
      { key: "group_id", value: "dup000007", splits: ["train", "val"] },
    ]);
  });

  it("detecta la misma anotación en dos particiones", () => {
    const text = [
      MANIFEST_HEADER,
      "crops/1_1.jpg,1,1,1,person,0,img000001,train",
      "crops/1_1.jpg,1,1,1,person,0,img000001,test",
    ].join("\r\n");
    expect(findManifestLeaks(text).leaks.map((l) => l.key)).toEqual([
      "image_id",
      "group_id",
      "ann_id",
    ]);
  });

  it("400 si el manifiesto no trae las columnas para revisar la fuga", () => {
    expect(() => findManifestLeaks("crop_path,split\ncrops/a.jpg,train")).toThrow(
      /image_id, group_id, ann_id/,
    );
  });
});

describe("verifyManifest", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "manifest-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("acepta el manifiesto versionado y sin cruces", async () => {
    await writeRelease(root);
    const check = await verifyManifest(root, PATH, md5(CLEAN_MANIFEST));
    expect(check.rows).toBe(6);
    expect(check.leaks).toEqual([]);
  });

  it("400 con el detalle del cruce si hay fuga", async () => {
    await writeRelease(root, { manifest: EVALUATOR_LEAK });
    await expect(verifyManifest(root, PATH, md5(EVALUATOR_LEAK))).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("image_id 61 en test y train"),
    });
  });

  it("400 si el manifiesto no es el versionado en DVC", async () => {
    await writeRelease(root);
    await expect(verifyManifest(root, PATH, "0".repeat(32))).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("no es el versionado en DVC"),
    });
  });

  it("400 si falta el archivo (no se entrena sin poder revisarlo)", async () => {
    await writeRelease(root, { manifest: null });
    await expect(verifyManifest(root, PATH, md5(CLEAN_MANIFEST))).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("dvc pull"),
    });
  });
});
