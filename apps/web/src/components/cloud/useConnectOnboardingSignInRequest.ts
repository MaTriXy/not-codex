import { useAuth } from "@clerk/react";
import { useEffect, useRef, useState } from "react";

export function resolveConnectOnboardingSignInRequest(
  previousAccount: string | null | undefined,
  nextAccount: string | null,
  requestedAccount: string | null,
): string | null {
  if (previousAccount === undefined) {
    return requestedAccount;
  }
  if (nextAccount === null) {
    return null;
  }
  return previousAccount === nextAccount ? requestedAccount : nextAccount;
}

/**
 * Observe account transitions outside the lazy onboarding dialog so a sign-in
 * cannot be missed while that dialog's chunk is loading.
 */
export function useConnectOnboardingSignInRequest() {
  const { isLoaded, isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  const [requestedAccount, setRequestedAccount] = useState<string | null>(null);
  const observedAccountRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    // A loaded-but-incomplete snapshot must not be recorded as signed-out.
    if (isSignedIn && !userId) return;

    const previousAccount = observedAccountRef.current;
    const nextAccount = isSignedIn && userId ? userId : null;
    observedAccountRef.current = nextAccount;
    setRequestedAccount((requestedAccount) =>
      resolveConnectOnboardingSignInRequest(previousAccount, nextAccount, requestedAccount),
    );
  }, [isLoaded, isSignedIn, userId]);

  return [requestedAccount, setRequestedAccount] as const;
}
