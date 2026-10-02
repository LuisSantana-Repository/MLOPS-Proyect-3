"use client";

import { AppLayout } from "@p2/components/layout/AppLayout";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense } from "react";
import { NextRouterBridge } from "./NextRouterBridge";
import { isAnnotationPortalPath } from "./routes";

function ShellBody({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  // Las pantallas del portal de anotación ya incluyen el menú (y /annotate va a
  // pantalla completa a propósito). A las páginas del modelo se les pone el mismo menú.
  if (isAnnotationPortalPath(pathname)) return <>{children}</>;
  return (
    <AppLayout>
      <div className="p3">{children}</div>
    </AppLayout>
  );
}

/** Shell único del portal: un solo menú para los Proyectos 1, 2 y 3. */
export function PortalShell({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <NextRouterBridge>
        <ShellBody>{children}</ShellBody>
      </NextRouterBridge>
    </Suspense>
  );
}
