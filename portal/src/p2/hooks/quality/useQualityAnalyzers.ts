import { fetchAnalyzers } from "../../api/quality";
import { useQualityResource } from "./useQualityResource";

export function useQualityAnalyzers() {
  return useQualityResource(fetchAnalyzers, "quality-analyzers");
}
