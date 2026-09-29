import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // JSX de los tests de componentes (*.test.tsx) sin configurar Babel.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
