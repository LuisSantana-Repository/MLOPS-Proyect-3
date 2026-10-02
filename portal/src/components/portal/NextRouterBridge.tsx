"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { createPath, type Navigator, Router, type To } from "react-router-dom";

const STATE_PREFIX = "portal-nav-state:";

function toHref(to: To): string {
  return typeof to === "string" ? to : createPath(to);
}

function saveState(href: string, state: unknown): void {
  if (state === undefined || state === null) return;
  try {
    window.sessionStorage.setItem(STATE_PREFIX + href, JSON.stringify(state));
  } catch {
    // Sin sessionStorage (modo privado): la pantalla destino funciona sin el estado.
  }
}

function readState(href: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STATE_PREFIX + href);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Las pantallas del portal de anotación usan react-router (Link, useNavigate,
 * useParams...). Aquí se conecta react-router al router de Next.js: Next es la única
 * fuente de verdad de la URL, así que el menú y las pantallas de los Proyectos 1, 2 y 3
 * navegan dentro de la misma aplicación, sin recargar la página.
 */
export function NextRouterBridge({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const query = useSearchParams()?.toString() ?? "";
  const search = query ? `?${query}` : "";

  const navigator = useMemo<Navigator>(
    () => ({
      createHref: toHref,
      go: (delta) => window.history.go(delta),
      push: (to, state) => {
        const href = toHref(to);
        saveState(href, state);
        router.push(href);
      },
      replace: (to, state) => {
        const href = toHref(to);
        saveState(href, state);
        router.replace(href);
      },
    }),
    [router],
  );

  const location = useMemo(
    () => ({
      pathname,
      search,
      hash: "",
      state: readState(pathname + search),
      key: pathname + search,
    }),
    [pathname, search],
  );

  return (
    <Router location={location} navigator={navigator}>
      {children}
    </Router>
  );
}
