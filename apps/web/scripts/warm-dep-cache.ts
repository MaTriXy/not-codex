// @effect-diagnostics nodeBuiltinImport:off - setup bootstrap runs before an Effect runtime exists.
/**
 * Pre-warm Vite's dependency optimizer for this checkout. Vite includes the
 * absolute project root in its cache key, so each worktree needs its own cache.
 */
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { optimizeDeps, resolveConfig } from "vite";

const webRoot = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const config = await resolveConfig({ root: webRoot, logLevel: "error" }, "serve");

await optimizeDeps(config);
console.log("[warm-dep-cache] Not Codex web dependency cache is warm");
