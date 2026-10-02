import { fetchVersions } from "../../api/quality";
import { useQualityResource } from "./useQualityResource";

export function useQualityVersions() {
  return useQualityResource(fetchVersions, "quality-versions");
}
