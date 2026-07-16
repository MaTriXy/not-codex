import { useClerk } from "@clerk/react";

export function useNotCodexConnectAuthPrompt() {
  const clerk = useClerk();
  const openAuthPrompt = () => {
    clerk.openWaitlist();
  };
  return { authPrompt: null, openAuthPrompt };
}
