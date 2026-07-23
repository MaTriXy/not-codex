// @effect-diagnostics nodeBuiltinImport:off -- This repository-integrity CLI runs before an Effect runtime exists.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", ".repos", ".vite-plus", "dist", "node_modules"]);

function markdownFiles(directory: string): string[] {
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name)
        ? []
        : markdownFiles(NodePath.resolve(directory, entry.name));
    }
    return entry.isFile() && NodePath.extname(entry.name).toLowerCase() === ".md"
      ? [NodePath.resolve(directory, entry.name)]
      : [];
  });
}

function localTarget(raw: string): string | null {
  const value =
    raw
      .trim()
      .replace(/^<|>$/g, "")
      .split(/\s+["']/u, 1)[0] ?? "";
  if (value === "" || value.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(value)) {
    return null;
  }
  return decodeURIComponent(value.split(/[?#]/u, 1)[0] ?? "");
}

const failures: string[] = [];
for (const file of markdownFiles(root)) {
  const contents = NodeFS.readFileSync(file, "utf8");
  const targets = [
    ...contents.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu),
    ...contents.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gmu),
  ];
  for (const match of targets) {
    const target = localTarget(match[1] ?? "");
    if (target === null) continue;
    const candidate = target.startsWith("/")
      ? NodePath.resolve(root, `.${target}`)
      : NodePath.resolve(NodePath.dirname(file), target);
    if (!NodeFS.existsSync(candidate)) {
      const line = contents.slice(0, match.index).split("\n").length;
      failures.push(`${file.slice(root.length + 1)}:${line} -> ${target}`);
      continue;
    }
    if (target.endsWith("/") && !NodeFS.statSync(candidate).isDirectory()) {
      failures.push(`${file.slice(root.length + 1)} -> ${target} (expected directory)`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `Broken local Markdown links (${failures.length}):\n${failures.join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("All local Markdown links resolve.\n");
}
