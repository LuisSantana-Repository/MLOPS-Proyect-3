import { describe, expect, it } from "vitest";
import { INFERENCE_LIMITS } from "@/contracts";
import type { ApiError } from "@/lib/http";
import { sniffImageType, uploadKey, validateUpload } from "./images";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

function file(bytes: Uint8Array, type: string, name = "x") {
  return new File([new Uint8Array(bytes)], name, { type });
}

async function rejection(input: unknown): Promise<ApiError> {
  try {
    await validateUpload(input);
  } catch (err) {
    return err as ApiError;
  }
  throw new Error("se esperaba un error");
}

describe("sniffImageType", () => {
  it("reconoce JPEG y PNG por su firma", () => {
    expect(sniffImageType(JPEG)?.type).toBe("image/jpeg");
    expect(sniffImageType(PNG)?.type).toBe("image/png");
    expect(sniffImageType(new TextEncoder().encode("hola"))).toBeNull();
  });
});

describe("validateUpload", () => {
  it("acepta JPEG y calcula el SHA-256 del contenido", async () => {
    const img = await validateUpload(file(JPEG, "image/jpeg", "a.jpg"));
    expect(img).toMatchObject({ contentType: "image/jpeg", ext: "jpg", filename: "a.jpg" });
    expect(img.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(uploadKey(img)).toBe(`uploads/${img.sha256}.jpg`);
  });

  it("decide el tipo por los bytes, no por lo que declara el navegador", async () => {
    const img = await validateUpload(file(PNG, "image/jpeg", "mentira.jpg"));
    expect(img.contentType).toBe("image/png");
  });

  it("rechaza un texto renombrado a .jpg", async () => {
    const err = await rejection(
      file(new TextEncoder().encode("no soy imagen"), "image/jpeg", "a.jpg"),
    );
    expect(err.status).toBe(400);
    expect(err.message).toContain("JPEG o PNG");
  });

  it("rechaza archivos vacíos, ausentes o demasiado grandes", async () => {
    expect((await rejection(file(new Uint8Array(), "image/jpeg"))).message).toContain("vacía");
    expect((await rejection(null)).message).toContain("Falta la imagen");
    const big = new Uint8Array(INFERENCE_LIMITS.maxBytes + 1);
    big.set(JPEG);
    expect((await rejection(file(big, "image/jpeg"))).message).toContain("MB");
  });
});
