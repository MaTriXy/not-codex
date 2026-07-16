import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  installCommand: "npm install -g vite-plus && vp install --filter '@notcodex/marketing'",
  buildCommand: "vp run --filter @notcodex/marketing build",
  outputDirectory: "dist",
};
