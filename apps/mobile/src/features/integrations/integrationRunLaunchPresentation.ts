import type { EnvironmentId, ModelSelection, ProjectId } from "@notcodex/contracts";

export function selectIntegrationLaunchEnvironment<
  T extends { readonly environmentId: EnvironmentId },
>(environments: ReadonlyArray<T>, preferred: EnvironmentId | null): T | null {
  return (
    environments.find((environment) => environment.environmentId === preferred) ??
    environments[0] ??
    null
  );
}

export function selectIntegrationLaunchProject<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly defaultModelSelection: ModelSelection | null;
  },
>(
  projects: ReadonlyArray<T>,
  environmentId: EnvironmentId | null,
  preferredId: ProjectId | null,
): T | null {
  if (environmentId === null) return null;
  const scoped = projects.filter((project) => project.environmentId === environmentId);
  return (
    scoped.find((project) => project.id === preferredId) ??
    scoped.find((project) => project.defaultModelSelection !== null) ??
    scoped[0] ??
    null
  );
}

export function selectIntegrationLaunchModel<
  T extends { readonly key: string; readonly selection: ModelSelection },
>(
  models: ReadonlyArray<T>,
  preferredKey: string | null,
  projectDefault: ModelSelection | null,
): T | null {
  const defaultKey = projectDefault ? `${projectDefault.instanceId}:${projectDefault.model}` : null;
  return (
    models.find((model) => model.key === preferredKey) ??
    models.find((model) => model.key === defaultKey) ??
    models[0] ??
    null
  );
}

export function integrationLaunchCanSubmit(input: {
  readonly connected: boolean;
  readonly executionReady: boolean;
  readonly hasProject: boolean;
  readonly hasModel: boolean;
  readonly hasRequestId: boolean;
  readonly busy: boolean;
}): boolean {
  return (
    input.connected &&
    input.executionReady &&
    input.hasProject &&
    input.hasModel &&
    input.hasRequestId &&
    !input.busy
  );
}

export function renewAttemptedIntegrationLaunchRequestId(input: {
  readonly currentRequestId: string | null;
  readonly attemptedRequestId: string | null;
  readonly createRequestId: () => string;
}): string | null {
  if (input.currentRequestId === null || input.currentRequestId !== input.attemptedRequestId) {
    return input.currentRequestId;
  }
  return input.createRequestId();
}
