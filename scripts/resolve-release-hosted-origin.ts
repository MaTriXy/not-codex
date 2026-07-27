#!/usr/bin/env node

export const resolveReleaseHostedOrigin = (value: string) => {
  const candidate = value.trim();

  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error("not an HTTPS origin");
    }
    return url.origin;
  } catch {
    throw new Error(`Invalid release hosted app origin: ${value}`);
  }
};

if (import.meta.main) {
  const [value, ...extra] = process.argv.slice(2);
  try {
    if (value === undefined || extra.length > 0) {
      throw new Error("Usage: resolve-release-hosted-origin <url>");
    }
    process.stdout.write(resolveReleaseHostedOrigin(value));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
