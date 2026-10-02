import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config.mjs";
import { ANNOTATION_ROUTES, isAnnotationPortalPath, MODEL_ROUTES, QUALITY_ROUTES } from "./routes";

const APP_DIR = resolve(__dirname, "../../app");

function hasPage(...segments: string[]): boolean {
  return existsSync(resolve(APP_DIR, ...segments, "page.tsx"));
}

describe("P0-2: un solo portal para los Proyectos 1, 2 y 3", () => {
  it("las pantallas de anotación y calidad son páginas de esta misma app", () => {
    const routes = [...ANNOTATION_ROUTES, ...QUALITY_ROUTES].map((route) => route.to);
    expect(routes).toEqual([
      "/dashboard",
      "/search",
      "/upload",
      "/overview",
      "/analyzers",
      "/analytics",
      "/splits",
      "/versions",
      "/copilot",
      "/settings",
    ]);
    for (const route of routes) {
      expect(hasPage("(annotation)", route.slice(1)), `falta la página ${route}`).toBe(true);
    }
    expect(hasPage("(annotation)", "annotate", "[imageId]")).toBe(true);
  });

  it("las cinco páginas del modelo siguen en la misma app", () => {
    const routes = MODEL_ROUTES.map((route) => route.to);
    expect(routes).toEqual(
      expect.arrayContaining(["/training", "/experiments", "/evaluation", "/models", "/inference"]),
    );
    for (const route of routes) {
      expect(hasPage(route.slice(1)), `falta la página ${route}`).toBe(true);
    }
  });

  it("distingue las pantallas del portal de anotación de las páginas del modelo", () => {
    expect(isAnnotationPortalPath("/dashboard")).toBe(true);
    expect(isAnnotationPortalPath("/search")).toBe(true);
    expect(isAnnotationPortalPath("/annotate/42")).toBe(true);
    expect(isAnnotationPortalPath("/training")).toBe(false);
    expect(isAnnotationPortalPath("/inference")).toBe(false);
    expect(isAnnotationPortalPath("/annotation-queue")).toBe(false);
    expect(isAnnotationPortalPath("/")).toBe(false);
  });

  it("todas las páginas pasan por el mismo shell (un solo menú)", () => {
    const layout = readFileSync(resolve(APP_DIR, "layout.tsx"), "utf8");
    expect(layout).toContain("<PortalShell>");
    expect(layout).not.toContain('className="nav"');
  });

  it("la entrada del portal es el Tablero", () => {
    const home = readFileSync(resolve(APP_DIR, "page.tsx"), "utf8");
    expect(home).toContain('redirect("/dashboard")');
  });

  it("el portal reenvía /api/p2/* al backend de anotación", async () => {
    const rewrites = await nextConfig.rewrites?.();
    expect(rewrites).toEqual([
      { source: "/api/p2/:path*", destination: "http://127.0.0.1:3100/:path*" },
    ]);
  });
});
