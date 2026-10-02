import { fetchEmbeddings } from "../../api/quality";
import { useQualityResource } from "./useQualityResource";

export function useQualityEmbeddings() {
  return useQualityResource(fetchEmbeddings, "quality-embeddings");
}
