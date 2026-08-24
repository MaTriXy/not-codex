import { assert, it } from "@effect/vitest";

import { formatServiceStatus } from "./service.ts";

const status = {
  supported: true,
  installed: true,
  current: true,
  unitPath: "/home/me/.config/systemd/user/notcodex.service",
  logPath: "/home/me/.notcodex/userdata/logs/boot-service.log",
} as const;

it("reports the installed service version and host paths", () => {
  assert.equal(
    formatServiceStatus(status, "0.8.0"),
    [
      "Not Codex service",
      "  Status: installed · notcodex@0.8.0",
      "  Unit: /home/me/.config/systemd/user/notcodex.service",
      "  Logs: /home/me/.notcodex/userdata/logs/boot-service.log",
    ].join("\n"),
  );
});

it("gives a direct repair command for a stale service", () => {
  assert.include(
    formatServiceStatus({ ...status, current: false }, "0.8.0"),
    "Next: Run `npx notcodex@latest service update`.",
  );
});

it("explains where the service is supported", () => {
  assert.include(
    formatServiceStatus({ ...status, supported: false, installed: false }, "0.8.0"),
    "Supported on: Linux with systemd, macOS with launchd",
  );
});
