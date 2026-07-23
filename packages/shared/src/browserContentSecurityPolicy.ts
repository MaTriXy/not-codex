export const CLERK_CHALLENGE_ORIGIN = "https://challenges.cloudflare.com";
export const CLERK_IMAGE_ORIGIN = "https://img.clerk.com";
export const CLERK_PROTECTION_ORIGIN = "https://*.protect.clerk.com";

export function makeBrowserAppContentSecurityPolicy(clerkOrigin?: string): string {
  const scriptSources = [
    "'self'",
    ...(clerkOrigin ? [clerkOrigin, CLERK_CHALLENGE_ORIGIN, CLERK_PROTECTION_ORIGIN] : []),
  ];
  const frameSources = [
    "'self'",
    ...(clerkOrigin ? [CLERK_CHALLENGE_ORIGIN, CLERK_PROTECTION_ORIGIN] : []),
  ];
  const imageSources = ["'self'", "data:", "blob:", ...(clerkOrigin ? [CLERK_IMAGE_ORIGIN] : [])];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' http: https: ws: wss:",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `frame-src ${frameSources.join(" ")}`,
    `img-src ${imageSources.join(" ")}`,
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; ");
}
