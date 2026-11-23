// Build and verify the portable Skill and Codex plugin releases.
//
// Default mode is a safe temporary check. Use --publish to write a versioned
// release under dist/. Existing release directories are never overwritten
// unless --replace is supplied explicitly.
import process from "node:process";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_SOURCE = join(PROJECT_ROOT, "skill/courseware-workflow");
const PLUGIN_TEMPLATE = join(PROJECT_ROOT, "packaging/plugin");
const RELEASE_NOTES_TEMPLATE = join(
  PROJECT_ROOT,
  "packaging/RELEASE_NOTES_zh.md"
);
const DIST_ROOT = join(PROJECT_ROOT, "dist");
const RUNTIME_SCRIPTS = new Set([
  "build-content.mjs",
  "check-browser.mjs",
  "check-static.mjs",
  "run-task.mjs"
]);

function usage() {
  console.error(`Usage:
  node scripts/release.mjs [--version <semver>] [--check]
  node scripts/release.mjs --version <semver> --publish [--replace]
  node scripts/release.mjs --version <semver> --output <directory>
  node scripts/release.mjs --sync-manifest

--check is the default and builds only in a temporary directory.
--publish writes dist/v<version>/ and refuses to replace an existing release
unless --replace is also specified. --sync-manifest refreshes the source
manifest in place after intentional source changes.`);
}

function parseArgs(argv) {
  const args = { check: true };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--check") {
      args.check = true;
    } else if (arg === "--publish") {
      args.check = false;
    } else if (arg === "--replace") {
      args.replace = true;
    } else if (arg === "--sync-manifest") {
      args.syncManifest = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (["--version", "--output"].includes(arg)) {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      args[arg.slice(2)] = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function run(command, args, cwd = PROJECT_ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      result.error?.message ||
      result.stderr?.trim() ||
      `${command} exited with status ${result.status}`
    );
  }
  return result;
}

async function filesBelow(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(child));
    else files.push(child);
  }
  return files;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function purposeFor(path) {
  if (path === "SKILL.md") return "Agent Skill 主入口";
  if (path === "README.md") return "安装、兼容性与使用说明";
  if (path === "CHANGELOG.md") return "Skill 版本变更记录";
  if (path === "LICENSE") return "MIT 发布许可";
  if (path === "THIRD_PARTY_NOTICES.md") return "第三方内容许可声明";
  if (path === "PRIVACY.md") return "本地运行与隐私说明";
  if (path === "SECURITY.md") return "安全边界与报告说明";
  if (path === "agents/openai.yaml") return "Skill 平台元数据";
  if (path.startsWith("references/")) return "按需加载的设计参考";
  if (path.startsWith("scripts/")) return "安装或完整性校验脚本";
  if (path.startsWith("profiles/codex/agents/")) return "Codex 自定义 Agent 配置";
  if (path.startsWith("profiles/codex/")) return "Codex 项目级工作流说明";
  if (path.startsWith("profiles/dsh/")) return "DSH 原生 Skill 接入说明";
  if (path.startsWith("profiles/harness/")) return "DeepSeek Harness 接入说明";
  if (path.startsWith("profiles/generic/")) return "通用 Agent 角色说明";
  if (path.startsWith("profiles/claude/")) return "Claude 风格项目说明";
  if (path.includes("/CST/TEMPLATE.html")) return "HTML 课件骨架";
  if (path.includes("/CST/CONTENT.md")) return "内容与交付契约";
  if (path.includes("/CST/SKILL.md")) return "Lab 设计与验收规则";
  if (path.endsWith("workflow.md")) return "轻量工作流契约";
  if (path.endsWith("live.schema.json")) return "live.json 数据结构";
  if (path.endsWith("memory.schema.json")) return "memory.json 数据结构";
  if (path.includes("/overrides/")) return "Lab 主题回归覆盖样式";
  if (path.includes("/examples/")) return "可运行任务示例";
  if (path.includes("/scripts/")) return "Workflow 执行脚本";
  if (path.includes("/assets/")) return "Workflow 运行时资源";
  return "Workflow 运行时资源";
}

async function writeManifest(skillDir, version) {
  const files = (await filesBelow(skillDir))
    .filter(path => basename(path) !== "manifest.json")
    .sort();
  const manifest = {
    schema: "agent-skill-package/v1",
    name: "courseware-workflow",
    version,
    description: "主 Agent 默认完成；单一 live.json；仅按用户要求使用一个子 Agent",
    skill_file: "SKILL.md",
    license: "MIT",
    runtime: "assets/workflow-runtime",
    profiles: ["codex", "dsh", "harness", "generic", "claude"],
    compatibility: {
      agent_skills: true,
      codex: true,
      codex_plugin: true,
      dsh_skill: true,
      deepseek_harness: true,
      claude_style: true,
      generic_markdown_agents: true
    },
    requirements: {
      node: ">=20",
      browser: "Chrome or Chromium for visual validation"
    },
    install: "node scripts/install.mjs --target <project> --profile codex|dsh|harness",
    files: await Promise.all(files.map(async path => {
      const relativePath = relative(skillDir, path).replaceAll("\\", "/");
      return {
        path: relativePath,
        purpose: purposeFor(relativePath),
        sha256: await sha256(path)
      };
    }))
  };
  await writeFile(
    join(skillDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  return manifest;
}

async function updatePluginVersion(pluginDir, version) {
  for (const relativePath of [
    "plugin.json",
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json"
  ]) {
    const path = join(pluginDir, relativePath);
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.version = version;
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
}

async function assertRuntimeBoundary(skillDir) {
  const scriptsDir = join(
    skillDir,
    "assets/workflow-runtime/scripts"
  );
  const actual = (await readdir(scriptsDir, { withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort();
  const unexpected = actual.filter(name => !RUNTIME_SCRIPTS.has(name));
  const missing = [...RUNTIME_SCRIPTS].filter(name => !actual.includes(name));
  if (unexpected.length || missing.length) {
    throw new Error(
      `Runtime script boundary failed; unexpected=[${unexpected.join(", ")}], ` +
      `missing=[${missing.join(", ")}]`
    );
  }
}

async function buildStages(stagingRoot, version) {
  const skillParent = join(stagingRoot, "skill");
  const skillDir = join(skillParent, "courseware-workflow");
  const pluginParent = join(stagingRoot, "plugin");
  const pluginDir = join(pluginParent, "courseware-workflow");

  await mkdir(skillParent, { recursive: true });
  await cp(SKILL_SOURCE, skillDir, { recursive: true });
  await writeManifest(skillDir, version);
  await assertRuntimeBoundary(skillDir);

  await mkdir(pluginParent, { recursive: true });
  await cp(PLUGIN_TEMPLATE, pluginDir, { recursive: true });
  await mkdir(join(pluginDir, "skills"), { recursive: true });
  await cp(skillDir, join(pluginDir, "skills/courseware-workflow"), {
    recursive: true
  });
  await updatePluginVersion(pluginDir, version);

  return { skillParent, skillDir, pluginParent, pluginDir };
}

async function verifyStages(stages) {
  const packageCheck = run(
    process.execPath,
    [join(stages.skillDir, "scripts/verify-package.mjs")]
  );
  const pluginSkillCheck = run(
    process.execPath,
    [join(stages.pluginDir, "skills/courseware-workflow/scripts/verify-package.mjs")]
  );

  for (const relativePath of [
    ".codex-plugin/plugin.json",
    ".claude-plugin/plugin.json",
    "plugin.json",
    "skills/courseware-workflow/SKILL.md",
    "skills/courseware-workflow/assets/workflow-runtime/CST/TEMPLATE.html"
  ]) {
    if (!existsSync(join(stages.pluginDir, relativePath))) {
      throw new Error(`Plugin structure is missing: ${relativePath}`);
    }
  }

  const installRoot = join(dirname(stages.skillParent), "install-smoke");
  await mkdir(installRoot, { recursive: true });
  const smokeTargets = {};
  for (const profile of ["codex", "dsh", "harness"]) {
    const target = join(installRoot, profile);
    run(
      process.execPath,
      [
        join(stages.skillDir, "scripts/install.mjs"),
        "--target", target,
        "--profile", profile
      ]
    );
    for (const relativePath of [
      "Workflow/scripts/run-task.mjs",
      ".agents/skills/courseware-workflow/SKILL.md",
      ".agents/skills/courseware-workflow/assets/workflow-runtime/CST/TEMPLATE.html"
    ]) {
      if (!existsSync(join(target, relativePath))) {
        throw new Error(`${profile} install is missing: ${relativePath}`);
      }
    }
    const installedScripts = join(
      target,
      ".agents/skills/courseware-workflow/assets/workflow-runtime/scripts"
    );
    await assertRuntimeBoundary(
      join(target, ".agents/skills/courseware-workflow")
    );
    for (const forbidden of [
      "package-release.mjs",
      "package-skill.mjs",
      "test-workflow.mjs"
    ]) {
      if (existsSync(join(installedScripts, forbidden))) {
        throw new Error(`${profile} install contains development script: ${forbidden}`);
      }
    }
    smokeTargets[profile] = target;
  }

  const regression = run(
    process.execPath,
    [
      join(PROJECT_ROOT, "scripts/tests/test-workflow.mjs"),
      "--project-root", smokeTargets.codex
    ]
  );
  const regressionReport = JSON.parse(regression.stdout);
  if (!regressionReport.passed) {
    throw new Error("Installed workflow regression tests failed.");
  }

  return {
    package_files: JSON.parse(packageCheck.stdout).files,
    plugin_skill_files: JSON.parse(pluginSkillCheck.stdout).files,
    install_profiles: Object.keys(smokeTargets),
    regression_cases: regressionReport.cases.length
  };
}

async function createArtifacts(stages, outputDir, version) {
  await mkdir(outputDir, { recursive: true });
  const skillArchive = join(
    outputDir,
    `courseware-workflow-skill-${version}.zip`
  );
  const pluginArchive = join(
    outputDir,
    `courseware-workflow-plugin-${version}.zip`
  );
  run("zip", ["-qr", skillArchive, basename(stages.skillDir)], stages.skillParent);
  run("zip", ["-qr", pluginArchive, basename(stages.pluginDir)], stages.pluginParent);
  run("unzip", ["-tq", skillArchive], outputDir);
  run("unzip", ["-tq", pluginArchive], outputDir);

  const digests = {
    [basename(skillArchive)]: await sha256(skillArchive),
    [basename(pluginArchive)]: await sha256(pluginArchive)
  };
  for (const [name, digest] of Object.entries(digests)) {
    await writeFile(
      join(outputDir, `${name}.sha256`),
      `${digest}  ${name}\n`,
      "utf8"
    );
  }

  await writeFile(
    join(outputDir, "current.json"),
    `${JSON.stringify({
      version,
      release: `dist/v${version}`,
      skill_archive: basename(skillArchive),
      plugin_archive: basename(pluginArchive)
    }, null, 2)}\n`,
    "utf8"
  );

  const releaseNotes = (await readFile(RELEASE_NOTES_TEMPLATE, "utf8"))
    .replaceAll("{{VERSION}}", version);
  await writeFile(join(outputDir, "RELEASE_NOTES_zh.md"), releaseNotes, "utf8");

  const checksums = [];
  for (const path of (await filesBelow(outputDir)).sort()) {
    if (basename(path) === "SHA256SUMS.txt") continue;
    checksums.push(
      `${await sha256(path)}  ${relative(outputDir, path).replaceAll("\\", "/")}`
    );
  }
  await writeFile(
    join(outputDir, "SHA256SUMS.txt"),
    `${checksums.join("\n")}\n`,
    "utf8"
  );
  return { skillArchive, pluginArchive, digests };
}

async function replaceDirectory(source, target) {
  const parent = dirname(target);
  const incoming = join(parent, `.incoming-${basename(target)}-${process.pid}`);
  await rm(incoming, { recursive: true, force: true });
  await cp(source, incoming, { recursive: true });
  await rm(target, { recursive: true, force: true });
  await rename(incoming, target);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const sourceManifest = JSON.parse(
    await readFile(join(SKILL_SOURCE, "manifest.json"), "utf8")
  );
  if (args.syncManifest) {
    await writeManifest(SKILL_SOURCE, sourceManifest.version);
    if (args.check && !args.output && !args.publish) {
      console.log(JSON.stringify({
        passed: true,
        mode: "manifest",
        manifest: join(SKILL_SOURCE, "manifest.json")
      }, null, 2));
      return;
    }
  }
  const version = args.version || sourceManifest.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  const temporaryRoot = await mkdtemp(join(PROJECT_ROOT, ".release-check-"));
  try {
    const stagingRoot = join(temporaryRoot, "staging");
    const build = join(temporaryRoot, "build");
    const stages = await buildStages(stagingRoot, version);
    const checks = await verifyStages(stages);
    const artifacts = await createArtifacts(stages, build, version);

    let destination = null;
    if (args.output) {
      destination = resolve(args.output);
      await replaceDirectory(build, destination);
    } else if (!args.check) {
      destination = join(DIST_ROOT, `v${version}`);
      if (existsSync(destination) && !args.replace) {
        throw new Error(
          `Release already exists: ${destination}. Use --replace only when intentional.`
        );
      }
      if (existsSync(destination)) {
        await replaceDirectory(build, destination);
      } else {
        await mkdir(DIST_ROOT, { recursive: true });
        await cp(build, destination, { recursive: true });
      }
    }

    console.log(JSON.stringify({
      passed: true,
      mode: destination ? "written" : "check",
      version,
      destination,
      artifacts,
      checks
    }, null, 2));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
