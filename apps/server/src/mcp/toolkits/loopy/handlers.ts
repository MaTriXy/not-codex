import { IntegrationService } from "../../../integrations/Services/IntegrationService.ts";
import { LoopyToolkit } from "./tools.ts";

export const LoopyToolkitHandlersLive = LoopyToolkit.toLayer({
  loopy_validate: (input) =>
    IntegrationService.use((integrations) => integrations.validateMonkeyLoopy(input)),
});
