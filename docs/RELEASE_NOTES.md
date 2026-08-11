# Release Notes

## Current release: local-first alpha

**Status:** Local-first alpha — no account, cloud sync, team, coaching, exercise, or
training-plan functionality exists yet. The app works fully offline, with training,
assessment, and analytics data stored only in the browser (see
`docs/SYSTEM_ARCHITECTURE.md`'s "Current Implementation Snapshot" and `docs/adr/` for what
is actually implemented). `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` and
`docs/TECHNICAL_DEBT_AND_ROADMAP.md` describe the target direction — none of it is built.

**Release tag:** `v0.1.0-local-first-alpha` — the accepted migration baseline before any
persistence-boundary or cloud work begins (`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md`
Phase 0).

**Production URL:** https://curling-release-tracker.vercel.app/

**Production branch:** `main`. Confirmed: GitHub's configured default branch (`origin/HEAD`)
is `main`. Not independently confirmed from this environment: Vercel's configured
"Production Branch" setting for the linked project (no Vercel CLI session or dashboard
access was available at release-preparation time) — treat as unverified until checked in
the Vercel dashboard.

**Deployment mechanism:** Vercel, via its GitHub integration on the
`timmihendrix1/curling-release-tracker` repository (a `.vercel/` project-link directory
exists locally, pointing at project `curling-release-tracker`). No `vercel.json` and no
CI workflow are committed to this repository — build/deploy configuration lives entirely
in the Vercel project settings, not in-repo.

## Verification commands

Run before any release:

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
npm run test:e2e
```

## Rollback reference

Vercel keeps every previous deployment. To roll back:

1. Open the `curling-release-tracker` project's Deployments list in the Vercel dashboard.
2. Find the deployment built from the desired previous commit or tag (e.g.
   `v0.1.0-local-first-alpha`).
3. Promote it to Production ("Redeploy" / "Promote to Production").

No database or persisted-data migration is involved in a rollback — all application data
lives in the end user's own browser `localStorage`, not on the server (see §5 of the prior
Phase 0 audit).
