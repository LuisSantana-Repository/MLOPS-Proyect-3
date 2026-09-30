import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCropImage, resolveCropPath } from "./crops";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "crops-"));
  await mkdir(join(root, "data", "crops", "crops"), { recursive: true });
  await writeFile(join(root, "data", "crops", "crops", "12_345.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("resolveCropPath", () => {
  it("acepta crop_path de T03 (crops/<image_id>_<ann_id>.jpg)", () => {
    expect(resolveCropPath(root, ["crops", "12_345.jpg"])).toBe(join(root, "data", "crops", "crops", "12_345.jpg"));
  });

  it.each([
    [["..", "..", "etc", "passwd"]],
    [["crops", "..", "..", "secret.jpg"]],
    [["crops", "a", "b.jpg"]],
    [["crops", "x.png"]],
    [["crops", "%2e%2e.jpg"]],
    [["otra", "x.jpg"]],
    [[]],
  ])("rechaza rutas fuera de data/crops o que no son recortes: %j", (segments) => {
    let status: number | undefined;
    try {
      resolveCropPath(root, segments);
    } catch (err) {
      status = (err as { status?: number }).status;
    }
    expect(status).toBe(400);
  });
});

describe("readCropImage", () => {
  it("devuelve los bytes del jpg", async () => {
    const bytes = await readCropImage(root, ["crops", "12_345.jpg"]);
    expect([...bytes]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("404 si el recorte no existe (p. ej. falta dvc pull)", async () => {
    await expect(readCropImage(root, ["crops", "9_9.jpg"])).rejects.toMatchObject({ status: 404 });
  });
});
