"use client";

import dynamic from "next/dynamic";

// Las pantallas del portal de anotación son de cliente (canvas, gráficas, subida de
// archivos): se cargan solo en el navegador.
const App = dynamic(() => import("@p2/App").then((module) => module.App), { ssr: false });

/** Pantallas de los Proyectos 1 y 2 dentro del portal unificado. */
export function AnnotationPortal() {
  return <App />;
}
