---
name: courseware-workflow
description: Create, revise, review, and deliver Lab HTML courseware with one live JSON and direct CST references. Main-agent-first; use a subagent only when the user explicitly requests exactly one.
metadata:
  version: "1.0.1"
  compatibility: "Codex, DSH Skill, DeepSeek Harness, Claude/Generic Markdown Agents"
  whenToUse: "当用户要求制作、修改、审查或交付 Lab HTML 课件，或要求恢复、检查本课件工作流时使用。"
---

# Courseware Workflow

User-facing interaction happens in the active conversation interface. The Main Agent
runs commands and updates files.

## Agent Policy

- Default: the Main Agent performs generation, review, fixes, verification, and delivery.
- Do not spawn subagents automatically.
- Only when the user explicitly requests a subagent, spawn exactly one.
- That subagent handles one isolated task; the Main Agent integrates its result and
  performs all remaining work.
- Never start a Generator/Reviewer pair or multiple parallel auditors.

## Core Model

Read only these standards:

```text
CST/CONTENT.md
CST/SKILL.md
CST/TEMPLATE.html
```

Prefer the target project's `CST/`. For a portable Skill installation without a
project-level `CST/`, use the same three bundled files under
`assets/workflow-runtime/CST/`. Never maintain a second editable copy of these standards.

For an architecture, neural-network, flow, module, or topology diagram, read
[references/diagram-design.md](references/diagram-design.md) before choosing its chart type.
The guide distinguishes explanatory, debugging, and publication diagrams and defines
module granularity, dimension labels, edge semantics, 2D/3D choice, interaction, and QA.
It also routes neural-network architectures through a dedicated branch and provides the
four-part prompt pattern: subject, ordered modules, labels/tensor dimensions, style/direction.
Every interactive slide must declare `linked_components` with at least two entries and one
shared `linked_state`. `chart` is a standard composed interaction family using controls,
graphics, readouts, and explanation under the same state.

When the user explicitly selects a 3D relationship network, use the offline
`workflow-network` scene rather than a decorative perspective layout. File nodes may carry
labels, while process nodes may be unlabeled when a nearby route strip preserves the order.
The scene must use `MeshBasicMaterial` flat colors and no scene lights; directed links,
drag rotation, wheel zoom, keyboard alternatives, reset, pausable auto-orbit, and reduced
motion handling are required. Keep node labels inside the canvas safe area across rotation
and verify both language modes.

## Visual Regression Guardrails

Apply these rules when revising existing decks:

- For a layered 3D network, keep file and layer labels in a fixed HTML rail outside the
  moving canvas. Use `data-network-orbit-range` for bounded auto-orbit so side views do not
  collapse the columns into one unreadable line. Language changes must update both the
  status text and the canvas `aria-label`.
- A table interaction has one outer `.ix-table-wrap` shell. `.table-scroll` and
  `.ix-detail` are internal regions with `gap:0`; the detail region must not add its own
  border, radius, backdrop-filter, or shadow.
- Keep Lab control geometry stable across pages. Semantic table colors are opt-in and use
  existing Lab roles with low-opacity tints; they do not justify changing shared button
  radius or weight on only one page.

`check-browser.mjs` must audit the table shell geometry and 3D language/orbit metadata.
If Chromium cannot start because of `EPERM`, or the browser blocks `file://`, treat those
as execution-environment constraints: use an approved child-process execution path or a
local HTTP preview instead of changing the courseware template.

Keep one task state file:

```text
Workflow/runs/<task-id>/live.json
```

`live.json` contains the brief, CST hashes, deck content, preview checks, review issues,
human feedback, usage, and delivery state. Do not create parallel state, review, human,
preview, rewrite, or usage JSON files.

Keep one context-memory file:

```text
Workflow/runs/<task-id>/memory.json
```

It is the preferred context handoff when conversation history may be compacted. It stores only
the current request, compact history, page manifest, content reference/hash, and usage.
It must never contain `body_html`, `left_html`, `right_html`, or `visual_html`.
It refreshes automatically after init, build, review, feedback, deliver, and usage.
The current model context is 1,048,576 tokens (95% effective = 996,147). Budgets are
derived dynamically:

- recommended memory: 50% of effective context;
- hard limit: 125% of nominal context.

`resume` reports context tokens, memory bytes, average page bytes, and estimated tokens.

Context loading order:

1. Run `resume` to validate and, if needed, refresh `memory.json`.
2. Read `CST/` only when design or validation rules are needed.
3. For a specific page, use the `page` action to load only that slide.
4. Keep `memory.json` below the context-derived recommended budget.
5. Do not load the full `live.json` into model context unless a build/debug action
   explicitly requires it.

## Actions

1. `init`: wrap a new or existing content JSON into `live.json`. If an existing HTML is
   supplied, keep it read-only and copy it to `working/`.
2. `build`: build `preview.html`, then run static and browser checks once. Write results
   into `live.preview`.
3. `review`: the Main Agent reviews the preview and writes a review patch. If the user
   explicitly requested one subagent, that subagent may produce the single patch.
   Merge it into `live.review`.
4. `feedback`: show the preview and severity-sorted issues in the conversation
   interface. Apply natural
   language edits to `live.deck`; use `revise`, `approve`, or `abort`.
5. `deliver`: promote the checked preview to the delivery folder and write Markdown,
   final JSON, and HTML.
6. `memory`: force-refresh the lightweight context handoff from `live.json`.
7. `page`: print one page's structured content only.
8. `resume`: validate memory against live/CST hashes and print one compact recovery summary.

```text
init → build → review → feedback/revise → build → ... → approve → deliver
```

There is no second final Reviewer and no duplicate final browser pass.

## Commands

```text
node Workflow/scripts/run-task.mjs init --live <live.json> --content <source.json>
node Workflow/scripts/run-task.mjs build --live <live.json>
node Workflow/scripts/run-task.mjs review --live <live.json> --input <review-patch.json>
node Workflow/scripts/run-task.mjs feedback --live <live.json> --decision <revise|approve|abort>
node Workflow/scripts/run-task.mjs deliver --live <live.json>
node Workflow/scripts/run-task.mjs memory --live <live.json>
node Workflow/scripts/run-task.mjs page --live <live.json> --page <n>
node Workflow/scripts/run-task.mjs resume --live <live.json>
```

For a portable installation that has no project-level `Workflow/`, run the equivalent
script from the Skill's `assets/workflow-runtime/scripts/` directory and place task state
under that runtime's `runs/`.

## Reviewer Patch

The Reviewer reads `live.json`, `preview.html`, and any existing original/work-copy pair.
It returns at most eight issues sorted `critical → high → medium → low`:

```json
{
  "schema": "workflow/review-patch/v2",
  "artifact_sha256": "<from live.preview.artifact_sha256>",
  "summary": "short summary",
  "issues": [
    {
      "id": "R-1",
      "severity": "high",
      "area": "visual",
      "slide_id": "s3",
      "message": "visible problem",
      "suggestion": "concrete correction"
    }
  ]
}
```

Focus on page appearance, interaction clarity, content continuity, bilingual mismatches,
and clear factual errors. Do not block on URL reachability or low-value formatting.

## Delivery

```text
courseware/<english-slug>/
├── content_<english-slug>.md
├── content_<english-slug>.json
└── <english-slug>.html
```

The final JSON is a snapshot of `live.json`. The original source HTML is never modified.

## Package Lifecycle

The source repository keeps one editable Skill under `skill/courseware-workflow/`.
The plugin's nested Skill directory is generated by `scripts/release.mjs`; do not
maintain it as a second source copy. Published ZIPs, checksums, and release metadata
belong under the repository's versioned `dist/v<version>/` directory.
