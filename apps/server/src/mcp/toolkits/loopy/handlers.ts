import { IntegrationService } from "../../../integrations/Services/IntegrationService.ts";
import { LoopyToolkit } from "./tools.ts";

export const LoopyToolkitHandlersLive = LoopyToolkit.toLayer({
  get_loop_schema: () =>
    IntegrationService.use((integrations) => integrations.getMonkeyLoopyAuthoringContext),
  list_blueprints: () =>
    IntegrationService.use((integrations) => integrations.getMonkeyLoopyAuthoringContext),
  list_recipes: () =>
    IntegrationService.use((integrations) => integrations.getMonkeyLoopyAuthoringContext),
  new_loop: (input) =>
    IntegrationService.use((integrations) => integrations.scaffoldMonkeyLoopy(input)),
  infer_loop_scaffold: (input) =>
    IntegrationService.use((integrations) => integrations.inferMonkeyLoopy(input)),
  validate_loop: (input) =>
    IntegrationService.use((integrations) => integrations.validateMonkeyLoopy(input)),
  verify_loop: (input) =>
    IntegrationService.use((integrations) => integrations.validateMonkeyLoopy(input)),
});
