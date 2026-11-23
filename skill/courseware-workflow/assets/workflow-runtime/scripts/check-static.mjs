// 对 HTML 执行确定性静态检查，不调用模型。
import process from "node:process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr"
]);

function parseArgs(argv) {
  const result = { files: [], json: false };
  for (const arg of argv) {
    if (arg === "--json") result.json = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else result.files.push(arg);
  }
  return result;
}

async function expand(path) {
  const info = await stat(path);
  if (info.isFile()) return [resolve(path)];
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "_archive" || entry.name === "previews") continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await expand(child));
    else if (extname(entry.name).toLowerCase() === ".html") files.push(resolve(child));
  }
  return files;
}

function parseAttributes(source) {
  const attrs = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of source.matchAll(pattern)) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function isExternal(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

async function checkFile(path) {
  const errors = [];
  const warnings = [];
  const text = await readFile(path, "utf8");
  const display = path;
  const workflowManaged = /<meta\b[^>]*\bname=["']courseware-workflow["']/i.test(text);
  const workflowVersion = text.match(
    /<meta\b[^>]*\bname=["']courseware-workflow["'][^>]*\bcontent=["']([^"']+)["']/i
  )?.[1] || "";

  if (!/^\s*<!DOCTYPE html>/i.test(text)) errors.push("missing HTML doctype");
  if (!/<html\b[^>]*\blang=["'][^"']+["']/i.test(text)) errors.push("html lang is missing");
  if (!/<meta\b[^>]*\bcharset=["']?utf-8/i.test(text)) errors.push("UTF-8 charset is missing");
  if (text.includes("\r\n")) errors.push("CRLF line endings are not portable");
  const localProtocol = "file:" + "//";
  const unixHome = "/" + "home/";
  const windowsRoot = "C:" + "\\\\";
  if (text.includes(localProtocol) || text.includes(unixHome) ||
      text.includes(windowsRoot)) errors.push("absolute local path found");
  if (/\bstyle\s*=/i.test(text)) errors.push("inline style attribute found");
  if (workflowManaged && workflowVersion !== "2.0") {
    errors.push(`workflow version must be 2.0, found ${workflowVersion || "none"}`);
  }
  if (workflowManaged && !/data-workflow-override=["']2\.0["']/i.test(text)) {
    errors.push("missing Workflow V2.0 Lab override");
  }

  const markers = [
    ["{{", "template variable marker"],
    ["<!--@block:", "block marker"],
    ["<!--@body", "body marker"],
    ["<!--@slot:", "slot marker"],
    ["id=\"deck-blocks\"", "deck block template"]
  ];
  for (const [needle, label] of markers) {
    if (text.includes(needle)) errors.push(`${label} remains`);
  }

  const withoutCode = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  const stack = [];
  const ids = new Map();
  const instanceKeys = new Map();
  const assetTags = [];
  let slideCount = 0;
  let sectionCount = 0;
  let footCount = 0;
  const interactiveSlides = new Set();

  const tagPattern = /<(\/?)([a-zA-Z][\w:-]*)([^<>]*)>/g;
  for (const match of withoutCode.matchAll(tagPattern)) {
    const closing = match[1] === "/";
    const tag = match[2].toLowerCase();
    const attrSource = match[3] || "";
    if (closing) {
      const index = stack.map(item => item.tag).lastIndexOf(tag);
      if (index >= 0) stack.splice(index);
      continue;
    }

    const attrs = parseAttributes(attrSource);
    const isSlide = tag === "section" &&
      (attrs.class || "").split(/\s+/).includes("slide");
    const ancestorSlide = [...stack].reverse().find(item => item.isSlide);
    const ancestorIw = [...stack].reverse().find(item => "data-iw" in item.attrs);

    if (tag === "section") sectionCount++;
    if (isSlide) {
      slideCount++;
      if (!attrs["data-title-zh"] || !attrs["data-title-en"]) {
        const message = `slide ${slideCount} is missing bilingual data-title attributes`;
        if (workflowManaged) errors.push(message);
        else warnings.push(message);
      }
    }
    if (tag === "section" && [...stack].some(item => item.tag === "section")) {
      errors.push("nested section element found");
    }
    if (attrs.class && attrs.class.split(/\s+/).includes("foot")) footCount++;
    if (ancestorIw && "data-iw" in attrs) {
      errors.push(`nested data-iw root found: ${attrs["data-iw"]}`);
    }
    if ("data-iw" in attrs) {
      if (ancestorSlide) interactiveSlides.add(ancestorSlide.slideIndex);
      if (!attrs["data-iw-id"]) {
        errors.push(`data-iw="${attrs["data-iw"]}" is missing data-iw-id`);
      }
    }
    if (attrs.id) {
      ids.set(attrs.id, (ids.get(attrs.id) || 0) + 1);
    }
    if (attrs["data-iw-id"]) {
      instanceKeys.set(attrs["data-iw-id"], (instanceKeys.get(attrs["data-iw-id"]) || 0) + 1);
    }
    if (tag === "script" && attrs.src) assetTags.push({ tag, value: attrs.src });
    if (tag === "link" && attrs.href) assetTags.push({ tag, value: attrs.href });

    if (!VOID_ELEMENTS.has(tag) && !attrSource.trimEnd().endsWith("/")) {
      stack.push({
        tag,
        attrs,
        isSlide,
        slideIndex: isSlide ? slideCount : ancestorSlide?.slideIndex
      });
    }
  }

  for (const [id, count] of ids) {
    if (count > 1) errors.push(`duplicate id: ${id} (${count})`);
  }
  for (const [key, count] of instanceKeys) {
    if (count > 1) errors.push(`duplicate data-iw-id: ${key} (${count})`);
  }

  for (const asset of assetTags) {
    if (/^https?:/i.test(asset.value)) {
      errors.push(`remote runtime or stylesheet dependency: ${asset.value}`);
    } else if (!isExternal(asset.value)) {
      const clean = decodeURIComponent(asset.value.split(/[?#]/)[0]);
      const target = resolve(dirname(path), clean);
      if (!existsSync(target)) errors.push(`missing local asset: ${asset.value}`);
    }
  }

  if (!slideCount) errors.push("no .slide sections found");
  if (footCount && footCount !== slideCount) {
    errors.push(`slide/footer count mismatch: ${slideCount}/${footCount}`);
  }
  if (slideCount && interactiveSlides.size / slideCount < .7) {
    warnings.push(
      `interactive ratio ${interactiveSlides.size}/${slideCount} is below 70%`
    );
  }

  return {
    path: display,
    relativePath: relative(process.cwd(), display),
    passed: errors.length === 0,
    slides: slideCount,
    sections: sectionCount,
    interactiveSlides: interactiveSlides.size,
    errors,
    warnings
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.files.length) {
  console.error("Usage: node CST/tools/check-courseware.mjs <html-or-directory> [...] [--json]");
  process.exitCode = 1;
} else {
  const files = [];
  for (const target of args.files) files.push(...await expand(resolve(target)));
  const results = [];
  for (const file of files) {
    try {
      results.push(await checkFile(file));
    } catch (error) {
      results.push({
        path: file,
        passed: false,
        errors: [error.message],
        warnings: []
      });
    }
  }
  const passed = results.every(result => result.passed);
  if (args.json) {
    console.log(JSON.stringify({ passed, files: results }, null, 2));
  } else {
    for (const result of results) {
      console.log(`${result.passed ? "PASS" : "FAIL"} ${result.relativePath}`);
      for (const error of result.errors) console.log(`  error: ${error}`);
      for (const warning of result.warnings) console.log(`  warning: ${warning}`);
    }
  }
  if (!passed) process.exitCode = 1;
}
