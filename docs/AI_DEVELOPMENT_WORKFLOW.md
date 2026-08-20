# AI Development Workflow

## Roles

This repository uses a deliberate separation between product decisions, specification, implementation, review, and commit execution.

- The user owns product priorities, unresolved product decisions, final approval, and commit execution.
- Codex is the default specification and independent-review agent.
- Claude is the default implementation agent.
- Agent reports are navigation aids, not proof, when the repository can be inspected directly.

## Sources of truth

Use this authority order:

1. Explicit product decisions approved by the user and recorded in the repository.
2. Current committed architecture, domain, persistence, cloud, product, UX, design, coaching, and roadmap documents.
3. Accepted ADRs relevant to the task.
4. The approved feature specification.
5. Agent reports only as navigation aids.

When sources conflict, report the conflict before implementation. Do not silently choose an interpretation.

Conversation history is not a durable source of truth. Transfer only confirmed final decisions into the relevant repository document.

## Documentation routing

Read only documents relevant to the task.

Start with the routing guidance already recorded in `CLAUDE.md` and with:

- `docs/SYSTEM_ARCHITECTURE.md`
- `docs/DOMAIN_GLOSSARY.md`
- `docs/PERSISTENCE_BOUNDARY_DESIGN.md`
- `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md`
- `docs/TECHNICAL_DEBT_AND_ROADMAP.md`
- `docs/adr/README.md`

Read a complete ADR only when the task touches the decision it governs. Do not load every ADR by default.

The more detailed project-specific document list and implementation guidance in `CLAUDE.md` remain authoritative for Claude and are not replaced by this file.

## Feature lifecycle

Each feature follows this sequence:

1. The user identifies the desired outcome.
2. Codex audits the repository and relevant documents.
3. Codex separates confirmed decisions from unresolved product questions.
4. The user resolves questions that materially affect the feature.
5. Codex writes one complete, copyable English implementation prompt for Claude.
6. Claude implements the approved prompt in the agreed local checkout and branch.
7. Claude runs verification and leaves all changes unstaged and uncommitted.
8. Codex independently reviews the complete resulting working tree.
9. If defects remain, Codex writes one consolidated correction prompt.
10. Claude applies the corrections and again leaves everything unstaged.
11. Codex performs the final review.
12. After a clean review, Codex may prepare a guarded commit command.
13. The user executes the commit.

Perform a broad adversarial review before producing a correction prompt. Do not create a separate prompt for every minor observation.

## Working-tree ownership

- Claude and Codex must not modify the same checkout concurrently.
- Claude completes and stops before Codex begins a review.
- During review, Codex is read-only unless the user explicitly requests an implementation change.
- Codex reviews the actual working tree and files, not only Claude's report.
- Do not use a Codex-managed worktree to review unstaged changes created by Claude in the primary local checkout.
- Archive repositories and secondary clones are not write targets.

## Git safety

Before every task, report:

- current branch
- HEAD
- local main
- origin/main
- staged files
- unstaged files
- untracked files

Preserve existing user changes.

Do not stage, commit, amend, merge, rebase, push, delete branches, or open a pull request unless the user explicitly requests that exact action.

Do not create patch files unless explicitly requested.

## Environment files and secrets

- Never directly inspect, print, quote, summarize, copy, or modify `.env.local`.
- Never expose environment-variable values in commands, logs, tests, fixtures, diffs, documentation, reports, screenshots, or chat output.
- Never stage or commit `.env.local` or another non-example environment file.
- Use `.env.example` as the public configuration contract.
- Do not add `.env.local` to `.worktreeinclude`.
- Normal application commands may load `.env.local` internally, but their output must not reveal its values.
- Never run `env`, `printenv`, or an equivalent environment dump.
- A `NEXT_PUBLIC_` Supabase publishable key may be browser-visible but must not be copied into source code, tests, fixtures, reports, or committed documentation.
- Never place a Supabase secret key or service-role key in a `NEXT_PUBLIC_` variable or browser-reachable code.

## Specification standard

A Claude implementation prompt must be delivered as one continuous, copyable fenced code block and include:

1. Role and desired outcome.
2. Exact repository and branch.
3. Expected starting Git state.
4. Preflight checks and stop conditions.
5. Governing documents.
6. Confirmed product decisions.
7. Explicit non-goals.
8. Allowed files or scope boundaries.
9. Functional requirements.
10. Authority, ownership, security, and failure invariants where relevant.
11. Required tests.
12. Repository-wide contradiction and stale-reference review.
13. Verification commands.
14. Git restrictions.
15. Required final report.

The prompt must instruct Claude to audit before editing and to stop when a required product decision is genuinely unresolved.

Do not hide product decisions inside implementation details.

## Codex review standard

When reviewing Claude's work, Codex must:

1. Re-read the approved specification.
2. Inspect the complete working tree.
3. Inspect every changed and untracked file.
4. Compare implementation, tests, documentation, and architecture claims.
5. Verify negative cases and failure behavior.
6. Check authorization, ownership, authority, persistence, concurrency, interruption, stale state, malformed input, and retry behavior where relevant.
7. Search for stale terminology and contradictory claims.
8. Run focused tests.
9. Run the full required verification suite.
10. Distinguish proven behavior from assumptions.
11. Produce one consolidated correction prompt if defects remain.
12. Avoid editing during review unless the user explicitly requests it.

Do not accept Claude's final report as proof. Verify every material claim directly.

## Documentation discipline

- Update existing documents when their claims become outdated.
- Create a new ADR only for a durable architecture decision with meaningful alternatives and consequences.
- Use a concise product decision document or permission matrix for product rules.
- Do not create oversized ADRs merely to record implementation detail.
- Keep one canonical statement for each invariant and reference it elsewhere.
- Clearly distinguish blockers, prerequisites, deferred enhancements, assumptions, and accepted residual risks.
- Claude may document only approved product decisions and implementation consequences within the approved scope.
- Claude must not independently settle unresolved product decisions.

## Verification baseline

Use the repository's actual package scripts.

At minimum, before completing an implementation or final review, run:

- `git diff --check`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npm run build`

Run the full Playwright suite when behavior is user-visible or affects startup, navigation, persistence, authentication, authorization, or core interaction flows.

Report exact test-file and test-count results.

Documentation-only workflow changes do not require the full application test suite unless they alter executable configuration.

## Completion report

Every implementation or review report must include:

1. Starting and final Git state.
2. Files changed.
3. Requirements implemented or reviewed.
4. Defects found and how they were resolved.
5. Tests added or changed.
6. Exact verification results.
7. Remaining blockers, assumptions, and deferred work.
8. Confirmation that no unauthorized Git mutation occurred.
