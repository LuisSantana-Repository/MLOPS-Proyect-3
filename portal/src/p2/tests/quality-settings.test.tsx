// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({ updateQualitySettings: vi.fn() }));
vi.mock("../api/quality", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/quality")>();
  return { ...actual, updateQualitySettings: apiMocks.updateQualitySettings };
});

const hookMocks = vi.hoisted(() => ({
  settings: {} as { status: string; data?: unknown; message?: string },
}));
vi.mock("../hooks/quality/useQualitySettings", () => ({
  useQualitySettings: () => ({ ...hookMocks.settings, reload: vi.fn() }),
}));

import { SettingsPage } from "../pages/quality/SettingsPage";

const SETTINGS_FIXTURE = {
  checks: {
    min_images_per_class: { threshold: 300, severity: "fail", min_classes: 2 },
    small_objects: { threshold: 32, severity: "warn" },
    class_imbalance: { threshold: 10, severity: "warn" },
    duplicates: { threshold: 8, severity: "warn" },
    invalid_boxes: { threshold: 0, severity: "fail" },
    spatial_bias: { threshold: 0.5, severity: "warn" },
  },
  splits: { train: 0.7, val: 0.15, test: 0.15, seed: 42 },
};

afterEach(cleanup);

beforeEach(() => {
  apiMocks.updateQualitySettings.mockReset();
  hookMocks.settings = { status: "success", data: SETTINGS_FIXTURE };
});

/**
 * SPEC-QUALITY-UI-006 — Settings edita y persiste quality.yaml.
 */
describe("SPEC-QUALITY-UI-006 — Settings", () => {
  it("muestra los umbrales y severidades actuales de la política", () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("min_images_per_class-threshold")).toHaveValue(300);
    expect(screen.getByLabelText("small_objects-severity")).toHaveValue("warn");
    expect(screen.getByLabelText("splits-seed")).toHaveValue(42);
  });

  it("persiste el cambio de un umbral", async () => {
    apiMocks.updateQualitySettings.mockResolvedValue(SETTINGS_FIXTURE);
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("small_objects-threshold"), { target: { value: "48" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(apiMocks.updateQualitySettings).toHaveBeenCalledTimes(1));
    expect(apiMocks.updateQualitySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        checks: expect.objectContaining({
          small_objects: expect.objectContaining({ threshold: 48 }),
        }),
      }),
    );
  });

  it("señala el comando para volver a ejecutar el Quality Gate", () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/dataset_quality\.cli/)).toBeInTheDocument();
  });

  it("rechaza proporciones que no suman 1 sin llamar al API", async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("splits-train"), { target: { value: "0.9" } });
    fireEvent.click(screen.getByRole("button", { name: /guardar/i }));

    expect(apiMocks.updateQualitySettings).not.toHaveBeenCalled();
    expect(screen.getByText(/sumar 1/i)).toBeInTheDocument();
  });

  it("muestra estado vacío sin quality.yaml", () => {
    hookMocks.settings = { status: "empty", message: "No hay archivo de política." };
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/sin datos/i)).toBeInTheDocument();
  });

  it("muestra estado de error", () => {
    hookMocks.settings = { status: "error", message: "Política corrupta." };
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Política corrupta.")).toBeInTheDocument();
  });
});
