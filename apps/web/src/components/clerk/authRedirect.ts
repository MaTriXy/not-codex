export interface ClerkSignInProps {
  forceRedirectUrl?: string;
  signUpForceRedirectUrl?: string;
}

export function resolveClerkSignInProps(href: string, isElectron: boolean): ClerkSignInProps {
  if (isElectron) {
    // Electron routes through the hash. Remove any Clerk virtual pathname and
    // callback parameters without losing the Not Codex page behind the modal.
    const redirectUrl = new URL(href);
    redirectUrl.pathname = "/";
    redirectUrl.search = "";
    const normalizedRedirectUrl = redirectUrl.toString();

    return {
      forceRedirectUrl: normalizedRedirectUrl,
      signUpForceRedirectUrl: normalizedRedirectUrl,
    };
  }
  return { forceRedirectUrl: href };
}
