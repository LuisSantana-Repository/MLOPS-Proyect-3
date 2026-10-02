import { fetchSplits } from "../../api/quality";
import { useQualityResource } from "./useQualityResource";

export function useQualitySplits() {
  return useQualityResource(fetchSplits, "quality-splits");
}
