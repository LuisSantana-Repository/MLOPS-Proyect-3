import { fetchCopilotTools } from "../../api/copilot";
import { useQualityResource } from "./useQualityResource";

export function useCopilotTools() {
  return useQualityResource(fetchCopilotTools, "copilot-tools");
}
