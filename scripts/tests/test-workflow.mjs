// Installed Workflow V2.0 regression test.
import process from "node:process";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const projectRootArg = argumentValue("--project-root");
if (!projectRootArg) {
  throw new Error("--project-root <installed-project> is required.");
}
const PROJECT_ROOT = resolve(projectRootArg);
const ROOT = join(PROJECT_ROOT, "Workflow");
const temp = await mkdtemp(join(tmpdir(), "courseware-v2-"));
const example = join(ROOT, "examples/content.json");

function run(args) {
  const result = spawnSync(process.execPath, [
    resolve(PROJECT_ROOT, args[0]),
    ...args.slice(1)
  ], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024
  });
  if (result.error) {
    result.status = 1;
    result.stderr = `${result.stderr || ""}\n${result.error.message}`.trim();
  }
  return result;
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const cases = [];

try {
  const livePath = join(temp, "live.json");
  const init = run([
    "Workflow/scripts/run-task.mjs",
    "init",
    "--live", livePath,
    "--content", example,
    "--task-id", "v2-smoke-test"
  ]);
  const live = init.status === 0 ? await json(livePath) : null;
  cases.push({
    name: "One live.json imports legacy content",
    passed: init.status === 0 &&
      live?.schema === "workflow/live/v2" &&
      live?.deck?.slides?.length === 3 &&
      !existsSync(join(temp, "content.json")) &&
      !existsSync(join(temp, "state.json")),
    evidence: `init=${init.status}${init.stderr ? `; ${init.stderr.trim()}` : ""}`
  });

  const build = run([
    "Workflow/scripts/run-task.mjs",
    "build",
    "--live", livePath,
    "--browser", "skip"
  ]);
  const built = build.status === 0 ? await json(livePath) : null;
  const previewText = build.status === 0
    ? await readFile(join(temp, "preview.html"), "utf8")
    : "";
  cases.push({
    name: "Build stores preview, checks, and linked-component metadata",
    passed: build.status === 0 &&
      existsSync(join(temp, "preview.html")) &&
      built?.phase === "review_pending" &&
      built?.preview?.html_sha256?.length === 64 &&
      previewText.includes('data-linked-count="3"') &&
      previewText.includes('data-linked-state="delivery-gate-check"') &&
      !existsSync(join(temp, "reports")),
    evidence: `build=${build.status}`
  });

  const templateText = await readFile(join(ROOT, "CST/TEMPLATE.html"), "utf8");
  const networkStart = templateText.indexOf("if (sceneKind === 'workflow-network')");
  const hardwareStart = templateText.indexOf(
    "camera.position.set(0, 2.8, 7.4)",
    networkStart
  );
  const networkRuntime = networkStart >= 0 && hardwareStart > networkStart
    ? templateText.slice(networkStart, hardwareStart)
    : "";
  cases.push({
    name: "Workflow-network Three.js runtime is flat, light-free, and interactive",
    passed: networkRuntime.length > 0 &&
      networkRuntime.includes("new T.MeshBasicMaterial") &&
      !/\b(?:Ambient|Directional|Point)Light\b/.test(networkRuntime) &&
      networkRuntime.includes("pointerdown") &&
      networkRuntime.includes("pointermove") &&
      networkRuntime.includes("wheel") &&
      networkRuntime.includes("keydown") &&
      templateText.includes("data-network-orbit-range") &&
      networkRuntime.includes("orbitRange") &&
      networkRuntime.includes("data-three-lighting', 'none") &&
      networkRuntime.includes("requestAnimationFrame"),
    evidence: `networkRuntime=${networkRuntime.length} bytes`
  });

  const browserCheckText = await readFile(
    join(ROOT, "scripts/check-browser.mjs"),
    "utf8"
  );
  cases.push({
    name: "Browser regression audits enforce table shell and 3D language geometry",
    passed: templateText.includes(".ix-table-wrap > .ix-detail") &&
      templateText.includes("gap:0 !important") &&
      browserCheckText.includes("tableFrameAudits") &&
      browserCheckText.includes("threeLanguageSynced") &&
      browserCheckText.includes("threeAudits") &&
      browserCheckText.includes(
        "table interactions must use one outer frame and an internal divider"
      ) &&
      browserCheckText.includes(
        "3D status or canvas accessible name did not switch language"
      ),
    evidence: `checker=${Buffer.byteLength(browserCheckText)} bytes`
  });

  const memoryPath = join(temp, "memory.json");
  const memoryText = existsSync(memoryPath)
    ? await readFile(memoryPath, "utf8")
    : "";
  const memoryData = memoryText ? JSON.parse(memoryText) : null;
  cases.push({
    name: "Memory refreshes automatically with summaries and no HTML source",
    passed: existsSync(memoryPath) &&
      memoryData?.schema === "courseware/memory/v1" &&
      memoryData?.phase === "review_pending" &&
      memoryData?.pages?.length === 3 &&
      memoryData?.pages?.every(page => !("html" in page)) &&
      !/\b(?:body_html|left_html|right_html|visual_html)\b/.test(memoryText) &&
      Buffer.byteLength(memoryText) < 64 * 1024,
    evidence: `bytes=${Buffer.byteLength(memoryText)}`
  });

  const page = run([
    "Workflow/scripts/run-task.mjs",
    "page",
    "--live", livePath,
    "--slide-id", "s2"
  ]);
  const pageContext = page.status === 0 ? JSON.parse(page.stdout) : null;
  cases.push({
    name: "Page context loads one slide without the full live state",
    passed: page.status === 0 &&
      pageContext?.schema === "courseware/page-context/v1" &&
      pageContext?.page === 2 &&
      pageContext?.slide?.id === "s2" &&
      Buffer.byteLength(page.stdout) < Buffer.byteLength(await readFile(livePath)),
    evidence: `page=${page.status}; bytes=${Buffer.byteLength(page.stdout)}`
  });

  const resumeFresh = run([
    "Workflow/scripts/run-task.mjs",
    "resume",
    "--live", livePath
  ]);
  const freshData = resumeFresh.status === 0 ? JSON.parse(resumeFresh.stdout) : null;
  const staleMemory = await json(memoryPath);
  staleMemory.content.sha256 = "0".repeat(64);
  await writeFile(memoryPath, `${JSON.stringify(staleMemory, null, 2)}\n`, "utf8");
  const resumeStale = run([
    "Workflow/scripts/run-task.mjs",
    "resume",
    "--live", livePath
  ]);
  const refreshedData = resumeStale.status === 0 ? JSON.parse(resumeStale.stdout) : null;
  cases.push({
    name: "Resume validates hashes and refreshes stale memory",
    passed: resumeFresh.status === 0 &&
      freshData?.refreshed === false &&
      freshData?.next_action === "review" &&
      freshData?.budget?.status === "ok" &&
      freshData?.budget?.context_window_tokens === 1048576 &&
      freshData?.budget?.effective_context_tokens === 996147 &&
      freshData?.budget?.hard_limit_bytes >
        freshData?.budget?.context_window_tokens * 4 &&
      resumeStale.status === 0 &&
      refreshedData?.refreshed === true,
    evidence:
      `fresh=${resumeFresh.status}:${freshData?.refreshed}; ` +
      `stale=${resumeStale.status}:${refreshedData?.refreshed}`
  });

  const patchPath = join(temp, "review-patch.json");
  await writeFile(patchPath, `${JSON.stringify({
    schema: "workflow/review-patch/v2",
    artifact_sha256: built?.preview?.artifact_sha256 || "",
    summary: "一处版式问题",
    issues: [{
      id: "R-1",
      severity: "high",
      area: "visual",
      slide_id: "s2",
      message: "卡片间距偏紧",
      suggestion: "增加 18px 间距"
    }]
  }, null, 2)}\n`, "utf8");
  const review = run([
    "Workflow/scripts/run-task.mjs",
    "review",
    "--live", livePath,
    "--input", patchPath
  ]);
  const reviewed = review.status === 0 ? await json(livePath) : null;
  cases.push({
    name: "Review patch merges into the same live.json",
    passed: review.status === 0 &&
      reviewed?.phase === "awaiting_human" &&
      reviewed?.review?.issues?.length === 1 &&
      !existsSync(join(temp, "review-basic.json")),
    evidence: `review=${review.status}`
  });

  const revise = run([
    "Workflow/scripts/run-task.mjs",
    "feedback",
    "--live", livePath,
    "--decision", "revise",
    "--notes", "第 2 屏继续调整"
  ]);
  const approved = run([
    "Workflow/scripts/run-task.mjs",
    "feedback",
    "--live", livePath,
    "--decision", "approve",
    "--notes", "人工确认满意"
  ]);
  const publish = join(temp, "publish");
  const deliver = run([
    "Workflow/scripts/run-task.mjs",
    "deliver",
    "--live", livePath,
    "--publish", publish
  ]);
  const delivered = deliver.status === 0 ? await json(livePath) : null;
  const deliveredMemory = deliver.status === 0 ? await json(memoryPath) : null;
  cases.push({
    name: "Feedback and delivery update both live and compact memory",
    passed: revise.status === 0 &&
      approved.status === 0 &&
      deliver.status === 0 &&
      delivered?.phase === "delivered" &&
      deliveredMemory?.phase === "delivered" &&
      deliveredMemory?.history?.feedback?.length >= 2 &&
      existsSync(join(publish, "from-content-to-courseware.html")) &&
      existsSync(join(publish, "content_from-content-to-courseware.json")) &&
      existsSync(join(publish, "content_from-content-to-courseware.md")),
    evidence: `revise=${revise.status}; deliver=${deliver.status}`
  });

  const sourceHtml = join(temp, "source.html");
  await writeFile(sourceHtml, "<!doctype html><title>Original</title>", "utf8");
  const copyLive = join(temp, "copy-live.json");
  const copyInit = run([
    "Workflow/scripts/run-task.mjs",
    "init",
    "--live", copyLive,
    "--content", example,
    "--task-id", "v2-copy-test",
    "--source-html", sourceHtml
  ]);
  const copy = copyInit.status === 0 ? await json(copyLive) : null;
  cases.push({
    name: "Existing HTML is read in place and copied for work",
    passed: copyInit.status === 0 &&
      copy?.source?.mode === "copy-on-write" &&
      existsSync(resolve(PROJECT_ROOT, copy.source.working_ref)),
    evidence: `init=${copyInit.status}`
  });

  const synthetic = await json(example);
  synthetic.task_id = "fifty-page-budget";
  synthetic.metadata.deck_title = "五十页预算测试";
  synthetic.metadata.deck_title_en = "Fifty Page Budget Test";
  synthetic.slides = [{
    ...synthetic.slides[0],
    id: "s1"
  }];
  for (let page = 2; page <= 50; page++) {
    synthetic.slides.push({
      id: `s${page}`,
      type: "screen-text",
      eyebrow: String(page - 1).padStart(2, "0"),
      eyebrow_en: String(page - 1).padStart(2, "0"),
      title: `第 ${page} 页`,
      title_en: `Page ${page}`,
      body_html: `<p>Page ${page}</p>`
    });
  }
  const syntheticSource = join(temp, "fifty-page-content.json");
  const syntheticLive = join(temp, "fifty-page-live.json");
  await writeFile(
    syntheticSource,
    `${JSON.stringify(synthetic, null, 2)}\n`,
    "utf8"
  );
  const syntheticInit = run([
    "Workflow/scripts/run-task.mjs",
    "init",
    "--live", syntheticLive,
    "--content", syntheticSource,
    "--task-id", "fifty-page-budget"
  ]);
  const syntheticResume = syntheticInit.status === 0
    ? run([
      "Workflow/scripts/run-task.mjs",
      "resume",
      "--live", syntheticLive
    ])
    : null;
  const syntheticSummary = syntheticResume?.status === 0
    ? JSON.parse(syntheticResume.stdout)
    : null;
  cases.push({
    name: "Fifty-page memory stays within the recommended context budget",
    passed: syntheticInit.status === 0 &&
      syntheticResume?.status === 0 &&
      syntheticSummary?.pages === 50 &&
      syntheticSummary?.budget?.status === "ok" &&
      syntheticSummary?.budget?.memory_bytes <
        syntheticSummary?.budget?.recommended_bytes &&
      syntheticSummary?.budget?.average_page_bytes > 0,
    evidence:
      `bytes=${syntheticSummary?.budget?.memory_bytes}; ` +
      `avg=${syntheticSummary?.budget?.average_page_bytes}`
  });

  const unlinked = await json(example);
  unlinked.task_id = "unlinked-interaction-test";
  delete unlinked.slides.find(slide => slide.widget)?.linked_components;
  const unlinkedSource = join(temp, "unlinked-content.json");
  const unlinkedLive = join(temp, "unlinked-live.json");
  await writeFile(
    unlinkedSource,
    `${JSON.stringify(unlinked, null, 2)}\n`,
    "utf8"
  );
  const unlinkedInit = run([
    "Workflow/scripts/run-task.mjs",
    "init",
    "--live", unlinkedLive,
    "--content", unlinkedSource,
    "--task-id", "unlinked-interaction-test"
  ]);
  const unlinkedBuild = run([
    "Workflow/scripts/run-task.mjs",
    "build",
    "--live", unlinkedLive,
    "--browser", "skip"
  ]);
  cases.push({
    name: "Single-component interactive slides are rejected",
    passed: unlinkedInit.status === 0 &&
      unlinkedBuild.status !== 0 &&
      /linked_components/.test(unlinkedBuild.stderr),
    evidence: `build=${unlinkedBuild.status}`
  });

  const usage = run([
    "Workflow/scripts/run-task.mjs",
    "usage",
    "--live", livePath,
    "--input-tokens", "12000",
    "--cached-tokens", "10000",
    "--output-tokens", "800",
    "--cost-cny", "0.0042"
  ]);
  const usageLive = usage.status === 0 ? await json(livePath) : null;
  cases.push({
    name: "Token and cost data stay in live.json",
    passed: usage.status === 0 &&
      usageLive?.usage?.total_tokens === 12800 &&
      !existsSync(join(temp, "usage.json")),
    evidence: `usage=${usage.status}`
  });
} finally {
  await rm(temp, { recursive: true, force: true });
}

const passed = cases.every(item => item.passed);
console.log(JSON.stringify({ passed, cases }, null, 2));
if (!passed) process.exitCode = 1;
