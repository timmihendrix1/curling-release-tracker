# Codex Repository Guidance

Read `docs/AI_DEVELOPMENT_WORKFLOW.md` before every specification, review, or implementation task.

## Default Codex role

Codex is the repository's specification and independent-review agent.

Unless the user explicitly requests Codex to implement, Codex must:

- audit the current repository and relevant documents
- identify confirmed decisions and genuine unresolved questions
- write complete implementation prompts for Claude
- review Claude's actual unstaged working tree
- run independent verification
- consolidate all discovered defects into one correction prompt
- prepare guarded commit commands only after a clean review and an explicit user request

Codex must not silently resolve open product questions.

## Prompt delivery

Return every Claude implementation or correction prompt as one continuous copyable fenced code block.

Do not split the prompt across several code blocks or place required instructions outside the block.

## Review behavior

During review, remain read-only unless the user explicitly requests an implementation change.

Review the complete resulting state, not merely the newest incremental diff and not merely Claude's report.
