import { describe, expect, it } from "@effect/vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { IntegrationRunControls } from "./IntegrationRunReceipt";

describe("IntegrationRunControls", () => {
  it("renders only supplied server-authorized controls with accessible labels", () => {
    const markup = renderToStaticMarkup(
      <IntegrationRunControls
        controls={[
          { operation: "cancel", disabled: false, disabledReason: null },
          { operation: "resume", disabled: false, disabledReason: null },
        ]}
        confirmingState={false}
        pendingOperation={null}
        operationStatus={null}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain("Cancel run");
    expect(markup).toContain("Resume run");
    expect(markup).not.toContain("Retry run");
    expect(markup).toContain('aria-labelledby="run-controls-heading"');
  });

  it("renders stale and submitting controls disabled without false success", () => {
    const markup = renderToStaticMarkup(
      <IntegrationRunControls
        controls={[
          {
            operation: "resume",
            disabled: true,
            disabledReason: "Waiting for the latest durable run state.",
          },
        ]}
        confirmingState
        pendingOperation="resume"
        operationStatus={{ kind: "error", message: "The run changed on the server." }}
        onSelect={() => undefined}
      />,
    );

    expect(markup).toContain("disabled");
    expect(markup).toContain("Waiting for the latest durable run state.");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("The run changed on the server.");
  });
});
