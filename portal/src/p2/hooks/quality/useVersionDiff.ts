import { fetchVersionDiff } from "../../api/quality";
import { useQualityResource } from "./useQualityResource";

/**
 * Diff entre dos versiones. Solo se monta cuando `from` y `to` están
 * definidos (ver VersionsPage), para no disparar un 400 por parámetros
 * vacíos.
 */
export function useVersionDiff(from: string, to: string) {
  return useQualityResource(() => fetchVersionDiff(from, to), `quality-diff:${from}:${to}`);
}
