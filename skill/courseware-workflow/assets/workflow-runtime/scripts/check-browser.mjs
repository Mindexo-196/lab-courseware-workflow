// 使用 Chrome DevTools Protocol 检查真实渲染与交互；截图仅用于失败诊断。
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = { port: "9231", wait: 1800 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" || arg === "--shots" || arg === "--wait") {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value.`);
      args[arg.slice(2)] = value;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (!args.target) {
      args.target = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.target) {
    console.error(
      "Usage: node CST/tools/check-browser.mjs <html-or-url> " +
      "[--port 9231] [--wait 1800] [--shots <dir>]"
    );
    if (!args.help) process.exitCode = 1;
    return;
  }

  const target = /^[a-z][a-z0-9+.-]*:/i.test(args.target)
    ? args.target
    : pathToFileURL(resolve(args.target)).href;
  const pages = await fetch(`http://127.0.0.1:${args.port}/json/list`)
    .then(response => response.json());
  const page = pages.find(item => item.type === "page" && !item.url.startsWith("chrome://"));
  if (!page) throw new Error("No browser page is available for runtime validation.");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const runtimeErrors = [];
  let nextId = 0;

  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
    if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(
        message.params.exceptionDetails.exception?.description ||
        message.params.exceptionDetails.text
      );
    }
    if (message.method === "Runtime.consoleAPICalled" &&
        message.params.type === "error") {
      runtimeErrors.push(message.params.args.map(arg => arg.value || arg.description).join(" "));
    }
    if (message.method === "Log.entryAdded" &&
        message.params.entry.level === "error") {
      runtimeErrors.push(message.params.entry.text);
    }
  };
  await new Promise((resolveOpen, rejectOpen) => {
    socket.onopen = resolveOpen;
    socket.onerror = rejectOpen;
  });

  function send(method, params = {}) {
    return new Promise(resolveMessage => {
      const id = ++nextId;
      pending.set(id, resolveMessage);
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const response = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (response.result.exceptionDetails) {
      throw new Error(
        response.result.exceptionDetails.exception?.description ||
        response.result.exceptionDetails.text
      );
    }
    return response.result.result.value;
  }

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Page.navigate", { url: target });
  await new Promise(done => setTimeout(done, Number(args.wait)));
  runtimeErrors.length = 0;

  const summary = await evaluate(`(() => {
    const slides = [...document.querySelectorAll("#deck .slide")];
    const ids = [...document.querySelectorAll("[id]")].map(node => node.id);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const nestedIws = [...document.querySelectorAll("[data-iw]")]
      .filter(node => node.parentElement?.closest("[data-iw]"))
      .map(node => node.getAttribute("data-iw"));
    const missingTitles = slides
      .map((slide, index) => ({
        index: index + 1,
        title: slide.dataset.titleZh || slide.dataset.titleEn
      }))
      .filter(item => !item.title);
    const workflowVersion = document.querySelector('meta[name="courseware-workflow"]')?.content || "";
    const pageTitles = [...document.querySelectorAll(".slide .h2")];
    const coverTitles = [...document.querySelectorAll(".cover-title .zh, .cover-title .en")];
    const cover = document.querySelector(".slide .cover-title");
    const stageRect = document.getElementById("stage")?.getBoundingClientRect();
    const coverRect = cover?.getBoundingClientRect();
    const titleFonts = [...pageTitles, ...coverTitles].map(node =>
      getComputedStyle(node).fontFamily
    );
    const spacedBlocks = [...document.querySelectorAll(
      ".body-area > :not(:first-child), .wx-body > :not(:first-child)"
    )];
    const spacingValues = spacedBlocks.map(node =>
      parseFloat(getComputedStyle(node).marginTop) || 0
    );
    return {
      title: document.title,
      lang: document.documentElement.lang,
      slides: slides.length,
      activeSlides: slides.filter(slide => slide.classList.contains("on")).length,
      duplicateIds,
      nestedIws,
      missingTitles,
      hasController: Boolean(window.CW && typeof window.CW.goto === "function"),
      workflowVersion,
      styleAudit: {
        titleCount: titleFonts.length,
        titleFonts,
        coverTitleInside: Boolean(
          stageRect && coverRect &&
          coverRect.left >= stageRect.left - 2 &&
          coverRect.right <= stageRect.right + 2 &&
          coverRect.top >= stageRect.top - 2 &&
          coverRect.bottom <= stageRect.bottom + 2
        ),
        spacingCount: spacingValues.length,
        minSpacing: spacingValues.length ? Math.min(...spacingValues) : null
      }
    };
  })()`);

  const slideAudits = [];
  for (let index = 0; index < summary.slides; index++) {
    const audit = await evaluate(`(() => {
      window.CW.goto(${index});
      const slide = document.querySelectorAll("#deck .slide")[${index}];
      const stage = document.getElementById("stage").getBoundingClientRect();
      const candidates = [...slide.querySelectorAll("div,table,svg,p,h1,h2,h3,button,input")]
        .filter(node => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" &&
            Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
        });
      const overflow = candidates.flatMap(node => {
        const rect = node.getBoundingClientRect();
        const delta = Math.max(
          stage.left - rect.left,
          rect.right - stage.right,
          stage.top - rect.top,
          rect.bottom - stage.bottom
        );
        return delta > 2 ? [{
          tag: node.tagName.toLowerCase(),
          className: String(node.className || ""),
          delta: Math.round(delta)
        }] : [];
      });
      const grid3Audits = [...slide.querySelectorAll(".grid-3")].map(grid => {
        const cards = [...grid.children].filter(node =>
          node.classList?.contains("card")
        );
        const heights = cards.map(node => node.getBoundingClientRect().height);
        return {
          cards: cards.length,
          spread: heights.length ? Math.max(...heights) - Math.min(...heights) : 0
        };
      });
      return {
        index: ${index + 1},
        active: slide.classList.contains("on"),
        elements: candidates.length,
        interactiveRoots: slide.querySelectorAll("[data-iw]").length,
        linkedComponents: Number(slide.dataset.linkedCount || 0),
        linkedTypes: slide.dataset.linkedTypes || "",
        linkedState: slide.dataset.linkedState || "",
        overflow: overflow.slice(0, 5),
        overflowCount: overflow.length,
        grid3Audits
      };
    })()`);
    slideAudits.push(audit);
    await new Promise(done => setTimeout(done, 40));
  }

  const interactionControlAudits = await evaluate(`(async () => {
    const result = [];
    const slides = [...document.querySelectorAll("#deck .slide")];
    for (let slideIndex = 0; slideIndex < slides.length; slideIndex++) {
      window.CW.goto(slideIndex);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const slide = slides[slideIndex];
      const root = slide.querySelector("[data-iw]");
      if (!root) { continue; }
      const controls = [...root.querySelectorAll(
        'button, input, select, textarea, [role="button"], [tabindex="0"]'
      )].filter(node => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return !node.disabled &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0 &&
          rect.width > 0 && rect.height > 0;
      });
      result.push({
        slide: slideIndex + 1,
        instance: root.getAttribute("data-iw-id"),
        controls: controls.length,
        controlKinds: [...new Set(controls.map(node =>
          node.getAttribute("data-table-view") ||
          node.getAttribute("data-svg-view") ||
          node.getAttribute("data-quiz-hint") !== null ? "linked-control" :
          node.getAttribute("data-svg-node") !== null ? "svg-node" :
          node.getAttribute("role") === "button" ? "button-row" :
          node.tagName.toLowerCase()
        ))]
      });
    }
    return result;
  })()`);

  const tableAudits = await evaluate(`(async () => {
    const result = [];
    const slides = [...document.querySelectorAll("#deck .slide")];
    for (let slideIndex = 0; slideIndex < slides.length; slideIndex++) {
      const slide = slides[slideIndex];
      const scroll = slide.querySelector(".table-scroll");
      if (!scroll) { continue; }
      window.CW.goto(slideIndex);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rows = [...scroll.querySelectorAll("tbody tr:not([hidden])")];
      const last = rows.at(-1);
      const scrollRect = scroll.getBoundingClientRect();
      const lastRect = last?.getBoundingClientRect();
      const focusButton = scroll.querySelector('[data-table-view="focus"]');
      const allButton = scroll.querySelector('[data-table-view="all"]');
      focusButton?.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const hiddenAfterFocus = scroll.querySelectorAll("tbody tr[hidden]").length;
      const visibleAfterFocus = scroll.querySelectorAll("tbody tr:not([hidden])").length;
      allButton?.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const hiddenAfterRestore = scroll.querySelectorAll("tbody tr[hidden]").length;
      result.push({
        slide: slideIndex + 1,
        title: slide?.dataset.titleZh || "",
        rows: rows.length,
        lastRowVisible: Boolean(
          lastRect &&
          lastRect.top >= scrollRect.top - 1 &&
          lastRect.bottom <= scrollRect.bottom + 1
        ),
        toolbarControls: scroll.querySelectorAll("[data-table-view]").length,
        focusModeWorks: Boolean(
          rows.length > 1 &&
          hiddenAfterFocus === rows.length - 1 &&
          visibleAfterFocus === 1 &&
          hiddenAfterRestore === 0
        )
      });
    }
    return result;
  })()`);

  const tableFrameAudits = await evaluate(`(() => {
    return [...document.querySelectorAll(".ix-table-wrap")].map(wrap => {
      const slide = wrap.closest(".slide");
      const outer = getComputedStyle(wrap);
      const detailNode = wrap.querySelector(".ix-detail");
      const detail = detailNode ? getComputedStyle(detailNode) : null;
      return {
        slide: [...document.querySelectorAll("#deck .slide")].indexOf(slide) + 1,
        hasDetail: Boolean(detailNode),
        gap: Number.parseFloat(outer.gap) || 0,
        outerBorderWidth: Number.parseFloat(outer.borderTopWidth) || 0,
        outerRadius: Number.parseFloat(outer.borderTopLeftRadius) || 0,
        detailTopBorderWidth: detail
          ? Number.parseFloat(detail.borderTopWidth) || 0
          : -1,
        detailLeftBorderWidth: detail
          ? Number.parseFloat(detail.borderLeftWidth) || 0
          : -1,
        detailRadius: detail
          ? Number.parseFloat(detail.borderTopLeftRadius) || 0
          : -1,
        detailShadowNone: detail ? detail.boxShadow === "none" : false,
        detailBackdropNone: detail ? detail.backdropFilter === "none" : false
      };
    });
  })()`);

  const flowAudits = await evaluate(`(() => {
    const roots = [...document.querySelectorAll(".ix-svg")].filter(root =>
      root.querySelector("[data-svg-node]")
    );
    return roots.map(root => {
      const slide = root.closest(".slide");
      const container = root.closest('[data-iw="svg"]') || root;
      window.CW.goto([...document.querySelectorAll("#deck .slide")].indexOf(slide));
      const nodes = [...root.querySelectorAll("[data-svg-node]")];
      const svg = root.querySelector("svg");
      const nativeTitleCount = svg ? svg.querySelectorAll("title").length : 0;
      const accessibleName = svg?.getAttribute("aria-label") ||
        svg?.getAttribute("aria-labelledby") || "";
      const nodeStrokesClear = nodes.every(node =>
        [...node.querySelectorAll("rect, polygon, circle, path, line, polyline")]
          .every(shape => getComputedStyle(shape).stroke === "none")
      );
      const initialActive = nodes.filter(node => node.classList.contains("is-on"));
      let keyboardSynced = true;
      let focusOutline = "none";
      let activeShapeStroke = "none";
      let activeShapeFill = "none";
      let activeNodeWithinBounds = true;
      let pointerEvents = "none";
      let afterTitle = "";
      let afterDetail = "";
      let expectedTitle = "";
      let expectedDetail = "";
      if (nodes.length > 1) {
        nodes[1].focus();
        focusOutline = getComputedStyle(nodes[1]).outlineStyle;
        nodes[1].dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true
        }));
        const active = nodes.filter(node => node.classList.contains("is-on"));
        const title = container.querySelector("[data-svg-title]")?.textContent || "";
        const detail = container.querySelector("[data-svg-detail]")?.textContent || "";
        const expectedTitleZh = nodes[1].getAttribute("data-label-zh") || "";
        const expectedTitleEn = nodes[1].getAttribute("data-label-en") || "";
        const expectedDetailZh = nodes[1].getAttribute("data-detail-zh") || "";
        afterTitle = title;
        afterDetail = detail;
        expectedTitle = [expectedTitleZh, expectedTitleEn].filter(Boolean).join(" / ");
        expectedDetail = expectedDetailZh;
        keyboardSynced = active.length === 1 &&
          active[0] === nodes[1] &&
          (
            (!expectedTitleZh || title.includes(expectedTitleZh)) ||
            (!expectedTitleEn || title.includes(expectedTitleEn))
          ) &&
          (!expectedDetailZh || detail.includes(expectedDetailZh));
      }
      const active = nodes.filter(node => node.classList.contains("is-on"));
      if (active.length === 1) {
        pointerEvents = getComputedStyle(active[0]).pointerEvents;
        const shape = active[0].querySelector("rect, polygon, circle");
        if (shape) {
          const shapeStyle = getComputedStyle(shape);
          activeShapeStroke = shapeStyle.stroke;
          activeShapeFill = shapeStyle.fill;
        }
        const nodeRect = active[0].getBoundingClientRect();
        const svgRect = root.querySelector("svg")?.getBoundingClientRect();
        activeNodeWithinBounds = Boolean(
          svgRect &&
          nodeRect.left >= svgRect.left - 2 &&
          nodeRect.right <= svgRect.right + 2 &&
          nodeRect.top >= svgRect.top - 2 &&
          nodeRect.bottom <= svgRect.bottom + 2
        );
      }
      const singleFill = Boolean(root.closest('[data-flow-highlight="single-fill"]'));
      return {
        slide: [...document.querySelectorAll("#deck .slide")].indexOf(slide) + 1,
        nodes: nodes.length,
        initialActive: initialActive.length,
        nativeTitleCount,
        accessibleName,
        nodeStrokesClear,
        activeAfterKeyboard: active.length,
        keyboardSynced,
        focusOutline,
        activeShapeStroke,
        activeShapeFill,
        activeNodeWithinBounds,
        pointerEvents,
        singleFill,
        activeKey: active[0]?.getAttribute("data-svg-node") || "",
        afterTitle,
        afterDetail,
        expectedTitle,
        expectedDetail
      };
    });
  })()`);

  const svgViewAudits = await evaluate(`(async () => {
    const roots = [...document.querySelectorAll(".svg-scene[data-iw]")];
    const result = [];
    for (const root of roots) {
      const slide = root.closest(".slide");
      window.CW.goto([...document.querySelectorAll("#deck .slide")].indexOf(slide));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const focus = root.querySelector('[data-svg-view="focus"]');
      const all = root.querySelector('[data-svg-view="all"]');
      focus?.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const active = root.querySelector("[data-svg-node].is-on");
      const other = [...root.querySelectorAll("[data-svg-node]:not(.is-on)")][0];
      const focusWorks = root.getAttribute("data-view") === "focus" &&
        Boolean(active) &&
        Boolean(other) &&
        Number(getComputedStyle(other).opacity) < .5;
      all?.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      result.push({
        slide: [...document.querySelectorAll("#deck .slide")].indexOf(slide) + 1,
        focusWorks,
        restored: root.getAttribute("data-view") === "all",
        controls: root.querySelectorAll("[data-svg-view]").length
      });
    }
    return result;
  })()`);

  const quizHintAudits = await evaluate(`(async () => {
    const result = [];
    for (const root of [...document.querySelectorAll('[data-iw="quiz"]')]) {
      const slide = root.closest(".slide");
      window.CW.goto([...document.querySelectorAll("#deck .slide")].indexOf(slide));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const button = root.querySelector("[data-quiz-hint]");
      const why = root.querySelector(".why");
      button?.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const opened = why?.classList.contains("show") &&
        button?.getAttribute("aria-pressed") === "true";
      button?.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      result.push({
        slide: [...document.querySelectorAll("#deck .slide")].indexOf(slide) + 1,
        hintWorks: Boolean(opened),
        restored: !why?.classList.contains("show") &&
          button?.getAttribute("aria-pressed") === "false"
      });
    }
    return result;
  })()`);

  const language = await evaluate(`(() => {
    const before = document.documentElement.lang;
    const flowBefore = [...document.querySelectorAll("[data-svg-node].is-on")]
      .map(node => node.getAttribute("data-svg-node"));
    const threeBefore = [...document.querySelectorAll('[data-iw="three"]')].map(root => ({
      status: root.querySelector(".three-status")?.textContent.trim() || "",
      label: root.querySelector(".three-canvas")?.getAttribute("aria-label") || ""
    }));
    document.getElementById("langBtn")?.click();
    const toggled = document.documentElement.lang;
    const flowAfter = [...document.querySelectorAll("[data-svg-node].is-on")]
      .map(node => node.getAttribute("data-svg-node"));
    const threeAfter = [...document.querySelectorAll('[data-iw="three"]')].map(root => ({
      status: root.querySelector(".three-status")?.textContent.trim() || "",
      label: root.querySelector(".three-canvas")?.getAttribute("aria-label") || ""
    }));
    document.getElementById("langBtn")?.click();
    const threeLanguageSynced = threeBefore.every((item, index) =>
      Boolean(
        item.status &&
        item.label &&
        threeAfter[index] &&
        item.status !== threeAfter[index].status &&
        item.label !== threeAfter[index].label
      )
    );
    return {
      before,
      toggled,
      restored: document.documentElement.lang === before,
      flowStatePreserved: JSON.stringify(flowBefore) === JSON.stringify(flowAfter),
      threeLanguageSynced
    };
  })()`);

  const threeAudits = await evaluate(`(() => {
    return [...document.querySelectorAll('[data-iw="three"]')].map(root => {
      const slide = root.closest(".slide");
      const rawOrbit = root.getAttribute("data-network-orbit-range");
      const orbitRange = rawOrbit === null ? null : Number(rawOrbit);
      return {
        slide: [...document.querySelectorAll("#deck .slide")].indexOf(slide) + 1,
        instance: root.getAttribute("data-iw-id"),
        scene: root.getAttribute("data-three-scene"),
        ready: root.getAttribute("data-three-ready"),
        lighting: root.getAttribute("data-three-lighting"),
        motion: root.getAttribute("data-three-motion"),
        controls: root.querySelectorAll(
          "[data-three-toggle], [data-three-reset]"
        ).length,
        orbitRange,
        boundedOrbit: rawOrbit === null
          ? null
          : Number.isFinite(orbitRange) && orbitRange > 0 && orbitRange <= .6
      };
    });
  })()`);

  const codeTraceAudits = await evaluate(`(() => {
    return [...document.querySelectorAll("[data-iw]")].flatMap(root => {
      const code = root.querySelector("[data-algo-code]");
      if (!code) return [];
      const slide = root.closest(".slide");
      window.CW.goto([...document.querySelectorAll("#deck .slide")].indexOf(slide));
      const activeStep = () =>
        code.querySelector("[data-code-step].is-on")?.getAttribute("data-code-step") || "";
      const before = activeStep();
      let after = before;
      for (let i = 0; i < 6 && after === before; i++) {
        root.querySelector('[data-algo-action="next"]')?.click();
        after = activeStep();
      }
      return {
        slide: [...document.querySelectorAll("#deck .slide")].indexOf(slide) + 1,
        instance: root.getAttribute("data-iw-id"),
        before,
        after,
        activeCount: code.querySelectorAll("[data-code-step].is-on").length,
        stateText: root.querySelector("[data-algo-code-state]")?.textContent || ""
      };
    });
  })()`);

  const terminalAudits = await evaluate(`(async () => {
    const pane = document.querySelector("[data-terminal-pane]");
    if (!pane) return [];
    const root = pane.closest("[data-iw]") || pane;
    const slide = pane.closest(".slide");
    window.CW.goto([...document.querySelectorAll("#deck .slide")].indexOf(slide));
    const scroller = pane.querySelector("[data-terminal-scroll]");
    const fixed = pane.querySelector("[data-terminal-fixed]");
    const trigger = root.querySelector("[data-term-run='pwd'], [data-term-run], button");
    for (let i = 0; i < 36 && trigger; i++) trigger.click();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const stage = document.getElementById("stage").getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    const fixedRect = fixed?.getBoundingClientRect();
    const paneStyle = getComputedStyle(pane);
    const scrollStyle = scroller ? getComputedStyle(scroller) : null;
    return [{
      slide: [...document.querySelectorAll("#deck .slide")].indexOf(slide) + 1,
      outputCommands: root.querySelector("[data-term-count]")?.textContent || "",
      paneOverflow: paneStyle.overflow,
      scrollOverflowY: scrollStyle?.overflowY || "none",
      scrollable: Boolean(scroller && scroller.scrollHeight > scroller.clientHeight + 1),
      scrolledToLatest: Boolean(
        scroller &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4
      ),
      fixedVisible: Boolean(fixedRect && fixedRect.width > 0 && fixedRect.height > 0),
      fixedInsidePane: Boolean(
        fixedRect &&
        fixedRect.top >= paneRect.top - 1 &&
        fixedRect.bottom <= paneRect.bottom + 1
      ),
      paneInsideStage: (
        paneRect.left >= stage.left - 2 &&
        paneRect.right <= stage.right + 2 &&
        paneRect.top >= stage.top - 2 &&
        paneRect.bottom <= stage.bottom + 2
      )
    }];
  })()`);

  if (args.shots) {
    const shotDir = resolve(args.shots);
    await mkdir(shotDir, { recursive: true });
    const densest = slideAudits.reduce(
      (best, item) => item.elements > best.elements ? item : best,
      slideAudits[0]
    );
    const captures = [
      ["first", 1],
      ["densest", densest?.index || 1],
      ["last", summary.slides]
    ];
    for (const [name, slideNumber] of captures) {
      await evaluate(`window.CW.goto(${slideNumber - 1})`);
      await new Promise(done => setTimeout(done, 180));
      const shot = await send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false
      });
      await writeFile(`${shotDir}/${name}.png`, Buffer.from(shot.result.data, "base64"));
    }
  }

  socket.close();
  const failures = [];
  if (!summary.slides) failures.push("no slides");
  if (summary.activeSlides !== 1) failures.push("active slide count is not 1");
  if (!summary.hasController) failures.push("CW.goto controller is missing");
  if (summary.duplicateIds.length) failures.push("duplicate IDs");
  if (summary.nestedIws.length) failures.push("nested data-iw roots");
  if (summary.missingTitles.length) failures.push("slides missing bilingual titles");
  if (summary.workflowVersion === "2.0" &&
      summary.styleAudit.coverTitleInside === false) {
    failures.push("cover title extends outside the stage");
  }
  if (!language.restored) failures.push("language toggle did not restore");
  if (!language.flowStatePreserved) {
    failures.push("flow highlight was not preserved after language toggle");
  }
  if (!language.threeLanguageSynced) {
    failures.push("3D status or canvas accessible name did not switch language");
  }
  if (summary.workflowVersion === "2.0" &&
      summary.styleAudit.titleFonts.some(font => !/Noto Serif SC/i.test(font))) {
    failures.push("Workflow V2.0 title font does not use the default serif stack");
  }
  if (summary.workflowVersion === "2.0" &&
      summary.styleAudit.minSpacing !== null &&
      summary.styleAudit.minSpacing < 17.5) {
    failures.push("Workflow V2.0 block spacing is below 18px");
  }
  if (interactionControlAudits.some(item => item.controls < 2)) {
    failures.push("interactive slides must expose at least two active controls");
  }
  if (tableAudits.some(item => item.rows && !item.lastRowVisible)) {
    failures.push("table content is clipped before the final row");
  }
  if (tableAudits.some(item => item.toolbarControls < 2)) {
    failures.push("interactive tables must expose all/current view controls");
  }
  if (tableAudits.some(item => item.rows > 1 && !item.focusModeWorks)) {
    failures.push("interactive table focus control does not update visible rows");
  }
  if (tableFrameAudits.some(item =>
    !item.hasDetail ||
    item.gap > .5 ||
    item.outerBorderWidth <= 0 ||
    item.outerRadius <= 0 ||
    item.detailTopBorderWidth > 0 ||
    item.detailLeftBorderWidth <= 0 ||
    item.detailRadius > .5 ||
    !item.detailShadowNone ||
    !item.detailBackdropNone
  )) {
    failures.push("table interactions must use one outer frame and an internal divider");
  }
  if (threeAudits.some(item =>
    item.scene === "workflow-network" &&
    (
      item.ready !== "true" ||
      item.lighting !== "none" ||
      item.controls < 2 ||
      item.boundedOrbit === false
    )
  )) {
    failures.push("3D workflow network must stay ready, unlit, operable, and bounded");
  }
  if (slideAudits.some(item =>
    item.grid3Audits.some(grid => grid.cards > 1 && grid.spread > 1.5)
  )) {
    failures.push("grid-3 cards do not have equal heights");
  }
  if (flowAudits.some(item =>
    item.initialActive !== 1 ||
    item.activeAfterKeyboard !== 1 ||
    !item.keyboardSynced
  )) {
    failures.push("flow diagram must keep exactly one keyboard-synchronized active node");
  }
  if (flowAudits.some(item =>
    item.singleFill &&
    (item.focusOutline !== "none" || item.activeShapeStroke !== "none")
  )) {
    failures.push("single-fill flow highlight must not use an outline or shape stroke");
  }
  if (flowAudits.some(item => !item.singleFill)) {
    failures.push("interactive SVG diagrams must declare data-flow-highlight=\"single-fill\"");
  }
  if (flowAudits.some(item =>
    item.nativeTitleCount > 0 ||
    !item.accessibleName ||
    !item.nodeStrokesClear
  )) {
    failures.push("interactive SVG nodes must be stroke-free and use aria-label plus desc, not title");
  }
  if (flowAudits.some(item =>
    item.singleFill &&
    (
      item.pointerEvents !== "visiblepainted" ||
      !item.activeNodeWithinBounds ||
      !/^rgb\(239, 255, 84\)$/.test(item.activeShapeFill)
    )
  )) {
    failures.push("single-fill flow nodes must fill only their painted bounds in fluorescent yellow");
  }
  if (svgViewAudits.some(item =>
    item.controls < 2 || !item.focusWorks || !item.restored
  )) {
    failures.push("SVG focus control must update and restore node visibility");
  }
  if (quizHintAudits.some(item => !item.hintWorks || !item.restored)) {
    failures.push("quiz hint control must toggle and restore its explanation");
  }
  if (codeTraceAudits.some(item =>
    item.activeCount !== 1 ||
    !item.before ||
    !item.after ||
    item.before === item.after ||
    /Waiting|等待/.test(item.stateText)
  )) {
    failures.push("algorithm code trace is not synchronized with interaction state");
  }
  if (terminalAudits.some(item =>
    !item.scrollable ||
    !item.scrolledToLatest ||
    !item.fixedVisible ||
    !item.fixedInsidePane ||
    !item.paneInsideStage ||
    !/^(hidden|clip)$/.test(item.paneOverflow) ||
    !/auto|scroll/.test(item.scrollOverflowY)
  )) {
    failures.push("terminal output must scroll inside its pane while the fixed input bar stays visible");
  }
  const overflowSlides = slideAudits.filter(item => item.overflowCount);
  if (slideAudits.some(item =>
    item.interactiveRoots > 0 && item.linkedComponents < 2
  )) {
    failures.push("interactive slides require at least two linked components");
  }
  if (slideAudits.some(item =>
    item.interactiveRoots > 0 && (!item.linkedTypes || !item.linkedState)
  )) {
    failures.push("interactive slides require linked component types and shared state");
  }
  if (overflowSlides.length) failures.push("visible content overflow");
  if (runtimeErrors.length) failures.push("runtime or console errors");

  const result = {
    passed: failures.length === 0,
    target,
    summary,
    interactionControlAudits,
    tableAudits,
    tableFrameAudits,
    threeAudits,
    language,
    flowAudits,
    svgViewAudits,
    quizHintAudits,
    codeTraceAudits,
    terminalAudits,
    overflowSlides,
    runtimeErrors: [...new Set(runtimeErrors)],
    failures,
    screenshots: args.shots ? resolve(args.shots) : null
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
