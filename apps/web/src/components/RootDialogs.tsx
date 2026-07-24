import { ConnectOnboardingDialog } from "./cloud/ConnectOnboardingDialog";
import { RelayClientInstallDialog } from "./cloud/RelayClientInstallDialog";

export function RootDialogs(props: {
  readonly requestedConnectOnboardingAccount: string | null;
  readonly onRequestedConnectOnboardingAccountChange: (account: string | null) => void;
}) {
  return (
    <>
      <RelayClientInstallDialog />
      <ConnectOnboardingDialog
        requestedAccount={props.requestedConnectOnboardingAccount}
        onRequestedAccountChange={props.onRequestedConnectOnboardingAccountChange}
      />
    </>
  );
}
