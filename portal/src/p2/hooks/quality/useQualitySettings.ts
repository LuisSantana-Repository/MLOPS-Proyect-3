import { fetchQualitySettings } from "../../api/quality";
import { useQualityResource } from "./useQualityResource";

export function useQualitySettings() {
  return useQualityResource(fetchQualitySettings, "quality-settings");
}
