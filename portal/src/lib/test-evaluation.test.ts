import { describe, expect, it, vi } from "vitest";
import { fetchMlflowArtifact, PREDICTIONS_ARTIFACT } from "./test-evaluation";

const RUN = "fe32e1388dbd465cae714a69bf80f685";
const CSV = [
  "crop_path,ann_id,image_id,y_true,y_pred,correct,prob_person,prob_car",
  "crops/1_1.jpg,1,1,person,person,1,0.900000,0.100000",
  "crops/2_2.jpg,2,2,car,person,0,0.600000,0.400000",
].join("\n");

const respond = (status: number, body = "") =>
  vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch &
    ReturnType<typeof vi.fn>;

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
    await expect(
      fetchMlflowArtifact(RUN, PREDICTIONS_ARTIFACT, respond(500, "boom")),
    ).rejects.toMatchObject({
      status: 502,
    });
  });

  it("MLflow caído -> 502", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(fetchMlflowArtifact(RUN, PREDICTIONS_ARTIFACT, down)).rejects.toMatchObject({
      status: 502,
    });
  });
});
