import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../lib/api/client";

/**
 * Estado uniforme de un recurso del API de calidad:
 *  - loading: se está consultando
 *  - empty:   el artefacto no existe (404) — "sin datos", no es un error
 *  - error:    falló la red o el contrato
 *  - success: hay datos validados
 *
 * Centralizar esto evita que cada pantalla invente su propio manejo de
 * estados y garantiza que las seis vistas se comporten igual.
 */
export type QualityResourceState<T> =
  | { status: "loading" }
  | { status: "empty"; message: string }
  | { status: "error"; message: string }
  | { status: "success"; data: T };

export interface QualityResource<T> {
  status: QualityResourceState<T>["status"];
  data?: T;
  message?: string;
  reload: () => void;
}

/**
 * `loader` se re-ejecuta cuando cambia `key` o cuando se llama a `reload()`.
 * El loader debe depender únicamente de `key`; se recibe como función para
 * que el llamador no tenga que memoizarlo.
 */
export function useQualityResource<T>(loader: () => Promise<T>, key: string): QualityResource<T> {
  const [state, setState] = useState<QualityResourceState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: el loader depende unicamente de `key`; incluirlo dispararia un bucle.
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    loader()
      .then((data) => {
        if (!cancelled) setState({ status: "success", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          setState({ status: "empty", message: error.message });
        } else {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Error desconocido al cargar.",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  return {
    ...state,
    reload: useCallback(() => setAttempt((n) => n + 1), []),
  };
}
