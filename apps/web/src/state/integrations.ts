import { createIntegrationEnvironmentAtoms } from "@notcodex/client-runtime/state/integrations";

import { connectionAtomRuntime } from "../connection/runtime";

export const integrationEnvironment = createIntegrationEnvironmentAtoms(connectionAtomRuntime);
