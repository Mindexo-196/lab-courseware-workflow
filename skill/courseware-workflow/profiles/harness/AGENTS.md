# DeepSeek Harness Courseware Workflow

Load `SKILL.md` as the courseware workflow contract and use the project-level
`.agents/skills/courseware-workflow/` directory as the native Skill location.

- The Main Agent completes all normal generation, review, and delivery work.
- Do not delegate unless the user explicitly asks for exactly one isolated subagent.
- Keep one `live.json` as build state and one `memory.json` as compact context handoff.
- Prefer project `CST/` and `Workflow/`; use bundled runtime paths when absent.
- Keep all user-facing choices and approvals in the conversation interface.
- Deliver HTML, Markdown, and JSON only after approval.

This profile intentionally uses the same Skill and runtime as Codex and DSH. Do not copy
standards into a Harness-specific fork.
