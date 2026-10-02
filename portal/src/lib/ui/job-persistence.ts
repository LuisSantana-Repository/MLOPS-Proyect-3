/**
 * El job de /training sobrevive a la recarga (Actividad A, 6.1): su id viaja en la URL
 * (`?job=<id>`) y, como respaldo, en localStorage. Al montar la página se recupera y el
 * progreso y los logs se vuelven a leer de `GET /api/training/jobs/[id]`.
 */

export const JOB_PARAM = "job";
export const JOB_STORAGE_KEY = "training:last-job";

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function clean(value: string | null | undefined): string | null {
  const id = value?.trim();
  return id && JOB_ID.test(id) ? id : null;
}

/** "?job=<id>" → id, o null si falta o no tiene forma de id. */
export function jobIdFromSearch(search: string): string | null {
  return clean(new URLSearchParams(search).get(JOB_PARAM));
}

/** URL de la página con `?job=<id>` (o sin él si `jobId` es null), conservando lo demás. */
export function withJobParam(pathname: string, search: string, jobId: string | null): string {
  const params = new URLSearchParams(search);
  if (jobId) params.set(JOB_PARAM, jobId);
  else params.delete(JOB_PARAM);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

/** Job a mostrar al cargar la página: el de la URL manda; si no hay, el último guardado. */
export function recoverJobId(search: string, storage: Storage | null): string | null {
  const fromUrl = jobIdFromSearch(search);
  if (fromUrl) return fromUrl;
  try {
    return clean(storage?.getItem(JOB_STORAGE_KEY));
  } catch {
    return null; // localStorage bloqueado: la URL sigue funcionando
  }
}

/** Guarda (o borra) el job actual para la próxima carga. */
export function rememberJobId(jobId: string | null, storage: Storage | null): void {
  try {
    if (jobId) storage?.setItem(JOB_STORAGE_KEY, jobId);
    else storage?.removeItem(JOB_STORAGE_KEY);
  } catch {
    // Sin localStorage el id queda solo en la URL.
  }
}
