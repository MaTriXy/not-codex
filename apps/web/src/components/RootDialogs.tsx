import { ConnectOnboardingDialog } from "./cloud/ConnectOnboardingDialog";
import { RelayClientInstallDialog } from "./cloud/RelayClientInstallDialog";
import { SshPasswordPromptDialog } from "./desktop/SshPasswordPromptDialog";

export function RootDialogs() {
  return (
    <>
      <RelayClientInstallDialog />
      <ConnectOnboardingDialog />
      <SshPasswordPromptDialog />
    </>
  );
}
