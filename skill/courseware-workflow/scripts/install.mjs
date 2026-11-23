// 将打包内的 Workflow 运行时与不同 Agent 平台配置安装到目标项目。
import process from "node:process";
import { existsSync } from "node:fs";
import { cp, copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeDir = join(skillDir, "assets/workflow-runtime");
const profilesDir = join(skillDir, "profiles");

function usage() {
  console.error(`Usage:
  node scripts/install.mjs --target <project>
       [--profile codex|dsh|harness|generic|claude|all] [--force]

Install runtime:
  <project>/Workflow

Native Skill:
  <project>/.agents/skills/courseware-workflow

Agent profiles:
  codex   → Native Skill + <project>/.codex/agents + AGENTS.courseware.md
  dsh     → Native Skill + DSH-compatible AGENTS instructions
  harness → Native Skill + Harness-compatible AGENTS instructions
  generic → <project>/.courseware-workflow/generic
  claude  → <project>/CLAUDE.courseware.md`);
}

function parseArgs(argv) {
  const args = { profile: "codex", force: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--force") args.force = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (["--target", "--profile"].includes(arg)) {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      args[arg.slice(2)] = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function copyTree(source, target, force, label) {
  if (existsSync(target) && !force) {
    throw new Error(`${label} already exists. Use --force: ${target}`);
  }
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

async function copyTextIfAbsent(source, target) {
  const destination = existsSync(target)
    ? target.replace(/\.md$/i, ".courseware.md")
    : target;
  await copyFile(source, destination);
  return destination;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.target) {
    usage();
    if (!args.help) process.exitCode = 1;
    return;
  }
  if (!["codex", "dsh", "harness", "generic", "claude", "all"].includes(args.profile)) {
    throw new Error("--profile must be codex, dsh, harness, generic, claude or all.");
  }
  if (!existsSync(runtimeDir)) {
    throw new Error(`Bundled runtime is missing: ${runtimeDir}`);
  }

  const target = resolve(args.target);
  await mkdir(target, { recursive: true });
  const installed = {};

  // 安装核心工作流运行时；默认拒绝覆盖已有目录。
  await copyTree(runtimeDir, join(target, "Workflow"), args.force, "Workflow runtime");
  installed.runtime = join(target, "Workflow");

  // DSH、Harness 与 Codex 共用 `.agents/skills` 一级发现路径。
  if (["codex", "dsh", "harness", "all"].includes(args.profile)) {
    const targetSkill = join(target, ".agents/skills/courseware-workflow");
    if (resolve(targetSkill) === resolve(skillDir)) {
      installed.skill = targetSkill;
    } else {
      await copyTree(skillDir, targetSkill, args.force, "Native courseware Skill");
      installed.skill = targetSkill;
    }
  }

  // Codex 使用项目级自定义 Agent 和 AGENTS.md。
  if (["codex", "all"].includes(args.profile)) {
    await copyTree(
      join(profilesDir, "codex/agents"),
      join(target, ".codex/agents"),
      args.force,
      "Codex agents"
    );
    installed.codexInstruction = await copyTextIfAbsent(
      join(profilesDir, "codex/AGENTS.md"),
      join(target, "AGENTS.md")
    );
  }

  // DSH 与 Harness 都读取项目 AGENTS.md；已有文件时使用 .courseware.md 后缀。
  if (["dsh", "harness"].includes(args.profile)) {
    installed.nativeInstruction = await copyTextIfAbsent(
      join(profilesDir, args.profile, "AGENTS.md"),
      join(target, "AGENTS.md")
    );
  }

  // 不支持自定义 Agent 的平台使用三个独立角色 Markdown。
  if (["generic", "all"].includes(args.profile)) {
    await copyTree(
      join(profilesDir, "generic"),
      join(target, ".courseware-workflow/generic"),
      args.force,
      "Generic profiles"
    );
    installed.generic = join(target, ".courseware-workflow/generic");
  }

  // Claude 风格项目使用 CLAUDE.courseware.md，避免覆盖已有 CLAUDE.md。
  if (["claude", "all"].includes(args.profile)) {
    installed.claudeInstruction = await copyTextIfAbsent(
      join(profilesDir, "claude/CLAUDE.md"),
      join(target, "CLAUDE.md")
    );
  }

  const manifest = JSON.parse(await readFile(join(skillDir, "manifest.json"), "utf8"));
  console.log(JSON.stringify({
    passed: true,
    skill: manifest.name,
    version: manifest.version,
    target,
    profile: args.profile,
    installed
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
