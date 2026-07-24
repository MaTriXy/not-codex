import { ConnectOnboardingDialog } from "./cloud/ConnectOnboardingDialog";
import { RelayClientInstallDialog } from "./cloud/RelayClientInstallDialog";

export function RootDialogs() {
  return (
    <>
      <RelayClientInstallDialog />
      <ConnectOnboardingDialog />
    </>
  );
}
