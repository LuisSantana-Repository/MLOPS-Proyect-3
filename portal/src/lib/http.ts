import { NextResponse } from "next/server";
import { z } from "zod";
import type { ApiErrorBody } from "@/contracts";

/**
 * Error de dominio con status HTTP y código estable. Los route handlers lo
 * atrapan y lo convierten en la forma `ApiErrorBody` del contrato.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string[]>;

  constructor(status: number, code: string, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message: string) => new ApiError(404, "not_found", message);
export const badRequest = (message: string, details?: Record<string, string[]>) =>
  new ApiError(400, "bad_request", message, details);
export const upstreamError = (message: string) => new ApiError(502, "upstream_error", message);

export function jsonError(error: ApiError): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code: error.code, message: error.message, details: error.details } },
    { status: error.status },
  );
}

/**
 * Convierte cualquier excepción en una respuesta JSON de error del contrato.
 * - ApiError → tal cual.
 * - ZodError → 400 con detalles por campo.
 * - Otros → 500 con mensaje genérico (el detalle va al log del servidor).
 */
export function handleRouteError(err: unknown): NextResponse<ApiErrorBody> {
  if (err instanceof ApiError) return jsonError(err);
  if (err instanceof z.ZodError) {
    return jsonError(
      badRequest(
        "Cuerpo o parámetros inválidos",
        z.flattenError(err).fieldErrors as Record<string, string[]>,
      ),
    );
  }
  console.error("[api] error no controlado:", err);
  const message = err instanceof Error ? err.message : "Error interno";
  return jsonError(new ApiError(500, "internal_error", message));
}

/** Valida datos con un schema Zod lanzando `ApiError` 400 con detalles claros. */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = z.flattenError(result.error).fieldErrors as Record<string, string[]>;
    // Un campo que el schema no conoce se reporta por su nombre, no como error genérico.
    for (const issue of result.error.issues) {
      if (issue.code !== "unrecognized_keys") continue;
      for (const key of issue.keys) details[key] = ["Campo no soportado"];
    }
    throw badRequest(`${what} inválido`, details);
  }
  return result.data;
}
