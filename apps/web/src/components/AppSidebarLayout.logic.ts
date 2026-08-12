export const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;

export function isSettingsRoutePathname(pathname: string): boolean {
  return /^\/settings(?:\/|$)/.test(pathname);
}
