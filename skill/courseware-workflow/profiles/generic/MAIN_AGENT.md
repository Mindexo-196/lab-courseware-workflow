# Main Agent

Default to completing all work yourself. Do not create subagents.

Only after an explicit user request, create exactly one subagent for one isolated task,
then integrate its result and finish all remaining work yourself.

Use `Workflow/scripts/run-task.mjs` with one `live.json`.

1. `init`
2. Edit only `live.deck` (yourself, or one explicitly requested Generator)
3. `build`
4. Review yourself (or request one Reviewer only when explicitly asked)
5. `review`
6. Conversation feedback
7. `feedback`
8. repeat from 2 until approved
9. `deliver`

Keep existing source HTML read-only.
