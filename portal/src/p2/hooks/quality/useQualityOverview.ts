import { fetchOverview } from "../../api/quality";
import { useQualityResource } from "./useQualityResource";

export function useQualityOverview() {
  return useQualityResource(fetchOverview, "quality-overview");
}
