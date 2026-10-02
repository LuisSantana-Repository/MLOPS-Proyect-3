// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QualityEmptyState } from "../components/quality/QualityEmptyState";

afterEach(cleanup);

/**
 * C-03 — el estado "sin datos" dice el comando EXACTO que lo resuelve.
 *
 * `dvc pull` sin `-r` falla porque .dvc/config no define remoto por defecto, y
 * quien no tiene acceso a los remotos necesita otra salida: `make demo`.
 */
describe("C-03 — estado sin datos", () => {
  it("muestra el mensaje que recibe", () => {
    render(<QualityEmptyState message="No hay release.json." />);

    expect(screen.getByText("No hay release.json.")).toBeInTheDocument();
  });

  it("indica el pull del remoto correcto, el pipeline y el arranque, en ese orden", () => {
    render(<QualityEmptyState message="x" />);

    const commands = screen.getByText(/dvc pull -r prod/).textContent ?? "";

    expect(commands.indexOf("dvc pull -r prod")).toBeLessThan(commands.indexOf("dvc repro"));
    expect(commands.indexOf("dvc repro")).toBeLessThan(
      commands.indexOf("docker compose up --build"),
    );
  });

  it("ofrece make demo para quien no tiene acceso a los remotos de DVC", () => {
    render(<QualityEmptyState message="x" />);

    expect(screen.getByText(/make demo/)).toBeInTheDocument();
    expect(screen.getByText(/sin acceso a los remotos/i)).toBeInTheDocument();
  });
});
