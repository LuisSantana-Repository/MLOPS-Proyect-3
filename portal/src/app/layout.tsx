import type { ReactNode } from "react";

export const metadata = {
  title: "Portal MLOps — Proyecto 3",
  description: "Portal de entrenamiento e inferencia del clasificador de recortes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
