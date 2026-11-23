# Repository Agent Instructions

## Agent Usage

All normal work is completed by the Main Agent.

- Do not spawn subagents by default.
- Spawn exactly one subagent only when the user explicitly requests a subagent.
- Use that single subagent only for the requested isolated task.
- The Main Agent performs all remaining generation, review, integration, verification,
  conversation interaction, and delivery.
- Never create a Generator/Reviewer pair or parallel audit agents automatically.

## Courseware

When the user creates, modifies, reviews, or delivers courseware:

- Read `Workflow/workflow.md` and use the `courseware-workflow` skill.
- Keep all interaction in the conversation interface. Run scripts and edit files
  yourself.
- Read the three core standards directly from `CST/`.
- Keep one state source: `Workflow/runs/<task-id>/live.json`.
- Keep the compact handoff at `Workflow/runs/<task-id>/memory.json`; it must not contain
  HTML source or replace the build state. It is refreshed automatically after each state
  action.
- Run `resume` first; load a specific page with the `page` action instead of
  injecting full `live.json` into context.
- Keep `memory.json` within the context-derived recommended budget; the hard limit is
  125% of the current nominal context capacity.
- Keep existing source HTML read-only; modify only the run-directory working copy.

## Optional Subagent

`courseware_generator` and `courseware_reviewer` are available only after an explicit
user request. Choose the one matching the isolated task; do not run both.

Without such a request, the Main Agent performs generation and review itself and
continues through delivery.

## Loop

```text
init → build → one basic review → conversation feedback
          ↑                         │
          └──── revise deck ────────┘
                                    │ approve
                                    ↓
                                  deliver
```

Present `preview.html` first, followed by issues sorted by severity. Accept natural
language edits and continue until the user is satisfied.

## Completion

Only deliver after:

- CST files and hashes match `live.cst`;
- build succeeded and preview checks are recorded;
- the current review issues are recorded in `live.review`;
- the user approved in the conversation interface;
- delivery contains HTML, Markdown, and JSON.
- old Skill packages were removed after the new version and checksum succeeded.
