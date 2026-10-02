// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embeddings: {} as { status: string; data?: unknown; message?: string },
}));

vi.mock("../hooks/quality/useQualityEmbeddings", () => ({
  useQualityEmbeddings: () => ({ ...mocks.embeddings, reload: vi.fn() }),
}));

import { AnalyticsPage } from "../pages/quality/AnalyticsPage";

const ANALYTICS_FIXTURE = {
  datasetVersion: "v1.0.0-demo",
  method: "pca",
  generatedAt: "2026-09-18T00:00:00+00:00",
  explainedVariance: [0.4, 0.25],
  categories: [
    { id: 1, name: "person" },
    { id: 2, name: "car" },
  ],
  points: [
    { image_id: 1, file_name: "a.jpg", x: -0.5, y: 0.2, category_ids: [1], box_count: 1 },
    { image_id: 2, file_name: "b.jpg", x: 0.3, y: -0.4, category_ids: [2], box_count: 1 },
    { image_id: 3, file_name: "c.jpg", x: 0.1, y: 0.6, category_ids: [1, 2], box_count: 2 },
    { image_id: 4, file_name: "d.jpg", x: -0.2, y: -0.7, category_ids: [2], box_count: 1 },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AnalyticsPage />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  mocks.embeddings = { status: "loading" };
});

/**
 * SPEC-QUALITY-UI-007 — Analítica exploratoria offline.
 *
 * Los puntos se pintan con coordenadas precomputadas; el hover previsualiza
 * la imagen y el filtro por clase ocurre en el cliente, sin recargar.
 */
describe("SPEC-QUALITY-UI-007 — Analítica exploratoria", () => {
  it("pinta un punto por imagen con las coordenadas precomputadas", () => {
    mocks.embeddings = { status: "success", data: ANALYTICS_FIXTURE };
    renderPage();

    expect(screen.getAllByTestId(/^embedding-point-/)).toHaveLength(4);
    expect(screen.getByText(/varianza explicada/i)).toBeInTheDocument();
  });

  it("previsualiza la imagen al hacer hover en un punto", () => {
    mocks.embeddings = { status: "success", data: ANALYTICS_FIXTURE };
    renderPage();

    fireEvent.mouseEnter(screen.getByTestId("embedding-point-3"));

    expect(screen.getByAltText("Imagen 3")).toBeInTheDocument();
  });

  it("filtra por clase en el cliente sin recargar la vista", () => {
    mocks.embeddings = { status: "success", data: ANALYTICS_FIXTURE };
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "person" }));

    expect(screen.getAllByTestId(/^embedding-point-/)).toHaveLength(2);
  });

  it("muestra estado vacío sin coordenadas", () => {
    mocks.embeddings = { status: "empty", message: "No hay embeddings.json." };
    renderPage();

    expect(screen.getByText(/sin datos/i)).toBeInTheDocument();
  });

  it("muestra estado de error", () => {
    mocks.embeddings = { status: "error", message: "Contrato roto." };
    renderPage();

    expect(screen.getByText("Contrato roto.")).toBeInTheDocument();
  });
});
