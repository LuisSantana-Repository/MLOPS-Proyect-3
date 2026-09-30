import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Portal MLOps — Proyecto 3",
  description: "Portal de entrenamiento e inferencia del clasificador de recortes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <nav className="nav">
          <Link href="/" className="brand">
            Portal MLOps
          </Link>
          <Link href="/training">Training</Link>
          <Link href="/experiments">Experiments</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
