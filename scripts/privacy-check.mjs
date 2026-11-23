// Reject personal, machine-specific, conversational, and secret material from the
// public repository.
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SKIP_DIRS = new Set([
  ".git",
  ".agents",
  ".aws",
  ".codex",
  "node_modules",
  "dist"
]);
const TEXT_EXTENSIONS = new Set([
  "",
  ".css",
  ".html",
  ".json",
  ".md",
  ".mjs",
  ".svg",
  ".toml",
  ".txt",
  ".yaml",
  ".yml"
]);
const FORBIDDEN = [
  { name: "absolute home path", pattern: /\/(?:home|Users)\/[^/\s]+/i },
  { name: "Windows home path", pattern: /[A-Z]:\\Users\\[^\\\s]+/i },
  { name: "private app identifier", pattern: /\b01[0-9a-f]{8}-[0-9a-f-]{27,}\b/i },
  { name: "email address", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "API key assignment", pattern: /\b(?:api[_-]?key|secret|password)\s*[:=]\s*["'][^"']{8,}/i },
  { name: "common token prefix", pattern: /\b(?:ghp|github_pat|sk-)[A-Za-z0-9_-]{16,}\b/ }
];

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    if (entry.isDirectory() && entry.name.startsWith(".release-check-")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await filesBelow(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

const problems = [];
for (const path of await filesBelow(ROOT)) {
  const relativePath = relative(ROOT, path).replaceAll("\\", "/");
  if (relativePath === "scripts/privacy-check.mjs") continue;
  if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) continue;
  if (/(^|\/)(?:HANDOFF[^/]*|live\.json|memory\.json)$/i.test(relativePath)) {
    problems.push(`${relativePath}: local task or handoff file`);
    continue;
  }
  const text = await readFile(path, "utf8");
  for (const rule of FORBIDDEN) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    const line = text.slice(0, match.index).split("\n").length;
    problems.push(`${relativePath}:${line}: ${rule.name}`);
  }
}

const report = {
  passed: problems.length === 0,
  scanned_root: ".",
  problems
};
console.log(JSON.stringify(report, null, 2));
if (problems.length) process.exitCode = 1;
