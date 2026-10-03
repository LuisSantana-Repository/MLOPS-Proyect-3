import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCropPath } from "./crops";
import { parsePredictionsCsv } from "./evaluation-metrics";
import { readDatasetVersion } from "./evaluation-origin";

/**
 * Actividad B (6.3, 4.4) — correcciones de la revisión del PR #27.
 *
 * La versión del dataset que muestra /evaluation sale del release CON EL QUE SE ENTRENÓ
 * el run (etiqueta `dvc_release`), no siempre del release entregado. Se usan los
 * archivos reales del repo: `data/crops` (v1.1.0) y `data/releases/v1.0.0`.
 */

const REPO = resolve(process.cwd(), "..");

describe("readDatasetVersion: hashes del release del run", () => {
  it("sin etiquetas (respaldo del repo) usa el release entregado v1.1.0", async () => {
    expect(await readDatasetVersion(REPO, null)).toMatchObject({
      release: "proyecto2 v1.1.0@dc9376e",
      rawDvcMd5: "1fdb1dcea3218ad2fb0edf985984a929.dir",
      annotationsMd5: "72e5f4025c4dbe7eb1e2420a9b4dbf9a",
      manifestDvcMd5: "e75a07ce3b75455514f044b23e0d1b29",
    });
  });

  it("un run entrenado con v1.0.0 muestra los hashes de v1.0.0, no los de v1.1.0", async () => {
    const dataset = await readDatasetVersion(REPO, { dvc_release: "proyecto2 v1.0.0@9c0b9a4" });
    expect(dataset).toMatchObject({
      release: "proyecto2 v1.0.0@9c0b9a4",
      rawDvcMd5: "2ae957bda56b5cf9293fd620b781e699.dir",
      annotationsMd5: "fb3118e0aaa6aece8b70417d76b8eba7",
      manifestDvcMd5: "3903b3d1e8cb1c39e9f5820cb7e7f840",
    });
  });

  it("las etiquetas del run tienen prioridad sobre los archivos del release", async () => {
    const dataset = await readDatasetVersion(REPO, {
      dvc_release: "proyecto2 v1.0.0@9c0b9a4",
      release_annotations_md5: "a".repeat(32),
      manifest_dvc_md5: "b".repeat(32),
      manifest_sha256: "c".repeat(64),
    });
    expect(dataset.annotationsMd5).toBe("a".repeat(32));
    expect(dataset.manifestDvcMd5).toBe("b".repeat(32));
    expect(dataset.manifestSha256).toBe("c".repeat(64));
    expect(dataset.rawDvcMd5).toBe("2ae957bda56b5cf9293fd620b781e699.dir");
  });

  it("un release que no está en el repo no toma prestados los hashes de otro", async () => {
    const dataset = await readDatasetVersion(REPO, { dvc_release: "proyecto2 v9.9.9@abcdef0" });
    expect(dataset).toEqual({
      release: "proyecto2 v9.9.9@abcdef0",
      rawDvcMd5: null,
      annotationsMd5: null,
      manifestDvcMd5: null,
      manifestSha256: null,
    });
  });
});

describe("los 135 casos del test tienen una ruta de recorte válida (4.4)", () => {
  const { rows } = parsePredictionsCsv(
    readFileSync(resolve(REPO, "reports/t08/predictions.csv"), "utf-8"),
  );

  it("son 135 casos: 128 aciertos y 7 errores, sin recortes repetidos", () => {
    expect(rows).toHaveLength(135);
    expect(rows.filter((r) => r.yTrue === r.yPred)).toHaveLength(128);
    expect(new Set(rows.map((r) => r.cropPath)).size).toBe(135);
  });

  it("/api/crops acepta la ruta de los 135 (ninguna imagen rota por una ruta inválida)", () => {
    for (const row of rows) {
      expect(() => resolveCropPath(REPO, row.cropPath.split("/"))).not.toThrow();
    }
  });
});
