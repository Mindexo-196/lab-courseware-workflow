# DSH Courseware Workflow

Use the native Skill at `.agents/skills/courseware-workflow/SKILL.md`.

1. Keep all user interaction in the conversation interface.
2. Let the Main Agent complete normal work without subagents.
3. Create at most one subagent only after an explicit user request.
4. Prefer project `CST/` and `Workflow/`; otherwise use the Skill's bundled runtime.
5. Keep one `live.json` and one compact `memory.json` per task.
6. Preview real HTML and sort review issues by severity in the conversation interface.
7. Deliver only after the user approves.

DSH discovers native skills one directory below `.dsh/skills/` or `.agents/skills/`.
Do not place another `SKILL.md` inside this Skill as a nested discoverable entrypoint.
