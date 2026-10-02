import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal/PortalShell";
import "./portal.css";
import "./globals.css";

export const metadata = {
  title: "Portal de Anotación · MLOps",
  description:
    "Portal único: anotación de imágenes, calidad del dataset y entrenamiento e inferencia del clasificador.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <PortalShell>{children}</PortalShell>
      </body>
    </html>
  );
}
