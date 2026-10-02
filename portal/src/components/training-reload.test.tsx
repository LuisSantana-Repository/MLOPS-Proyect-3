// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovedRelease, TrainingJobResponse } from "@/contracts";
import { JOB_STORAGE_KEY } from "@/lib/ui/job-persistence";
import { TrainingDashboard } from "./TrainingDashboard";

/**
 * Actividad A (6.1) — al recargar /training reaparecen el progreso y los logs del job,
 * leídos de la API (no de memoria del navegador).
 */

const JOB_ID = "11111111-2222-3333-4444-555555555555";

const release = {
  tag: "proyecto2 v1.1.0@dc9376e",
  provenance: {
    sourceCommit: "dc9376e",
    annotationsMd5: "72e5",
    manifestMd5: "e75a",
    cropsMd5: null,
  },
  paths: {
    manifest: "data/splits/manifest.csv",
    classes: "data/crops/classes.json",
    dataRoot: "data/crops",
  },
  quality: {
    status: "pass",
    exitCode: 0,
    version: "v1.1.0",
    registryCommit: "e4e33de",
    dataHash: "1fdb",
    generatedAt: null,
    registryFile: "versions.json",
    reportFile: "release.json",
    reportMd5: "7975",
    policyFile: "quality.yaml",
    policySha256: null,
    checks: [],
  },
  classes: ["person", "car"],
  split: {
    seed: 42,
    totals: { train: 944, val: 270, test: 135, total: 1349 },
    byClass: {},
    leakage: 0,
    testFingerprint: null,
  },
} satisfies ApprovedRelease;

const job: TrainingJobResponse = {
  id: JOB_ID,
  status: "succeeded",
  release: release.tag,
  params: {} as TrainingJobResponse["params"],
  runId: "run-abc",
  error: null,
  logs: [
    { ts: "2026-10-02T10:00:00Z", level: "info", message: "época 1: val_loss=0.3000" },
    { ts: "2026-10-02T10:01:00Z", level: "info", message: "terminado: best_val_loss=0.3000" },
  ],
  createdAt: "2026-10-02T10:00:00Z",
  updatedAt: "2026-10-02T10:01:00Z",
};

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.startsWith("/api/releases")) return Response.json({ releases: [release] });
  if (url === `/api/training/jobs/${JOB_ID}`) return Response.json(job);
  return Response.json({ error: { code: "not_found", message: "no existe" } }, { status: 404 });
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/training");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Actividad A: el job sobrevive a la recarga", () => {
  it("con ?job=<id> en la URL reaparecen el estado, el run y los logs del job", async () => {
    window.history.replaceState(null, "", `/training?job=${JOB_ID}`);

    render(<TrainingDashboard />);

    expect(await screen.findByText(JOB_ID)).toBeInTheDocument();
    expect(await screen.findByText("Terminado")).toBeInTheDocument();
    expect(screen.getByText("run-abc")).toBeInTheDocument();
    expect(screen.getByText(/época 1: val_loss=0.3000/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(`/api/training/jobs/${JOB_ID}`, expect.anything());
  });

  it("sin ?job= recupera el último job guardado en localStorage", async () => {
    window.localStorage.setItem(JOB_STORAGE_KEY, JOB_ID);

    render(<TrainingDashboard />);

    expect(await screen.findByText(/terminado: best_val_loss=0.3000/)).toBeInTheDocument();
    // El id recuperado también queda en la URL, para poder compartir o recargar el enlace.
    expect(window.location.search).toBe(`?job=${JOB_ID}`);
  });

  it("si el navegador bloquea localStorage, la página no truena y ?job= sigue funcionando", async () => {
    const blocked = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    window.history.replaceState(null, "", `/training?job=${JOB_ID}`);

    try {
      render(<TrainingDashboard />);
      expect(await screen.findByText(/época 1: val_loss=0.3000/)).toBeInTheDocument();
      expect(blocked).toHaveBeenCalled();
    } finally {
      blocked.mockRestore();
    }
  });

  it("sin job previo no muestra el panel de progreso", async () => {
    render(<TrainingDashboard />);

    expect(await screen.findByText("1. Release aprobado")).toBeInTheDocument();
    expect(screen.queryByText("3. Progreso")).not.toBeInTheDocument();
  });
});
