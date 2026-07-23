// @effect-diagnostics nodeBuiltinImport:off -- This release-integrity CLI inspects build output before an Effect runtime exists.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const MiB = 1024 * 1024;
const repoRoot = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const webDist = NodePath.join(repoRoot, "apps/web/dist");
const serverDist = NodePath.join(repoRoot, "apps/server/dist");
const marketingDist = NodePath.join(repoRoot, "apps/marketing/dist");
const marketingHeadersSource = NodePath.join(repoRoot, "apps/marketing/public/_headers");

interface PackedFile {
  readonly path: string;
}

interface PackResult {
  readonly size: number;
  readonly unpackedSize: number;
  readonly entryCount: number;
  readonly files: ReadonlyArray<PackedFile>;
}

const failures: string[] = [];

function walkFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of NodeFS.readdirSync(directory, { withFileTypes: true })) {
      const path = NodePath.join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function totalSize(files: ReadonlyArray<string>): number {
  return files.reduce((total, file) => total + NodeFS.statSync(file).size, 0);
}

function assertAtMost(label: string, actual: number, limit: number) {
  if (actual > limit) {
    failures.push(
      `${label} is ${(actual / MiB).toFixed(2)} MiB (limit ${(limit / MiB).toFixed(2)} MiB)`,
    );
  }
}

const webFiles = walkFiles(webDist);
const serverFiles = walkFiles(serverDist);
const marketingFiles = walkFiles(marketingDist);
const productionFiles = [...webFiles, ...serverFiles];

for (const file of productionFiles) {
  if (file.endsWith(".map")) {
    failures.push(`production source map emitted: ${NodePath.relative(repoRoot, file)}`);
  }
}

const marketingHeadersArtifact = NodePath.join(marketingDist, "_headers");
const marketingHeaders = NodeFS.readFileSync(marketingHeadersSource, "utf8");
if (!marketingFiles.includes(marketingHeadersArtifact)) {
  failures.push("marketing distribution is missing the Cloudflare Pages _headers file");
} else if (NodeFS.readFileSync(marketingHeadersArtifact, "utf8") !== marketingHeaders) {
  failures.push("marketing distribution Cloudflare Pages headers differ from the reviewed source");
}

for (const header of [
  "Content-Security-Policy",
  "Cross-Origin-Opener-Policy",
  "Permissions-Policy",
  "Referrer-Policy",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
]) {
  if (!marketingHeaders.includes(`${header}:`)) {
    failures.push(`marketing Cloudflare Pages headers are missing ${header}`);
  }
}

const bundledServiceWorker = NodePath.join(serverDist, "client/mockServiceWorker.js");
if (serverFiles.includes(bundledServiceWorker)) {
  failures.push("development mockServiceWorker.js is present in the server package");
}

const webJavaScript = webFiles.filter((file) => file.endsWith(".js"));
const largestWebChunk = webJavaScript.reduce(
  (largest, file) => (NodeFS.statSync(file).size > NodeFS.statSync(largest).size ? file : largest),
  webJavaScript[0]!,
);

assertAtMost("web distribution", totalSize(webFiles), 20 * MiB);
assertAtMost("server distribution", totalSize(serverFiles), 26 * MiB);
assertAtMost("marketing distribution", totalSize(marketingFiles), 5 * MiB);
assertAtMost(
  `largest web JavaScript chunk (${NodePath.relative(webDist, largestWebChunk)})`,
  NodeFS.statSync(largestWebChunk).size,
  2.5 * MiB,
);
assertAtMost(
  "server CLI bundle",
  NodeFS.statSync(NodePath.join(serverDist, "bin.mjs")).size,
  5 * MiB,
);

const packOutput = NodeChildProcess.execFileSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: NodePath.join(repoRoot, "apps/server"),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const [pack] = JSON.parse(packOutput) as ReadonlyArray<PackResult>;
if (!pack) failures.push("npm pack did not return package metadata");
else {
  assertAtMost("packed npm artifact", pack.size, 6 * MiB);
  assertAtMost("unpacked npm artifact", pack.unpackedSize, 26 * MiB);
  if (pack.entryCount > 500) {
    failures.push(`npm artifact contains ${pack.entryCount} files (limit 500)`);
  }
  for (const file of pack.files) {
    if (file.path.endsWith(".map")) failures.push(`npm artifact contains source map: ${file.path}`);
    if (file.path.endsWith("mockServiceWorker.js")) {
      failures.push(`npm artifact contains development service worker: ${file.path}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Publication artifact checks failed:\n\n${failures.map((failure) => `- ${failure}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Publication artifacts pass: package ${(pack!.size / MiB).toFixed(2)} MiB, unpacked ${(pack!.unpackedSize / MiB).toFixed(2)} MiB, ${pack!.entryCount} files.\n`,
  );
}
