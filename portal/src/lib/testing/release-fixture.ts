import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Repo de prueba con releases del Proyecto 2 (solo para tests): escribe en una carpeta
 * temporal los mismos artefactos que lee el portal (release_info, split, manifiesto,
 * registro y compuerta de calidad). No es un dato del portal.
 */

export const MANIFEST_HEADER =
  "crop_path,ann_id,image_id,category_id,category_name,class_index,group_id,split";

/** Manifiesto pequeño y limpio: cada original (y su grupo) vive en una sola partición. */
export const CLEAN_MANIFEST = [
  MANIFEST_HEADER,
  "crops/3_2.jpg,2,3,1,person,0,img000003,train",
  "crops/3_3.jpg,3,3,2,car,1,img000003,train",
  "crops/4_4.jpg,4,4,1,person,0,img000004,train",
  "crops/9_12.jpg,12,9,2,car,1,img000009,val",
  "crops/61_80.jpg,80,61,1,person,0,img000061,test",
  "crops/61_81.jpg,81,61,1,person,0,img000061,test",
].join("\n");

export interface ReleaseFixture {
  /** Carpeta del release dentro del repo: "" = el entregado (data/crops, data/splits). */
  version?: string;
  tag?: string;
  dataHash?: string;
  commit?: string;
  manifest?: string | null;
  /** md5 anotado en manifest.csv.dvc; por defecto, el del manifiesto escrito. */
  manifestDvcMd5?: string;
  splitCsv?: string;
  leakTotal?: number;
  gate?: { status: string; exitCode: number } | null;
  /** Dónde va el reporte: "reports" (release vigente) o "releases" (por versión). */
  gateLocation?: "reports" | "releases";
}

export const SPLIT_V110 =
  "clase,total,train,train_pct,val,val_pct,test,test_pct\n" +
  "car,537,375,69.8,108,20.1,54,10.1\n" +
  "person,812,569,70.1,162,20.0,81,10.0\n" +
  "TOTAL,1349,944,70.0,270,20.0,135,10.0\n";

export const SPLIT_V100 =
  "clase,total,train,train_pct,val,val_pct,test,test_pct\n" +
  "car,538,377,70.1,107,19.9,54,10.0\n" +
  "person,812,568,70.0,163,20.1,81,10.0\n" +
  "TOTAL,1350,945,70.0,270,20.0,135,10.0\n";

export const md5 = (text: string) => createHash("md5").update(text).digest("hex");

async function write(root: string, path: string, content: string) {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
}

/** Registro de releases del Proyecto 2 con las dos versiones. */
export async function writeRegistry(
  root: string,
  hashes: Record<string, string> = {
    "v1.0.0": "2ae957bda56b5cf9293fd620b781e699",
    "v1.1.0": "1fdb1dcea3218ad2fb0edf985984a929",
  },
) {
  await write(
    root,
    "annotation-backend/quality/reports/versions.json",
    JSON.stringify({
      versions: Object.entries(hashes).map(([version, dvcRevision]) => ({
        version,
        commit: version === "v1.0.0" ? "7e36ecc" : "e4e33de",
        dvcRevision,
      })),
    }),
  );
  await write(
    root,
    "annotation-backend/quality/quality.yaml",
    "checks:\n  invalid_boxes:\n    threshold: 0\n",
  );
}

export async function writeRelease(root: string, options: ReleaseFixture = {}) {
  const version = options.version ?? "v1.1.0";
  const delivered = version === "v1.1.0";
  const base = delivered ? "data" : `data/releases/${version}`;
  const tag =
    options.tag ?? (delivered ? "proyecto2 v1.1.0@dc9376e" : `proyecto2 ${version}@9c0b9a4`);
  const dataHash =
    options.dataHash ??
    (delivered ? "1fdb1dcea3218ad2fb0edf985984a929" : "2ae957bda56b5cf9293fd620b781e699");
  const commit =
    options.commit ?? (delivered ? "dc9376eeb7f6dade3cfca4c0b8d95fd8773d8e57" : "9c0b9a4");

  await write(
    root,
    `${base}/crops/release_info.json`,
    JSON.stringify({
      release_tag: tag,
      annotations_md5: delivered
        ? "72e5f4025c4dbe7eb1e2420a9b4dbf9a"
        : "fb3118e0aaa6aece8b70417d76b8eba7",
      dvc_file_content: `# proyecto2 ${version} @ ${commit}\n# data/raw.dvc\nouts:\n- md5: ${dataHash}.dir\n  path: raw\n`,
    }),
  );
  await write(root, `${base}/crops/classes.json`, JSON.stringify({ "0": "person", "1": "car" }));
  await write(
    root,
    `${base}/crops/crops.dvc`,
    "outs:\n- md5: f839dd62b048da0186ade1e382bb7f66.dir\n  path: crops\n",
  );
  await write(
    root,
    `${base}/splits/split_report.csv`,
    options.splitCsv ?? (delivered ? SPLIT_V110 : SPLIT_V100),
  );
  await write(
    root,
    `${base}/splits/leakage_report.json`,
    JSON.stringify({
      semilla: 42,
      fuga: { total: options.leakTotal ?? 0 },
      test_huella_sha256: "abc",
    }),
  );

  const manifest = options.manifest === undefined ? CLEAN_MANIFEST : options.manifest;
  if (manifest !== null) await write(root, `${base}/splits/manifest.csv`, manifest);
  await write(
    root,
    `${base}/splits/manifest.csv.dvc`,
    `outs:\n- md5: ${options.manifestDvcMd5 ?? md5(manifest ?? CLEAN_MANIFEST)}\n  path: manifest.csv\n`,
  );

  if (options.gate !== null) {
    const gate = options.gate ?? { status: "pass", exitCode: 0 };
    const location = options.gateLocation ?? (delivered ? "reports" : "releases");
    await write(
      root,
      location === "reports"
        ? "annotation-backend/quality/reports/release.json"
        : `annotation-backend/quality/releases/${version}/release.json`,
      JSON.stringify({
        dataset_version: version,
        generated_at: "2026-09-19T03:06:11.894570Z",
        quality: {
          overall_status: gate.status,
          exit_code: gate.exitCode,
          checks: [{ name: "invalid_boxes", status: gate.status, severity: "fail", threshold: 0 }],
        },
      }),
    );
  }
}
