// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyzers: {} as { status: string; data?: unknown; message?: string },
}));

vi.mock("../hooks/quality/useQualityAnalyzers", () => ({
  useQualityAnalyzers: () => ({ ...mocks.analyzers, reload: vi.fn() }),
}));

import { AnalyzersPage } from "../pages/quality/AnalyzersPage";

const ANALYZERS_FIXTURE = {
  datasetVersion: "v1.0.0-demo",
  categories: [
    { id: 1, name: "person" },
    { id: 2, name: "car" },
    { id: 3, name: "dog" },
  ],
  smallObjects: {
    threshold_px: 32,
    severity: "warn",
    total_annotations: 15,
    small_count: 2,
    small_percent: 13.33,
    percent_by_category: { "1": 0, "2": 0, "3": 50 },
    most_affected_category_id: 3,
    offending_samples: [
      { annotation_id: 14, image_id: 9, category_id: 3, width: 12, height: 10 },
      { annotation_id: 15, image_id: 10, category_id: 3, width: 0, height: 80 },
    ],
  },
  classImbalance: {
    threshold: 10,
    severity: "warn",
    distributions: [
      { category_id: 1, distinct_image_count: 6, box_count: 6 },
      { category_id: 2, distinct_image_count: 5, box_count: 5 },
      { category_id: 3, distinct_image_count: 3, box_count: 4 },
    ],
    majority_category_id: 1,
    minority_category_id: 3,
    ratio: 2,
    classes_below_min_images: [3],
  },
  duplicates: {
    threshold: 8,
    severity: "warn",
    pairs: [{ image_id_a: 11, image_id_b: 12, distance: 0, similarity_percent: 100 }],
    duplicate_groups: [[11, 12]],
  },
  invalidBoxes: {
    threshold: 0,
    severity: "fail",
    total_annotations: 15,
    invalid_count: 1,
    invalid_boxes: [
      {
        annotation_id: 15,
        image_id: 10,
        bbox: [200, 300, 0, 80],
        reasons: ["zero_or_negative_size"],
      },
    ],
  },
  spatialBias: {
    threshold: 0.5,
    severity: "warn",
    global_stats: {
      count: 15,
      mean_x: 0.4,
      mean_y: 0.63,
      median_x: 0.31,
      median_y: 0.7,
      std_x: 0.19,
      std_y: 0.19,
      p25_x: 0.27,
      p75_x: 0.53,
      p25_y: 0.44,
      p75_y: 0.81,
    },
    stats_by_category: {
      "1": {
        count: 6,
        mean_x: 0.3,
        mean_y: 0.51,
        median_x: 0.27,
        median_y: 0.46,
        std_x: 0.12,
        std_y: 0.08,
        p25_x: 0.21,
        p75_x: 0.39,
        p25_y: 0.44,
        p75_y: 0.6,
      },
    },
  },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AnalyzersPage />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  mocks.analyzers = { status: "loading" };
});

/**
 * SPEC-QUALITY-UI-003 — Analyzers con las cinco pestañas.
 *
 * Las gráficas alimentadas por datos reales y las muestras ofensoras deben
 * ser navegables a la imagen concreta.
 */
describe("SPEC-QUALITY-UI-003 — Analyzers", () => {
  it("renderiza las cinco pestañas de analizadores", () => {
    mocks.analyzers = { status: "success", data: ANALYZERS_FIXTURE };
    renderPage();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(screen.getByRole("tab", { name: /objetos peque/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /desbalance/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /duplicados/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /cajas inv/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /sesgo espacial/i })).toBeInTheDocument();
  });

  it("muestra el reporte de objetos pequeños con sus muestras navegables", () => {
    mocks.analyzers = { status: "success", data: ANALYZERS_FIXTURE };
    renderPage();

    expect(screen.getByText(/13\.33/)).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /ver imagen/i });
    expect(links[0]).toHaveAttribute("href", "/annotate/9");
  });

  it("cambia a la pestaña de cajas inválidas y muestra el motivo", () => {
    mocks.analyzers = { status: "success", data: ANALYZERS_FIXTURE };
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: /cajas inv/i }));

    expect(screen.getByText(/zero_or_negative_size/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ver imagen/i })).toHaveAttribute(
      "href",
      "/annotate/10",
    );
  });

  it("grafica los pares de duplicados por distancia de pHash", () => {
    mocks.analyzers = { status: "success", data: ANALYZERS_FIXTURE };
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: /duplicados/i }));

    expect(screen.getByText(/distancia phash por par/i)).toBeInTheDocument();
  });

  it("grafica las cajas inválidas por motivo", () => {
    mocks.analyzers = { status: "success", data: ANALYZERS_FIXTURE };
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: /cajas inv/i }));

    expect(screen.getByText(/cajas inválidas por motivo/i)).toBeInTheDocument();
  });

  it("grafica el sesgo espacial con un scatter de centros", () => {
    mocks.analyzers = { status: "success", data: ANALYZERS_FIXTURE };
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: /sesgo espacial/i }));

    const scatter = screen.getByTestId("spatial-scatter");
    expect(scatter.tagName.toLowerCase()).toBe("svg");
  });

  it("muestra umbral y severidad en las cinco pestañas", () => {
    mocks.analyzers = { status: "success", data: ANALYZERS_FIXTURE };
    renderPage();

    const tabs = [/objetos peque/i, /desbalance/i, /duplicados/i, /cajas inv/i, /sesgo espacial/i];

    for (const tab of tabs) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      const panel = within(screen.getByRole("tabpanel"));
      expect(panel.getByText(/umbral/i)).toBeInTheDocument();
      expect(panel.getByText(/severidad/i)).toBeInTheDocument();
    }
  });

  it("muestra estado vacío explícito sin artefactos", () => {
    mocks.analyzers = { status: "empty", message: "No hay release.json." };
    renderPage();

    expect(screen.getByText(/sin datos/i)).toBeInTheDocument();
  });

  it("muestra estado de error", () => {
    mocks.analyzers = { status: "error", message: "Contrato roto." };
    renderPage();

    expect(screen.getByText("Contrato roto.")).toBeInTheDocument();
  });
});
