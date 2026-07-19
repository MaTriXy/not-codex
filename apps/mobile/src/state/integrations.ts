import { createIntegrationEnvironmentAtoms } from "@notcodex/client-runtime/state/integrations";

import { connectionAtomRuntime } from "../connection/runtime";

// Integrations remain environment-owned. This only binds the shared RPC atoms
// to the mobile app's existing remote-environment runtime.
export const integrationEnvironment = createIntegrationEnvironmentAtoms(connectionAtomRuntime);
