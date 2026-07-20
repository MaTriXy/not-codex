import { EnvironmentId, ProjectId, ProviderInstanceId } from "@notcodex/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  integrationLaunchCanSubmit,
  selectIntegrationLaunchEnvironment,
  selectIntegrationLaunchModel,
  selectIntegrationLaunchProject,
} from "./integrationRunLaunchPresentation";

const environmentOne = EnvironmentId.make("environment-1");
const environmentTwo = EnvironmentId.make("environment-2");
const model = (key: string) => ({
  key,
  selection: {
    instanceId: ProviderInstanceId.make(key.split(":")[0] ?? "provider"),
    model: key.split(":")[1] ?? "model",
  },
});

describe("mobile integration launch presentation", () => {
  it("keeps environment and project selection scoped", () => {
    expect(
      selectIntegrationLaunchEnvironment(
        [{ environmentId: environmentOne }, { environmentId: environmentTwo }],
        environmentTwo,
      )?.environmentId,
    ).toBe(environmentTwo);

    const selected = selectIntegrationLaunchProject(
      [
        {
          environmentId: environmentOne,
          id: ProjectId.make("same-id"),
          defaultModelSelection: null,
        },
        {
          environmentId: environmentTwo,
          id: ProjectId.make("same-id"),
          defaultModelSelection: model("claude:sonnet").selection,
        },
      ],
      environmentTwo,
      ProjectId.make("same-id"),
    );
    expect(selected?.environmentId).toBe(environmentTwo);
  });

  it("prefers the selected model, then the project default", () => {
    const models = [model("codex:gpt-5"), model("claude:sonnet")];
    expect(selectIntegrationLaunchModel(models, "codex:gpt-5", models[1]!.selection)?.key).toBe(
      "codex:gpt-5",
    );
    expect(selectIntegrationLaunchModel(models, null, models[1]!.selection)?.key).toBe(
      "claude:sonnet",
    );
  });

  it("allows launch only through a connected, validated selection", () => {
    expect(
      integrationLaunchCanSubmit({
        connected: true,
        executionReady: true,
        hasProject: true,
        hasModel: true,
        hasRequestId: true,
        busy: false,
      }),
    ).toBe(true);
    expect(
      integrationLaunchCanSubmit({
        connected: false,
        executionReady: true,
        hasProject: true,
        hasModel: true,
        hasRequestId: true,
        busy: false,
      }),
    ).toBe(false);
    expect(
      integrationLaunchCanSubmit({
        connected: true,
        executionReady: true,
        hasProject: true,
        hasModel: true,
        hasRequestId: false,
        busy: false,
      }),
    ).toBe(false);
  });
});
