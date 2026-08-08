import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const productDir = NodePath.join(root, "public", "product");

const budgets = new Map([
  ["workspace.webp", 220_000],
  ["repository-workflow.webp", 180_000],
  ["automations.webp", 180_000],
  ["loopy-authoring.webp", 180_000],
  ["loopy-run.webp", 180_000],
  ["loopany.webp", 180_000],
  ["mobile-run.webp", 120_000],
]);

const requiredSourceText = [
  "Codex",
  "Claude Code",
  "Cursor",
  "OpenCode",
  "Automations",
  "Monkey D. Loopy",
  "LoopAny is disabled by default",
  "has not claimed a live production round trip",
  "Signed packages and a hosted app are not available yet",
  "support@notcodex.bpro.dev",
  "privacy@notcodex.bpro.dev",
  "security@notcodex.bpro.dev",
  "not affiliated with, sponsored by, or endorsed by",
];

const forbiddenSourceText = [
  "Illustration of the Not Codex workspace",
  "03 SESSIONS",
  "production-ready",
  "fully compatible with LoopAny",
];

const failures = [];

async function assertBudget(file, limit) {
  const filePath = NodePath.join(productDir, file);
  const size = (await NodeFSP.stat(filePath)).size;
  if (size > limit) failures.push(`${file} is ${size} bytes; budget is ${limit} bytes.`);
}

const [
  indexSource,
  layoutSource,
  downloadSource,
  siteSource,
  siteScript,
  builtIndex,
  productFiles,
] = await Promise.all([
  NodeFSP.readFile(NodePath.join(root, "src", "pages", "index.astro"), "utf8"),
  NodeFSP.readFile(NodePath.join(root, "src", "layouts", "Layout.astro"), "utf8"),
  NodeFSP.readFile(NodePath.join(root, "src", "pages", "download.astro"), "utf8"),
  NodeFSP.readFile(NodePath.join(root, "src", "lib", "site.ts"), "utf8"),
  NodeFSP.readFile(NodePath.join(root, "public", "site.js")),
  NodeFSP.readFile(NodePath.join(root, "dist", "index.html"), "utf8"),
  NodeFSP.readdir(productDir),
]);

const combinedSource = `${indexSource}\n${layoutSource}\n${siteSource}`;

for (const text of requiredSourceText) {
  if (!combinedSource.includes(text))
    failures.push(`Required marketing disclosure is missing: ${text}`);
}

for (const text of forbiddenSourceText) {
  if (combinedSource.includes(text))
    failures.push(`Forbidden placeholder or overclaim remains: ${text}`);
}

for (const [file, limit] of budgets) {
  if (!productFiles.includes(file)) failures.push(`Required product capture is missing: ${file}`);
  else await assertBudget(file, limit);

  if (!indexSource.includes(`/product/${file}`)) {
    failures.push(`Product capture is not referenced by the homepage: ${file}`);
  }
}

const duplicatePngs = productFiles.filter((file) => file.endsWith(".png"));
if (duplicatePngs.length > 0) {
  failures.push(`Unoptimized duplicate product captures remain: ${duplicatePngs.join(", ")}`);
}

if (siteScript.byteLength > 8_192) {
  failures.push(`site.js is ${siteScript.byteLength} bytes; budget is 8192 bytes.`);
}

if (
  !layoutSource.includes("--ink-on-dark:") ||
  !downloadSource.includes("color: var(--ink-on-dark)")
) {
  failures.push(
    "The download command block must use the dedicated light-on-dark foreground token.",
  );
}

for (const route of ["/#workflow", "/#automations", "/#loopy", "/#trust", "/legal"]) {
  if (!builtIndex.includes(route))
    failures.push(`Built homepage is missing required route: ${route}`);
}

if (!builtIndex.includes("/product/workspace.webp")) {
  failures.push("Built homepage does not contain the primary product capture.");
}

if (failures.length > 0) {
  console.error("Marketing verification failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Marketing verification passed (${budgets.size} product captures, ${siteScript.byteLength} B JavaScript).`,
  );
}
