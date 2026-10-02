// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalNav } from "../components/layout/GlobalNav";

/**
 * SPEC-QUALITY-UI-001 — Shell de las seis vistas de calidad.
 *
 * Se mockean solo los hooks de datos (la red no es objeto de esta prueba).
 * El criterio de la story es que las seis vistas existan, estén enrutadas y
 * muestren datos reales del API (nunca cifras hardcodeadas).
 */

const mocks = vi.hoisted(() => ({
  overview: {} as { status: string; data?: unknown; message?: string },
}));

vi.mock("../hooks/quality/useQualityOverview", () => ({
  useQualityOverview: () => ({ ...mocks.overview, reload: vi.fn() }),
}));

import { OverviewPage } from "../pages/quality/OverviewPage";

const OVERVIEW_FIXTURE = {
  datasetVersion: "v1.0.0-demo",
  generatedAt: "2026-09-18T00:00:00+00:00",
  totals: { images: 12, annotations: 15, categories: 3 },
  gate: { overallStatus: "fail", exitCode: 1, passCount: 4, warnCount: 1, failCount: 1 },
  checks: [
    {
      name: "invalid_boxes",
      status: "fail",
      severity: "fail",
      threshold: 0,
      observed: { invalid_count: 1, total_annotations: 15 },
      samples: [],
    },
    {
      name: "duplicates",
      status: "warn",
      severity: "warn",
      threshold: 8,
      observed: { group_count: 1, pair_count: 1 },
      samples: [],
    },
  ],
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mocks.overview = { status: "loading" };
});

describe("SPEC-QUALITY-UI-001 — navegación de las seis vistas", () => {
  it("enruta Overview, Analyzers, Splits, Versions, Copilot y Settings", () => {
    render(
      <MemoryRouter>
        <GlobalNav />
      </MemoryRouter>,
    );

    const nav = screen.getByRole("navigation");
    const expected: Array<[RegExp, string]> = [
      [/resumen/i, "/overview"],
      [/analizadores/i, "/analyzers"],
      [/particiones/i, "/splits"],
      [/versiones/i, "/versions"],
      [/copilot/i, "/copilot"],
      [/configuraci/i, "/settings"],
    ];

    for (const [name, href] of expected) {
      const link = within(nav).getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
    }
  });
});

describe("SPEC-QUALITY-UI-002 — Overview con datos reales", () => {
  it("muestra los totales del dataset y la versión consultada", () => {
    mocks.overview = { status: "success", data: OVERVIEW_FIXTURE };

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("v1.0.0-demo")).toBeInTheDocument();
    const totals = within(screen.getByTestId("overview-totals"));
    expect(totals.getByText("12")).toBeInTheDocument();
    expect(totals.getByText("15")).toBeInTheDocument();
  });

  it("muestra el estado del gate y el conteo de checks fallidos", () => {
    mocks.overview = { status: "success", data: OVERVIEW_FIXTURE };

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("gate-status")).toHaveTextContent("FAIL");
    expect(screen.getByText(/checks fallidos/i)).toBeInTheDocument();
    expect(screen.getByText(/invalid_boxes/)).toBeInTheDocument();
  });

  it("muestra WARN cuando no hay fallos pero sí warnings", () => {
    mocks.overview = {
      status: "success",
      data: {
        ...OVERVIEW_FIXTURE,
        gate: { overallStatus: "pass", exitCode: 0, passCount: 5, warnCount: 1, failCount: 0 },
      },
    };

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("gate-status")).toHaveTextContent("WARN");
  });

  it("muestra un estado vacío explícito cuando no hay artefactos", () => {
    mocks.overview = {
      status: "empty",
      message: "No hay release.json. Ejecuta el pipeline de calidad.",
    };

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/sin datos/i)).toBeInTheDocument();
    expect(screen.getByText(/dvc repro/i)).toBeInTheDocument();
  });

  it("muestra un estado de error con mensaje del servidor", () => {
    mocks.overview = { status: "error", message: "Contrato roto." };

    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Contrato roto.")).toBeInTheDocument();
  });
});
