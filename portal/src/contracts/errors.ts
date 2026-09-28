/**
 * Forma estándar de error de la API (contrato para el frontend).
 * Todo endpoint que falla responde con este JSON y un status HTTP acorde.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Detalles de validación campo→mensajes (cuando aplica). */
    details?: Record<string, string[]>;
  };
}
