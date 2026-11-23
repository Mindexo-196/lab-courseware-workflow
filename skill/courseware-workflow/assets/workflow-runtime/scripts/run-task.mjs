// Workflow V2.0：单一 live.json 驱动构建、审查、人工反馈和交付。
import process from "node:process";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VERSION = "2.0";
const DEFAULT_CONTEXT_WINDOW_TOKENS = 1_048_576;
const CONTEXT_EFFECTIVE_PERCENT = 95;
const BYTES_PER_TOKEN_ESTIMATE = 4;
const CST_ROOT = existsSync(join(ROOT, "CST/TEMPLATE.html"))
  ? join(ROOT, "CST")
  : join(ROOT, "Workflow/CST");
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SCREENS = new Set([
  "screen-cover", "screen-text", "screen-split", "screen-table",
  "screen-figure", "screen-widget", "screen-summary", "screen-quiz"
]);
const METADATA_KEYS = [
  "course", "course_en", "chapter", "chapter_en", "part", "part_en",
  "range", "range_en", "deck_title", "deck_title_en", "deck_sub", "deck_sub_en",
  "date", "members", "members_en", "deck_version"
];

function usage() {
  console.error(`Usage:
  node Workflow/scripts/run-task.mjs init --live <live.json> --content <source.json>
       [--source-html <existing.html>] [--task-id <id>]
  node Workflow/scripts/run-task.mjs build --live <live.json> [--browser auto|skip|<port>]
  node Workflow/scripts/run-task.mjs review --live <live.json> --input <review.json>
  node Workflow/scripts/run-task.mjs feedback --live <live.json>
       --decision approve|revise|abort [--notes <text>]
  node Workflow/scripts/run-task.mjs deliver --live <live.json> [--publish <dir>]
  node Workflow/scripts/run-task.mjs status --live <live.json>
  node Workflow/scripts/run-task.mjs usage --live <live.json>
       --input-tokens <n> [--cached-tokens <n>] [--output-tokens <n>]
       [--cost-cny <amount>]
  node Workflow/scripts/run-task.mjs memory --live <live.json>
       [--output <memory.json>] [--context-tokens <n>]
  node Workflow/scripts/run-task.mjs page --live <live.json> (--page <n>|--slide-id <sN>)
  node Workflow/scripts/run-task.mjs resume --live <live.json>
       [--context-tokens <n>]`);
}

function parseArgs(argv) {
  const args = { action: argv[0], browser: "auto" };
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg.startsWith("--")) {
      const value = argv[++index];
      if (!value) throw new Error(`${arg} requires a value.`);
      args[arg.slice(2)] = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function shownPath(path) {
  return relative(ROOT, path).replaceAll("\\", "/") || ".";
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function safeName(value) {
  return String(value).replace(/[\\/:*?"<>|]/g, "_").trim() || "courseware";
}

function deliverySlug(live) {
  const metadata = live.deck.metadata;
  return safeName(metadata.delivery_slug || metadata.deck_title_en || metadata.deck_title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "courseware";
}

function now() {
  return new Date().toISOString();
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, text, "utf8");
  return text;
}

function contextBudget(contextTokens = DEFAULT_CONTEXT_WINDOW_TOKENS) {
  const tokens = Math.max(1, Number(contextTokens) || DEFAULT_CONTEXT_WINDOW_TOKENS);
  const effectiveTokens = Math.floor(tokens * CONTEXT_EFFECTIVE_PERCENT / 100);
  return {
    context_window_tokens: tokens,
    effective_context_tokens: effectiveTokens,
    recommended_bytes: Math.floor(
      effectiveTokens * 0.5 * BYTES_PER_TOKEN_ESTIMATE
    ),
    hard_limit_bytes: Math.ceil(
      tokens * 1.25 * BYTES_PER_TOKEN_ESTIMATE
    )
  };
}

async function writeMemoryFile(
  livePath,
  live,
  sourceBytes = null,
  contextTokens = DEFAULT_CONTEXT_WINDOW_TOKENS
) {
  const bytes = sourceBytes || await readFile(livePath);
  const memory = compactMemory(live, livePath, bytes);
  const text = `${JSON.stringify(memory, null, 2)}\n`;
  const size = Buffer.byteLength(text);
  const budget = contextBudget(contextTokens);
  if (size > budget.hard_limit_bytes) {
    throw new Error(
      `memory.json exceeds context-derived hard limit ` +
      `(${size}/${budget.hard_limit_bytes} bytes).`
    );
  }
  if (/"(?:body_html|left_html|right_html|visual_html)"\s*:/.test(text)) {
    throw new Error("memory.json must not contain HTML source fields.");
  }
  const output = join(dirname(livePath), "memory.json");
  await writeFile(output, text, "utf8");
  return { output, bytes: size, budget };
}

async function persistLive(livePath, live) {
  const text = await writeJson(livePath, live);
  await writeMemoryFile(livePath, live, Buffer.from(text));
}

function history(live, action, note = "") {
  live.history.push({ at: now(), action, ...(note ? { note } : {}) });
}

function emptyReview() {
  return {
    status: "pending",
    issues: [],
    summary: "",
    artifact_sha256: "",
    reviewed_at: null
  };
}

function emptyPreview() {
  return {
    html_ref: "",
    html_sha256: "",
    artifact_sha256: "",
    checks: { static: { skipped: true }, browser: { skipped: true } },
    checked_at: null
  };
}

async function cstHashes() {
  return {
    content: sha256(await readFile(join(CST_ROOT, "CONTENT.md"))),
    skill: sha256(await readFile(join(CST_ROOT, "SKILL.md"))),
    template: sha256(await readFile(join(CST_ROOT, "TEMPLATE.html")))
  };
}

function cstBlock(hashes = { content: "", skill: "", template: "" }) {
  return {
    content_ref: "CST/CONTENT.md",
    skill_ref: "CST/SKILL.md",
    template_ref: "CST/TEMPLATE.html",
    hashes
  };
}

function tagAttributes(source) {
  const attrs = {};
  for (const match of source.matchAll(
    /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  )) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function embeddedInstances(slide) {
  const result = [];
  for (const [field, html] of Object.entries({
    body_html: slide.body_html,
    left_html: slide.left_html,
    right_html: slide.right_html,
    visual_html: slide.visual_html
  })) {
    for (const match of (html || "").matchAll(/<[^>]+>/g)) {
      const attrs = tagAttributes(match[0]);
      if (attrs["data-iw"]) {
        result.push({
          field,
          key: attrs["data-iw"],
          instance_key: attrs["data-iw-id"] || ""
        });
      }
    }
  }
  return result;
}

function validateLive(live) {
  const errors = [];
  if (live.schema !== "workflow/live/v2") errors.push("schema must be workflow/live/v2");
  if (live.version !== VERSION) errors.push(`version must be ${VERSION}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(live.task_id || "")) {
    errors.push("task_id must use lowercase letters, digits and hyphens");
  }
  for (const field of ["objective", "audience", "scope", "delivery"]) {
    if (!live.brief?.[field]) errors.push(`brief.${field} is required`);
  }
  for (const key of METADATA_KEYS) {
    if (!live.deck?.metadata?.[key]) errors.push(`deck.metadata.${key} is required`);
  }
  for (const field of ["learning_outcomes", "key_messages", "evidence", "sources"]) {
    if (!Array.isArray(live.deck?.content?.[field]) ||
        !live.deck.content[field].length) {
      errors.push(`deck.content.${field} must contain at least one item`);
    }
  }
  if (!Array.isArray(live.deck?.slides) || live.deck.slides.length < 2) {
    errors.push("deck.slides must contain at least two entries");
  }
  const ids = new Set();
  const instances = new Set();
  let covers = 0;
  for (const [index, slide] of (live.deck?.slides || []).entries()) {
    const label = `deck.slides[${index}]`;
    if (!/^s[0-9]+$/.test(slide.id || "")) errors.push(`${label}.id must match s<number>`);
    if (ids.has(slide.id)) errors.push(`${label}.id is duplicated`);
    ids.add(slide.id);
    if (!SCREENS.has(slide.type)) errors.push(`${label}.type is unsupported`);
    if (slide.type === "screen-cover") covers++;
    if (slide.type !== "screen-cover" && (!slide.title || !slide.title_en)) {
      errors.push(`${label} requires bilingual titles`);
    }
    if (["screen-text", "screen-table", "screen-figure", "screen-summary"]
      .includes(slide.type) && !slide.body_html) {
      errors.push(`${label}.body_html is required`);
    }
    if (slide.type === "screen-split" && (!slide.left_html || !slide.right_html)) {
      errors.push(`${label} requires left_html and right_html`);
    }
    if (slide.type === "screen-cover" && !slide.visual_html) {
      errors.push(`${label}.visual_html is required`);
    }
    if (["screen-widget", "screen-quiz"].includes(slide.type) && !slide.widget) {
      errors.push(`${label}.widget is required`);
    }
    const embedded = embeddedInstances(slide);
    const interactive = Boolean(slide.widget) || embedded.length > 0;
    if (interactive) {
      if (!Array.isArray(slide.linked_components) ||
          slide.linked_components.length < 2) {
        errors.push(`${label}.linked_components must contain at least two components`);
      }
      if (!slide.linked_state) {
        errors.push(`${label}.linked_state is required`);
      }
      for (const [componentIndex, component] of
        (slide.linked_components || []).entries()) {
        for (const field of ["name", "type", "role"]) {
          if (!component[field]) {
            errors.push(
              `${label}.linked_components[${componentIndex}].${field} is required`
            );
          }
        }
      }
    }
    if (slide.widget) {
      if (instances.has(slide.widget.instance_key)) {
        errors.push(`${label}.widget.instance_key is duplicated`);
      }
      instances.add(slide.widget.instance_key);
    }
    for (const instance of embedded) {
      if (!instance.instance_key) {
        errors.push(`${label}.${instance.field} data-iw lacks data-iw-id`);
      } else if (instances.has(instance.instance_key)) {
        errors.push(`${label} duplicates interaction ${instance.instance_key}`);
      }
      instances.add(instance.instance_key);
    }
  }
  if (covers !== 1) errors.push("exactly one screen-cover is required");
  return errors;
}

function runNode(script, args) {
  const result = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) {
    result.status = 1;
    result.stderr = `${result.stderr || ""}\n${result.error.message}`.trim();
  }
  return result;
}

function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object in child output.");
  return JSON.parse(text.slice(start, end + 1));
}

function browserResult(result) {
  if (result.status === 0) return parseJson(result.stdout);
  try {
    return { ...parseJson(result.stdout), passed: false, exit_status: result.status };
  } catch {
    return {
      passed: false,
      error: result.stderr.trim() || "Browser check failed without JSON",
      exit_status: result.status
    };
  }
}

function findChrome() {
  return [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge"
  ].filter(Boolean).find(existsSync) || "";
}

async function launchChrome() {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome/Chromium not found; use --browser skip.");
  const profile = await mkdtemp(join(tmpdir(), "courseware-v2-"));
  const port = String(9500 + Math.floor(Math.random() * 300));
  const child = spawn(chrome, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--no-sandbox",
    "about:blank"
  ], { stdio: "ignore" });
  child.on("error", () => {});
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) {
        return {
          port,
          async stop() {
            child.kill("SIGTERM");
            await new Promise(done => setTimeout(done, 200));
            await rm(profile, { recursive: true, force: true });
          }
        };
      }
    } catch {
      // Chrome is still starting.
    }
    await new Promise(done => setTimeout(done, 120));
  }
  child.kill("SIGTERM");
  await rm(profile, { recursive: true, force: true });
  throw new Error("Timed out while starting headless Chrome.");
}

async function initLive(args) {
  if (!args.live || !args.content) throw new Error("init requires --live and --content.");
  const source = await readJson(resolve(args.content));
  const legacy = source.schema === "workflow/task-content/v1";
  const taskId = args["task-id"] || source.task_id || source.task_id;
  if (!taskId) throw new Error("Task id is required.");
  const cst = cstBlock(await cstHashes());
  const live = {
    schema: "workflow/live/v2",
    version: VERSION,
    task_id: taskId,
    phase: "draft",
    brief: legacy ? source.brief : source.brief,
    cst,
    deck: legacy ? {
      theme: source.theme,
      metadata: source.metadata,
      content: source.content,
      interaction: source.interaction_review || null,
      style_overrides: source.style_overrides || [],
      slides: source.slides
    } : source.deck,
    review: emptyReview(),
    human: { decision: "pending", notes: "", updated_at: null },
    preview: emptyPreview(),
    history: []
  };
  const livePath = resolve(args.live);
  if (args["source-html"]) {
    const original = resolve(args["source-html"]);
    if (!existsSync(original)) throw new Error(`Source HTML not found: ${original}`);
    const originalBytes = await readFile(original);
    const working = join(dirname(livePath), "working", basename(original));
    await mkdir(dirname(working), { recursive: true });
    await copyFile(original, working);
    live.source = {
      mode: "copy-on-write",
      original_ref: shownPath(original),
      working_ref: shownPath(working),
      sha256: sha256(originalBytes)
    };
  }
  history(live, "init", "legacy content imported" );
  await persistLive(livePath, live);
  console.log(JSON.stringify({
    passed: true,
    live: shownPath(livePath),
    phase: live.phase,
    cst: live.cst
  }, null, 2));
}

function validateOptions(live, args) {
  if (!args.live) throw new Error("--live is required.");
  const errors = validateLive(live);
  if (errors.length) throw new Error(`Invalid live.json:\n- ${errors.join("\n- ")}`);
}

async function buildLive(args) {
  const livePath = resolve(args.live);
  const live = await readJson(livePath);
  validateOptions(live, args);
  live.cst.hashes = await cstHashes();
  live.phase = "building";
  history(live, "build:start");
  await persistLive(livePath, live);

  const runDir = dirname(livePath);
  const previewPath = join(runDir, "preview.html");
  const build = runNode("Workflow/scripts/build-content.mjs", [
    "--content", livePath,
    "--output", previewPath,
    "--template", join(CST_ROOT, "TEMPLATE.html")
  ]);
  if (build.status !== 0) {
    live.phase = "blocked";
    history(live, "build:failed", build.stderr.trim());
    await persistLive(livePath, live);
    throw new Error(build.stderr.trim() || "Builder failed.");
  }
  if (live.source?.working_ref) {
    await copyFile(previewPath, resolve(ROOT, live.source.working_ref));
  }
  const staticReport = parseJson(runNode(
    "Workflow/scripts/check-static.mjs",
    [previewPath, "--json"]
  ).stdout);

  let browserReport = {
    passed: null,
    skipped: true,
    reason: "Browser check disabled with --browser skip"
  };
  if (args.browser !== "skip") {
    let browser = null;
    try {
      if (args.browser === "auto") browser = await launchChrome();
      browserReport = browserResult(runNode("Workflow/scripts/check-browser.mjs", [
        previewPath,
        "--port", browser?.port || String(args.browser)
      ]));
    } catch (error) {
      browserReport = { passed: false, error: error.message };
    } finally {
      if (browser) await browser.stop();
    }
    browserReport.checked_file = shownPath(previewPath);
  }

  const previewBytes = await readFile(previewPath);
  const artifactSha256 = sha256(Buffer.concat([
    Buffer.from(JSON.stringify(live.deck)),
    await readFile(join(CST_ROOT, "CONTENT.md")),
    await readFile(join(CST_ROOT, "SKILL.md")),
    await readFile(join(CST_ROOT, "TEMPLATE.html")),
    await readFile(join(ROOT, "Workflow/overrides/lab-v2.css")),
    previewBytes,
    Buffer.from(JSON.stringify(staticReport)),
    Buffer.from(JSON.stringify(browserReport))
  ]));
  live.preview = {
    html_ref: shownPath(previewPath),
    html_sha256: sha256(previewBytes),
    artifact_sha256: artifactSha256,
    checks: { static: staticReport, browser: browserReport },
    checked_at: now()
  };
  live.review = emptyReview();
  live.human = { decision: "pending", notes: "", updated_at: null };
  live.phase = "review_pending";
  history(live, "build:done", browserReport.skipped ? "static only" : "static+browser");
  await persistLive(livePath, live);
  console.log(JSON.stringify({
    passed: staticReport.passed && (browserReport.skipped || browserReport.passed),
    phase: live.phase,
    live: shownPath(livePath),
    preview: live.preview.html_ref,
    artifact_sha256: artifactSha256,
    review_request: {
      input_refs: [
        shownPath(livePath),
        live.preview.html_ref,
        ...(live.source ? [live.source.original_ref, live.source.working_ref] : [])
      ],
      output_schema: "review patch: {schema:\"workflow/review-patch/v2\", artifact_sha256, issues:[...]}",
      max_issues: 8
    }
  }, null, 2));
  if (!staticReport.passed || (!browserReport.skipped && !browserReport.passed)) {
    process.exitCode = 1;
  }
}

async function reviewLive(args) {
  if (!args.live || !args.input) throw new Error("review requires --live and --input.");
  const livePath = resolve(args.live);
  const live = await readJson(livePath);
  validateOptions(live, args);
  const patch = await readJson(resolve(args.input));
  if (patch.schema !== "workflow/review-patch/v2") {
    throw new Error("Review patch schema must be workflow/review-patch/v2.");
  }
  if (patch.artifact_sha256 !== live.preview.artifact_sha256) {
    throw new Error("Review patch is stale; rebuild or re-review the current preview.");
  }
  const issues = (patch.issues || [])
    .map((issue, index) => ({
      id: issue.id || `R-${index + 1}`,
      severity: issue.severity || "medium",
      area: issue.area || issue.layer || "visual",
      ...(issue.slide_id ? { slide_id: issue.slide_id } : {}),
      message: issue.message,
      suggestion: issue.suggestion || issue.suggested_action || "按问题描述修改"
    }))
    .sort((left, right) =>
      (SEVERITY_ORDER[left.severity] ?? 9) -
      (SEVERITY_ORDER[right.severity] ?? 9)
    )
    .slice(0, 8);
  live.review = {
    status: issues.length ? "needs_revision" : "pass",
    issues,
    summary: patch.summary || "",
    artifact_sha256: patch.artifact_sha256,
    reviewed_at: now()
  };
  live.phase = "awaiting_human";
  history(live, "review", `${issues.length} issues`);
  await persistLive(livePath, live);
  console.log(JSON.stringify({
    passed: true,
    phase: live.phase,
    live: shownPath(livePath),
    issues: live.review.issues
  }, null, 2));
}

async function feedbackLive(args) {
  if (!args.live || !args.decision) {
    throw new Error("feedback requires --live and --decision.");
  }
  if (!["approve", "revise", "abort"].includes(args.decision)) {
    throw new Error("--decision must be approve, revise or abort.");
  }
  const livePath = resolve(args.live);
  const live = await readJson(livePath);
  validateOptions(live, args);
  live.human = {
    decision: args.decision,
    notes: args.notes || "",
    updated_at: now()
  };
  live.phase = args.decision === "approve"
    ? "approved"
    : args.decision === "revise" ? "draft" : "blocked";
  history(
    live,
    "feedback",
    `${args.decision}${args.notes ? `: ${args.notes}` : ""}`
  );
  await persistLive(livePath, live);
  console.log(JSON.stringify({
    passed: true,
    phase: live.phase,
    live: shownPath(livePath),
    next: args.decision === "approve"
      ? "deliver"
      : args.decision === "revise" ? "patch deck and build again" : "stopped"
  }, null, 2));
}

async function promotePreview(live, publishDir) {
  const previewPath = resolve(ROOT, live.preview.html_ref);
  const deckName = deliverySlug(live);
  const target = join(publishDir, `${deckName}.html`);
  const temp = join(publishDir, `.${live.task_id}.promote.html`);
  let html = await readFile(previewPath, "utf8");
  if (/data-runtime=["']three["']/.test(html)) {
    const vendor = join(ROOT, "courseware/_assets/vendor/three-0.160.0/three.min.js");
    const oldSrc = live.deck.metadata.three_path ||
      relative(dirname(previewPath), vendor).replaceAll("\\", "/");
    const newSrc = live.deck.metadata.three_path ||
      relative(publishDir, vendor).replaceAll("\\", "/");
    html = html.replace(oldSrc, newSrc);
  }
  await mkdir(publishDir, { recursive: true });
  await writeFile(temp, html, "utf8");
  const report = parseJson(runNode(
    "Workflow/scripts/check-static.mjs",
    [temp, "--json"]
  ).stdout);
  if (!report.passed) {
    await rm(temp, { force: true });
    throw new Error("Promoted HTML failed static validation.");
  }
  await copyFile(temp, target);
  await rm(temp, { force: true });
  return target;
}

async function contentMarkdown(live, htmlPath) {
  const meta = live.deck.metadata;
  const interactionCount = live.deck.slides.reduce((count, slide) =>
    count + (slide.widget ? 1 : 0) + embeddedInstances(slide).length, 0);
  const htmlSha = sha256(await readFile(htmlPath));
  return `# ${meta.deck_title} — 课件内容与交付说明

> V2.0 单一 live.json 生成。

| 项目 | 内容 |
| --- | --- |
| Workflow | ${VERSION} |
| 课件版本 | ${meta.deck_version} |
| 课程 | ${meta.course} |
| 章节 | ${meta.chapter} |
| 页数 | ${live.deck.slides.length} |
| 交互实例 | ${interactionCount} |
| 基础审查 | ${live.review.status} |
| 人工决定 | ${live.human.decision} |

## 学习目标

${live.deck.content.learning_outcomes.map(item => `- ${item}`).join("\n")}

## 页面结构

| 页码 | 屏 ID | 屏型 | 标题 |
| ---: | --- | --- | --- |
${live.deck.slides.map((slide, index) =>
  `| ${index + 1} | ${slide.id} | ${slide.type} | ${slide.title || meta.deck_title} |`
).join("\n")}

## 来源

${live.deck.content.sources.map(source => `- ${source.title}: ${source.ref}`).join("\n")}

## 交付

- HTML SHA-256: \`${htmlSha}\`
- CST/CONTENT: \`${live.cst.hashes.content}\`
- CST/SKILL: \`${live.cst.hashes.skill}\`
- CST/TEMPLATE: \`${live.cst.hashes.template}\`
`;
}

async function deliverLive(args) {
  const livePath = resolve(args.live);
  const live = await readJson(livePath);
  validateOptions(live, args);
  if (live.human.decision !== "approve" || live.phase !== "approved") {
    throw new Error("deliver requires an approved live.json.");
  }
  const publishDir = resolve(args.publish ||
    join(ROOT, "courseware", deliverySlug(live)));
  const htmlPath = await promotePreview(live, publishDir);
  const deckName = deliverySlug(live);
  const markdownPath = join(publishDir, `content_${deckName}.md`);
  const jsonPath = join(publishDir, `content_${deckName}.json`);
  live.phase = "delivered";
  live.delivery = {
    html_ref: shownPath(htmlPath),
    json_ref: shownPath(jsonPath),
    markdown_ref: shownPath(markdownPath),
    delivered_at: now()
  };
  history(live, "deliver");
  await persistLive(livePath, live);
  await writeFile(markdownPath, await contentMarkdown(live, htmlPath), "utf8");
  await writeFile(jsonPath, `${JSON.stringify(live, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    passed: true,
    phase: live.phase,
    delivered: live.delivery
  }, null, 2));
}

async function statusLive(args) {
  if (!args.live) throw new Error("--live is required.");
  const live = await readJson(resolve(args.live));
  console.log(JSON.stringify({
    task_id: live.task_id,
    version: live.version,
    phase: live.phase,
    slides: live.deck.slides.length,
    review: live.review.status,
    issues: live.review.issues.length,
    human: live.human.decision,
    preview: live.preview.html_ref,
    delivery: live.delivery || null
  }, null, 2));
}

async function usageLive(args) {
  if (!args.live) throw new Error("--live is required.");
  const livePath = resolve(args.live);
  const live = await readJson(livePath);
  const input = Number(args["input-tokens"]) || 0;
  const cached = Number(args["cached-tokens"]) || 0;
  const output = Number(args["output-tokens"]) || 0;
  live.usage = {
    input_tokens: input,
    cached_tokens: cached,
    output_tokens: output,
    total_tokens: input + output,
    estimated_cost_cny: Number(args["cost-cny"]) || 0
  };
  history(live, "usage", `${input + output} tokens`);
  await persistLive(livePath, live);
  console.log(JSON.stringify({ passed: true, usage: live.usage }, null, 2));
}

function compactMemory(live, livePath, sourceBytes) {
  const issueBySlide = new Map(
    (live.review?.issues || [])
      .filter(issue => issue.slide_id)
      .map(issue => [issue.slide_id, issue])
  );
  const pages = (live.deck?.slides || []).map((slide, index) => {
    const embedded = embeddedInstances(slide);
    const interaction = slide.widget?.instance_key || embedded[0]?.instance_key || "";
    return {
      page: index + 1,
      slide_id: slide.id,
      type: slide.type,
      title: slide.title || live.deck.metadata.deck_title,
      ...(slide.title_en ? { title_en: slide.title_en } : {}),
      ...(interaction ? { interaction } : {}),
      ...(slide.linked_components?.length
        ? {
          linked_components: slide.linked_components.length,
          linked_state: slide.linked_state
        }
        : {}),
      status: issueBySlide.has(slide.id) ? "needs_fix" : "ready"
    };
  });
  const decisions = (live.history || []).slice(-20).map(item => ({
    at: item.at,
    action: item.action,
    ...(item.note ? { note: item.note } : {})
  }));
  const feedback = (live.history || [])
    .filter(item => item.action === "feedback")
    .slice(-10)
    .map(item => {
      const separator = item.note.indexOf(": ");
      return {
        at: item.at,
        decision: separator >= 0 ? item.note.slice(0, separator) : item.note,
        ...(separator >= 0 ? { notes: item.note.slice(separator + 2) } : {})
      };
    });
  const openIssues = (live.review?.issues || []).slice(0, 8).map(issue => ({
    id: issue.id,
    severity: issue.severity,
    ...(issue.slide_id ? { slide_id: issue.slide_id } : {}),
    message: issue.message
  }));
  return {
    schema: "courseware/memory/v1",
    version: "1.0",
    task_id: live.task_id,
    phase: live.phase,
    updated_at: now(),
    task: {
      request: live.brief?.request || live.brief?.objective || live.task_id,
      objective: live.brief.objective,
      audience: live.brief.audience,
      scope: live.brief.scope,
      delivery: live.brief.delivery,
      constraints: (live.brief.constraints || []).slice(0, 12)
    },
    history: {
      summary: [
        `${live.deck.slides.length} 页`,
        `阶段 ${live.phase}`,
        `${live.review?.issues?.length || 0} 个审查问题`,
        decisions.length
          ? `最近动作：${decisions.slice(-3).map(item => item.action).join(" → ")}`
          : "尚无历史动作"
      ].join("；"),
      decisions,
      feedback,
      open_issues: openIssues
    },
    pages,
    content: {
      ref: shownPath(livePath),
      sha256: sha256(sourceBytes),
      slides: live.deck.slides.length,
      version: live.deck.metadata.deck_version,
      theme: live.deck.theme,
      learning_outcomes: live.deck.content.learning_outcomes.length,
      sources: live.deck.content.sources.length,
      cst: live.cst.hashes
    },
    usage: live.usage || {
      input_tokens: 0,
      cached_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost_cny: 0
    }
  };
}

async function memoryLive(args) {
  if (!args.live) throw new Error("--live is required.");
  const livePath = resolve(args.live);
  const sourceBytes = await readFile(livePath);
  const live = JSON.parse(sourceBytes.toString("utf8"));
  const contextTokens = Number(args["context-tokens"]) ||
    DEFAULT_CONTEXT_WINDOW_TOKENS;
  const result = await writeMemoryFile(
    livePath,
    live,
    sourceBytes,
    contextTokens
  );
  const output = args.output ? resolve(args.output) : result.output;
  if (output !== result.output) {
    await mkdir(dirname(output), { recursive: true });
    await copyFile(result.output, output);
  }
  console.log(JSON.stringify({
    passed: true,
    memory: shownPath(output),
    bytes: result.bytes,
    pages: live.deck.slides.length,
    content_ref: shownPath(livePath),
    budget: result.budget
  }, null, 2));
}

async function pageLive(args) {
  if (!args.live || (!args.page && !args["slide-id"])) {
    throw new Error("page requires --live and either --page or --slide-id.");
  }
  const live = await readJson(resolve(args.live));
  const slides = live.deck?.slides || [];
  const index = args["slide-id"]
    ? slides.findIndex(slide => slide.id === args["slide-id"])
    : Number(args.page) - 1;
  const slide = slides[index];
  if (!slide) throw new Error("Requested page was not found.");
  const text = `${JSON.stringify({
    schema: "courseware/page-context/v1",
    task_id: live.task_id,
    page: index + 1,
    slide
  }, null, 2)}\n`;
  console.log(text.trimEnd());
}

async function resumeLive(args) {
  if (!args.live) throw new Error("--live is required.");
  const livePath = resolve(args.live);
  const contextTokens = Number(args["context-tokens"]) ||
    DEFAULT_CONTEXT_WINDOW_TOKENS;
  const sourceBytes = await readFile(livePath);
  const live = JSON.parse(sourceBytes.toString("utf8"));
  const memoryPath = join(dirname(livePath), "memory.json");
  const currentCst = await cstHashes();
  let memory = null;
  try {
    memory = await readJson(memoryPath);
  } catch {
    // Missing or invalid memory is regenerated below.
  }
  const stale = !memory ||
    memory.schema !== "courseware/memory/v1" ||
    memory.task_id !== live.task_id ||
    memory.content?.sha256 !== sha256(sourceBytes) ||
    memory.content?.cst?.content !== currentCst.content ||
    memory.content?.cst?.skill !== currentCst.skill ||
    memory.content?.cst?.template !== currentCst.template;
  if (stale) {
    await writeMemoryFile(livePath, live, sourceBytes, contextTokens);
    memory = await readJson(memoryPath);
  }
  const nextAction = {
    draft: "build",
    building: "build",
    review_pending: "review",
    awaiting_human: "feedback",
    approved: "deliver",
    delivered: "done",
    blocked: "inspect"
  }[live.phase] || "status";
  const memoryBytes = (await stat(memoryPath)).size;
  const pageBytes = Buffer.byteLength(JSON.stringify(memory.pages));
  const budget = contextBudget(contextTokens);
  const budgetStatus = memoryBytes > budget.recommended_bytes ? "warn" : "ok";
  console.log(JSON.stringify({
    schema: "courseware/resume/v1",
    task_id: live.task_id,
    phase: live.phase,
    refreshed: stale,
    memory_ref: shownPath(memoryPath),
    content_ref: memory.content.ref,
    content_sha256: memory.content.sha256,
    pages: live.deck.slides.length,
    request: memory.task.request,
    history_summary: memory.history.summary,
    open_issues: memory.history.open_issues,
    preview: live.preview?.html_ref || "",
    next_action: nextAction,
    budget: {
      status: budgetStatus,
      memory_bytes: memoryBytes,
      context_window_tokens: budget.context_window_tokens,
      effective_context_tokens: budget.effective_context_tokens,
      recommended_bytes: budget.recommended_bytes,
      hard_limit_bytes: budget.hard_limit_bytes,
      average_page_bytes: Math.ceil(pageBytes / Math.max(1, memory.pages.length)),
      estimated_tokens: Math.ceil(memoryBytes / BYTES_PER_TOKEN_ESTIMATE)
    }
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.action) {
    usage();
    return;
  }
  if (args.action === "init") await initLive(args);
  else if (args.action === "build") await buildLive(args);
  else if (args.action === "review") await reviewLive(args);
  else if (args.action === "feedback") await feedbackLive(args);
  else if (args.action === "deliver") await deliverLive(args);
  else if (args.action === "status") await statusLive(args);
  else if (args.action === "usage") await usageLive(args);
  else if (args.action === "memory") await memoryLive(args);
  else if (args.action === "page") await pageLive(args);
  else if (args.action === "resume") await resumeLive(args);
  else throw new Error(`Unknown action: ${args.action}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
