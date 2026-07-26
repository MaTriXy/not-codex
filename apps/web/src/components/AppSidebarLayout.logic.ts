export function isSettingsRoutePathname(pathname: string): boolean {
  return /^\/settings(?:\/|$)/.test(pathname);
}
