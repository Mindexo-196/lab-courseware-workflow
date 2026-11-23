// 将 live.json.deck（或兼容的 content.json）与 CST/TEMPLATE.html 装配为 HTML。
import process from "node:process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOW_VERSION = "2.0";
const STANDARD_ROOT = existsSync(join(ROOT, "CST/TEMPLATE.html"))
  ? join(ROOT, "CST")
  : join(ROOT, "Workflow/CST");

const SCREEN_TYPES = new Set([
  "screen-cover",
  "screen-text",
  "screen-split",
  "screen-table",
  "screen-figure",
  "screen-widget",
  "screen-summary",
  "screen-quiz"
]);

function usage() {
  console.error(
    "Usage: node Workflow/scripts/build-content.mjs --content <file> --output <file> " +
    "[--template CST/TEMPLATE.html]"
  );
}

function parseArgs(argv) {
  const args = {
    template: join(STANDARD_ROOT, "TEMPLATE.html"),
    override: "Workflow/overrides/lab-v2.css"
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--content" || arg === "--output" || arg === "--template" ||
        arg === "--override") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value.`);
      args[arg.slice(2)] = value;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function valueAt(root, path) {
  return path.split(".").reduce(
    (value, key) => value == null ? undefined : value[key],
    root
  );
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function replaceConditionals(source, vars) {
  const pattern = /<!--@if:([\w.]+)-->([\s\S]*?)<!--\/@if:\1-->/;
  let result = source;
  let match;
  while ((match = result.match(pattern))) {
    const replacement = hasValue(valueAt(vars, match[1])) ? match[2] : "";
    result = result.slice(0, match.index) + replacement +
      result.slice(match.index + match[0].length);
  }
  return result;
}

function renderFragment(fragment, vars, rawSlots) {
  const sentinels = new Map();
  let output = replaceConditionals(fragment, vars);

  output = output.replace(
    /<!--@(?:body(?::(left|right|visual))?|slot:deck)-->/g,
    (_, part) => {
      const key = part ? `body:${part}` : "body";
      const sentinel = `@@CW_RAW_${sentinels.size}@@`;
      sentinels.set(sentinel, rawSlots[key] || "");
      return sentinel;
    }
  );

  output = output.replace(/\{\{([^{}]+)\}\}/g, (_, path) => {
    const value = valueAt(vars, path.trim());
    if (!hasValue(value)) throw new Error(`Missing template value: ${path.trim()}`);
    return escapeHtml(value);
  });

  for (const [sentinel, raw] of sentinels) {
    output = output.replaceAll(sentinel, raw);
  }
  return output;
}

function replaceKnownVariables(source, vars) {
  return source.replace(/\{\{([^{}]+)\}\}/g, (original, rawPath) => {
    const value = valueAt(vars, rawPath.trim());
    return hasValue(value) ? escapeHtml(value) : original;
  });
}

function validateContent(content) {
  const errors = [];
  if (content.schema !== "workflow/task-content/v1") {
    errors.push("schema must be workflow/task-content/v1");
  }
  if (content.theme !== "lab") errors.push("theme must be lab");
  if (!Array.isArray(content.slides) || !content.slides.length) {
    errors.push("slides must contain at least one slide");
  }
  if (!content.metadata || typeof content.metadata !== "object") {
    errors.push("metadata is required");
  }
  if (content.style_overrides !== undefined) {
    if (!Array.isArray(content.style_overrides) ||
        content.style_overrides.some(item => typeof item !== "string")) {
      errors.push("style_overrides must be an array of strings");
    } else if (content.style_overrides.some(item => /<\/style\s*>/i.test(item))) {
      errors.push("style_overrides must not contain a closing style tag");
    }
  }

  const ids = new Set();
  const instanceKeys = new Set();
  for (const [index, slide] of (content.slides || []).entries()) {
    const label = `slides[${index}]`;
    if (!/^s[0-9]+$/.test(slide.id || "")) errors.push(`${label}.id must match s<number>`);
    if (ids.has(slide.id)) errors.push(`${label}.id is duplicated: ${slide.id}`);
    ids.add(slide.id);
    if (!SCREEN_TYPES.has(slide.type)) errors.push(`${label}.type is unsupported: ${slide.type}`);
    if (slide.type === "screen-cover" && !slide.visual_html) {
      errors.push(`${label}.visual_html is required for screen-cover`);
    }
    if (slide.type === "screen-split" && (!slide.left_html || !slide.right_html)) {
      errors.push(`${label} requires left_html and right_html`);
    }
    if (["screen-widget", "screen-quiz"].includes(slide.type) && !slide.widget) {
      errors.push(`${label}.widget is required for ${slide.type}`);
    }
    const interactive = Boolean(slide.widget) ||
      [slide.body_html, slide.left_html, slide.right_html, slide.visual_html]
        .some(fragment => /\bdata-iw\s*=/.test(fragment || ""));
    if (interactive) {
      if (!Array.isArray(slide.linked_components) ||
          slide.linked_components.length < 2) {
        errors.push(`${label}.linked_components must contain at least two components`);
      }
      if (!slide.linked_state) {
        errors.push(`${label}.linked_state is required for interactive slides`);
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
      if (instanceKeys.has(slide.widget.instance_key)) {
        errors.push(`${label}.widget.instance_key is duplicated`);
      }
      instanceKeys.add(slide.widget.instance_key);
    }
  }

  const covers = (content.slides || []).filter(slide => slide.type === "screen-cover");
  if (covers.length !== 1) errors.push("exactly one screen-cover is required");
  return errors;
}

function blockMap(template) {
  const blocks = new Map();
  const pattern = /<!--@block:([a-z-]+)-->([\s\S]*?)<!--\/@block:\1-->/g;
  for (const match of template.matchAll(pattern)) {
    blocks.set(match[1], match[2].trim());
  }
  return blocks;
}

function makeGlobalVars(content) {
  const metadata = content.metadata;
  return {
    course: metadata.course,
    course_en: metadata.course_en,
    chapter: metadata.chapter,
    chapter_en: metadata.chapter_en,
    part: metadata.part,
    part_en: metadata.part_en,
    range: metadata.range,
    range_en: metadata.range_en,
    deck_title: metadata.deck_title,
    deck_en: metadata.deck_title_en,
    deck_sub: metadata.deck_sub,
    deck_sub_en: metadata.deck_sub_en,
    date: metadata.date,
    members: metadata.members,
    members_en: metadata.members_en,
    theme: content.theme,
    slides: content.slides.length,
    version: metadata.deck_version
  };
}

function makeSlideVars(slide, index, total) {
  const widget = slide.widget || {};
  return {
    eyebrow: slide.eyebrow || "",
    eyebrow_en: slide.eyebrow_en || "",
    title: slide.title || "",
    title_en: slide.title_en || "",
    lead: slide.lead || "",
    lead_en: slide.lead_en || "",
    note: slide.note || "",
    note_en: slide.note_en || "",
    foot: `${index + 1} / ${total}`,
    iw: widget.key || "",
    iw_key: widget.instance_key || "",
    iw_title: widget.title || "",
    iw_title_en: widget.title_en || "",
    iw_value: widget.value || ""
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.content || !args.output) {
    usage();
    process.exitCode = 1;
    return;
  }

  const contentPath = resolve(args.content);
  const templatePath = resolve(args.template);
  const overridePath = resolve(args.override);
  const outputPath = resolve(args.output);
  const input = JSON.parse(await readFile(contentPath, "utf8"));
  const content = input.schema === "workflow/live/v2"
    ? {
      schema: "workflow/task-content/v1",
      version: "1.0",
      task_id: input.task_id,
      ...input.deck
    }
    : input;
  const validationErrors = validateContent(content);
  if (validationErrors.length) {
    throw new Error(`Invalid content:\n- ${validationErrors.join("\n- ")}`);
  }

  const source = await readFile(templatePath, "utf8");
  const override = await readFile(overridePath, "utf8");
  const blocks = blockMap(source);
  const globals = makeGlobalVars(content);
  const renderedSlides = content.slides.map((slide, index) => {
    const block = blocks.get(slide.type);
    if (!block) throw new Error(`Template block not found: ${slide.type}`);
    const vars = {
      ...globals,
      s: makeSlideVars(slide, index, content.slides.length)
    };
    const slots = {
      body: slide.body_html || "",
      "body:left": slide.left_html || "",
      "body:right": slide.right_html || "",
      "body:visual": slide.visual_html || ""
    };
    const rendered = renderFragment(block, vars, slots);
    if (!slide.linked_components?.length) return rendered;
    const linkedTypes = [...new Set(
      slide.linked_components.map(component => component.type)
    )];
    const attrs =
      ` data-linked-count="${slide.linked_components.length}"` +
      ` data-linked-types="${escapeHtml(linkedTypes.join(" "))}"` +
      ` data-linked-state="${escapeHtml(slide.linked_state || "")}"`;
    return rendered.replace("<section ", `<section${attrs} `);
  });

  let html = replaceKnownVariables(source, globals);
  html = html.replace(
    /<meta charset="utf-8">/i,
    `<meta charset="utf-8">\n<meta name="courseware-workflow" content="${WORKFLOW_VERSION}">`
  );
  html = html.replace(
    "</head>",
    `<style data-workflow-override="${WORKFLOW_VERSION}">\n${override}</style>\n</head>`
  );
  if (content.style_overrides?.length) {
    const contentOverrides = content.style_overrides.join("\n").trim();
    html = html.replace(
      "</head>",
      `<style data-content-overrides="${WORKFLOW_VERSION}">\n${contentOverrides}\n</style>\n</head>`
    );
  }
  html = html.replace("<!--@slot:deck-->", renderedSlides.join("\n"));
  html = html.replace(
    /\s*<!-- 屏型片段：不渲染；装配时取用，最后整块删除 -->\s*<template id="deck-blocks">[\s\S]*?<\/template>/,
    ""
  );

  const usesThree = /data-iw=["']three["']/.test(html);
  if (!usesThree) {
    html = html.replace(
      /\s*<script type="text\/javascript" data-runtime="three"[^>]*><\/script>/,
      ""
    );
    html = html.replace(
      /\s*<script data-runtime="three"[^>]*><\/script>/,
      ""
    );
  } else {
    const threePath = content.metadata.three_path || relative(
      dirname(outputPath),
      join(ROOT, "courseware/_assets/vendor/three-0.160.0/three.min.js")
    ).replaceAll("\\", "/");
    html = html.replace(
      /(<script data-runtime="three"[^>]*\bsrc=")[^"]+(")/,
      `$1${escapeHtml(threePath)}$2`
    );
  }

  const leftovers = [
    ["template variable", /\{\{[^{}]+\}\}/],
    ["block marker", /<!--@block:/],
    ["body marker", /<!--@body/],
    ["slot marker", /<!--@slot:/],
    ["deck template", /id="deck-blocks"/]
  ].filter(([, pattern]) => pattern.test(html));
  if (leftovers.length) {
    const variables = [...html.matchAll(/\{\{[^{}]+\}\}/g)].slice(0, 8)
      .map(match => match[0]);
    const detail = variables.length ? ` (${variables.join(", ")})` : "";
    throw new Error(
      `Assembly left unresolved markers: ${leftovers.map(item => item[0]).join(", ")}${detail}`
    );
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, "utf8");
  const runtimePath = usesThree
    ? resolve(dirname(outputPath), content.metadata.three_path || relative(
      dirname(outputPath),
      join(ROOT, "courseware/_assets/vendor/three-0.160.0/three.min.js")
    ))
    : null;
  console.log(JSON.stringify({
    passed: true,
    content: contentPath,
    workflowVersion: WORKFLOW_VERSION,
    output: outputPath,
    slides: content.slides.length,
    bytes: Buffer.byteLength(html),
    usesThree,
    hasContentOverrides: Boolean(content.style_overrides?.length),
    runtimeExists: runtimePath ? existsSync(runtimePath) : true
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
