// 校验可移植 Skill 包的文件完整性和必需入口。
import process from "node:process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(skillDir, "manifest.json");

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function main() {
  if (!existsSync(manifestPath)) {
    throw new Error("manifest.json is missing.");
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const errors = [];
  // 逐个检查 manifest 中声明的文件与 SHA-256。
  for (const file of manifest.files || []) {
    const path = join(skillDir, file.path);
    if (!existsSync(path)) {
      errors.push(`missing file: ${file.path}`);
      continue;
    }
    const actual = await sha256(path);
    if (actual !== file.sha256) errors.push(`checksum mismatch: ${file.path}`);
  }
  // 这些入口缺失时，即使摘要通过也不能部署。
  const required = [
    "SKILL.md",
    "assets/workflow-runtime/scripts/run-task.mjs",
    "profiles/codex/AGENTS.md",
    "profiles/generic/MAIN_AGENT.md",
    "profiles/claude/CLAUDE.md"
  ];
  for (const path of required) {
    if (!existsSync(join(skillDir, path))) errors.push(`required file missing: ${path}`);
  }
  console.log(JSON.stringify({
    passed: errors.length === 0,
    name: manifest.name,
    version: manifest.version,
    files: manifest.files?.length || 0,
    errors
  }, null, 2));
  if (errors.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
