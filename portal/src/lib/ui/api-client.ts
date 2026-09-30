import type { ApiErrorBody } from "@/contracts";

/** Error de la API del portal ya traducido a algo que la UI puede mostrar. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string[]>;

  constructor(status: number, code: string, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as ApiErrorBody).error?.message === "string"
  );
}

/**
 * fetch + JSON con los errores del contrato `ApiErrorBody`.
 * Cualquier fallo (red, HTTP o JSON) termina en `ApiClientError`.
 */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...init,
      headers: { Accept: "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiClientError(0, "network_error", "No se pudo conectar con el portal");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiClientError(res.status, body.error.code, body.error.message, body.error.details);
    }
    throw new ApiClientError(res.status, "http_error", `El servidor respondió ${res.status}`);
  }
  if (body === null)
    throw new ApiClientError(res.status, "invalid_json", "Respuesta sin JSON válido");
  return body as T;
}

/** Mensaje para mostrar al usuario a partir de cualquier error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === "upstream_error")
      return `Servicio no disponible (MLflow o Redis): ${err.message}`;
    return err.message;
  }
  return err instanceof Error ? err.message : "Error inesperado";
}
