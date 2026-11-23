# Courseware Workflow Skill

`courseware-workflow` is a portable Agent Skill for producing bilingual,
interactive Lab HTML courseware. The Main Agent performs generation, review,
revision, verification, and delivery. A subagent is used only when explicitly
requested and is limited to one isolated task.

## Capabilities

- Generate single-file interactive HTML from structured course content.
- Preserve an existing HTML source and edit only a task working copy.
- Keep one `live.json` build state and one lightweight `memory.json` recovery
  summary per task.
- Present a real preview before requesting feedback.
- Deliver HTML, Markdown, and JSON as one approved package.
- Provide standards for charts, diagrams, neural networks, terminals, and linked
  experiments.

## Bundled Standards

Only the three runtime standards are bundled:

```text
assets/workflow-runtime/CST/
├── CONTENT.md
├── SKILL.md
└── TEMPLATE.html
```

The runtime prefers a target project's `CST/` directory. When no project standards
exist, it falls back to the bundled trio.

## Installation

Node.js 20 or newer is required. Chrome or Chromium is recommended for browser
validation.

```bash
node scripts/install.mjs --target /path/to/project --profile codex
node scripts/install.mjs --target /path/to/project --profile dsh
node scripts/install.mjs --target /path/to/project --profile harness
node scripts/install.mjs --target /path/to/project --profile claude
```

The `codex`, `dsh`, and `harness` profiles install a native Skill under
`.agents/skills/courseware-workflow/`. Codex can also use the generated marketplace
plugin archive.

## Usage

```text
Use $courseware-workflow to create an 18-slide bilingual Lab HTML deck for
"Linux File Systems". The audience is first-year computer science students.
```

The user reviews the generated preview and provides natural-language revision or
approval in the active conversation interface. No manual JSON editing is required.

## Verification

```bash
node scripts/verify-package.mjs
```

The source repository keeps one editable Skill. Packaging creates the plugin's
nested Skill copy and writes archives, checksums, and version metadata to
`dist/v<version>/`.

## Compatibility

- Codex Skill and Codex marketplace plugin.
- DSH native Skill discovery.
- DeepSeek Harness project-level Agent workflow.
- Claude-style project instructions.
- Markdown-based generic Agents.

## License

MIT License, Copyright (c) 2026 Courseware Workflow Contributors.

Third-party teaching material, images, fonts, and runtime libraries remain subject
to their own licenses.
