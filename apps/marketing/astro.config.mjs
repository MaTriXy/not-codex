import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://notcodex.bpro.dev",
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
});
