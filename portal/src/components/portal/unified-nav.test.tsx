// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { GlobalNav } from "@p2/components/layout/GlobalNav";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANNOTATION_ROUTES, MODEL_ROUTES, QUALITY_ROUTES } from "./routes";

const nextNavigation = vi.hoisted(() => ({ pathname: "/training" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nextNavigation.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { PortalShell } from "./PortalShell";

afterEach(() => {
  cleanup();
});

describe("P0-2: menú único del portal", () => {
  it("el menú enlaza anotación, calidad y las cinco páginas del modelo", () => {
    render(
      <MemoryRouter>
        <GlobalNav />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation");
    for (const route of [...ANNOTATION_ROUTES, ...QUALITY_ROUTES, ...MODEL_ROUTES]) {
      expect(within(nav).getByRole("link", { name: route.label })).toHaveAttribute(
        "href",
        route.to,
      );
    }
    expect(within(nav).getAllByRole("link")).toHaveLength(
      ANNOTATION_ROUTES.length + QUALITY_ROUTES.length + MODEL_ROUTES.length,
    );
  });

  it("una página del modelo se dibuja dentro del menú del portal, marcada como activa", () => {
    nextNavigation.pathname = "/training";
    render(
      <PortalShell>
        <main>contenido de training</main>
      </PortalShell>,
    );
    expect(screen.getByText("contenido de training")).toBeInTheDocument();
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: "Tablero" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    expect(within(nav).getByRole("link", { name: "Training" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("las pantallas de anotación no duplican el menú (ya traen el suyo)", () => {
    nextNavigation.pathname = "/dashboard";
    render(
      <PortalShell>
        <main>tablero</main>
      </PortalShell>,
    );
    expect(screen.getByText("tablero")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
