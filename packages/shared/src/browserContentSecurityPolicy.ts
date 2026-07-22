export function makeBrowserAppContentSecurityPolicy(clerkOrigin?: string): string {
  const scriptSources = [
    "'self'",
    ...(clerkOrigin ? [clerkOrigin] : []),
    "https://challenges.cloudflare.com",
  ];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' http: https: ws: wss:",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'self' https://challenges.cloudflare.com",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; ");
}
