# Courseware Workflow

A portable Agent Skill for producing bilingual, interactive Lab HTML courseware
from structured content. The same source can be packaged as a native Skill or a
Codex marketplace plugin.

## Features

- One `live.json` source of truth per courseware task.
- One lightweight `memory.json` context summary for long-running work.
- Direct CST references with project-first and bundled-runtime fallback.
- Static, browser, and single-pass review workflows.
- At least two linked components per interactive screen.
- HTML, Markdown, and JSON delivery in one approved package.
- Main-Agent-first operation with at most one explicitly requested subagent.

## Requirements

- Node.js 20 or newer.
- Chrome or Chromium for browser validation.
- `zip` and `unzip` for release archive verification.

## Repository Layout

```text
.
├── skill/courseware-workflow/  # canonical editable Skill
├── packaging/                  # plugin template and release notes
├── scripts/                    # release, testing, and privacy checks
├── dist/README.md              # generated output location
├── .github/workflows/ci.yml    # GitHub Actions verification
├── README.md
├── LICENSE
└── CHANGELOG.md
```

The plugin's nested `skills/courseware-workflow/` directory is generated during
packaging. Do not maintain a second editable copy.

## Install

Install the native Skill and runtime into a project:

```bash
node skill/courseware-workflow/scripts/install.mjs \
  --target /path/to/project --profile codex
```

Available profiles:

```text
codex, dsh, harness, generic, claude, all
```

The installer refuses to overwrite existing workflow or Skill directories unless
`--force` is specified.

## Validate

Refresh the derived manifest after source changes:

```bash
npm run release:manifest
```

Run the public-repository privacy scan:

```bash
npm run privacy:check
```

Run the complete temporary build verification:

```bash
npm test
```

The verification builds both archives in a temporary directory, checks their
structure and SHA-256 values, installs the Skill for Codex, DSH, and Harness, and
runs the installed workflow regression suite.

## Release

Create a versioned directory under `dist/`:

```bash
npm run release:publish
```

Generated archives are intentionally ignored by Git. Upload the files from
`dist/v<version>/` as a GitHub Release instead of committing binary artifacts.

## Publish to GitHub

From a normal local checkout:

```bash
git init
git add .
git commit -m "Initial public release"
git branch -M main
git remote add origin https://github.com/OWNER/REPOSITORY.git
git push -u origin main
```

Replace `OWNER/REPOSITORY` with the destination repository. The committed tree
contains source and documentation only; release archives remain under ignored
`dist/v<version>/` and should be attached to a GitHub Release.

## Compatibility

- Codex Skill and Codex marketplace plugin.
- DSH native Skill discovery.
- DeepSeek Harness project-level Agent workflows.
- Claude-style project instructions.
- Generic Markdown Agent profiles.

## Privacy and Security

The repository contains no telemetry, personal account data, conversation
transcripts, local absolute paths, or bundled credentials. See
[PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

MIT License, Copyright (c) 2026 Courseware Workflow Contributors. Third-party
content and generated-courseware assets remain subject to their own licenses.
