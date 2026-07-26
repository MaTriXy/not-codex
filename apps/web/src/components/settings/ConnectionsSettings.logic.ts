import type { DesktopBridge, DesktopWslState } from "@notcodex/contracts";
import type { EnvironmentConnectionPhase } from "@notcodex/client-runtime/connection";

type WslEnableBridge = Pick<DesktopBridge, "setWslBackendEnabled" | "setWslDistro" | "setWslOnly">;

export async function applyWslEnableSelection(input: {
  readonly bridge: WslEnableBridge;
  readonly mode: "both" | "wsl-only";
  readonly nextDistro: string | null;
  readonly persistedDistro: string | null;
}): Promise<DesktopWslState> {
  const { bridge, mode, nextDistro, persistedDistro } = input;

  // Stage every preference before enabling. The desktop only relaunches for
  // mode/distro changes while WSL is active, so the final enable observes the
  // complete selection and is the only call that may relaunch.
  await bridge.setWslOnly(mode === "wsl-only");
  if (persistedDistro !== nextDistro) {
    await bridge.setWslDistro(nextDistro);
  }
  return await bridge.setWslBackendEnabled(true);
}

export interface SavedBackendRowActions {
  readonly showRemove: boolean;
  readonly removeDisabled: boolean;
  readonly removeLabel: "Remove" | "Removing…";
  readonly primaryDisabled: boolean;
  readonly primaryLabel: "Connect" | "Connecting…" | "Disconnect" | "Disconnecting…";
  readonly primaryAction: "connect" | "remove";
}

export function presentSavedBackendRowActions(
  phase: EnvironmentConnectionPhase,
  isRemoving: boolean,
): SavedBackendRowActions {
  const isConnected = phase === "connected";
  const isConnecting = phase === "connecting" || phase === "reconnecting";

  return {
    showRemove: !isConnected,
    removeDisabled: isRemoving,
    removeLabel: isRemoving ? "Removing…" : "Remove",
    primaryDisabled: isConnecting || isRemoving,
    primaryLabel: isConnected
      ? isRemoving
        ? "Disconnecting…"
        : "Disconnect"
      : isConnecting
        ? "Connecting…"
        : "Connect",
    primaryAction: isConnected ? "remove" : "connect",
  };
}
