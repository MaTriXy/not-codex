import { createAutomationEnvironmentAtoms } from "@notcodex/client-runtime/state/automations";

import { connectionAtomRuntime } from "../connection/runtime";

export const automationEnvironment = createAutomationEnvironmentAtoms(connectionAtomRuntime);
