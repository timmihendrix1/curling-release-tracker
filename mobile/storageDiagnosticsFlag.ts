/**
 * The build-time opt-in for the native storage diagnostics panel.
 *
 * This is a SEPARATE axis from both `--mode` and `NODE_ENV`, and it must stay
 * that way (see the long note in `mobile/vite.config.ts`). Turning diagnostics on
 * must never turn production React semantics, the `IS_DEV` developer surfaces or
 * the `NODE_ENV === "test"` Profile-scope fallback back on: a diagnostics build
 * is still a production artifact in every other respect, because it is still
 * installable.
 *
 * It is also deliberately NOT a runtime switch. There is no URL parameter, no
 * stored preference and no in-app setting that can enable the panel, because the
 * panel opens a database connection of its own and must not be reachable in an
 * ordinary installed build.
 *
 * This is not a member of `MOBILE_INLINED_PUBLIC_ENV_NAMES`: that list is the
 * allow-list of environment-variable VALUES the bundle inlines. Nothing from this
 * variable's value reaches the bundle — the build reads it, decides, and inlines
 * a plain boolean literal under the define name below.
 */
export const MOBILE_STORAGE_DIAGNOSTICS_ENV_NAME = "CURLING_MOBILE_STORAGE_DIAGNOSTICS";

/** The identifier `mobile/src/diagnostics/storageDiagnosticsEnabled.ts` reads.
 * Replaced by a literal `true`/`false` at build time, so a default build folds
 * the panel's conditional import away entirely rather than shipping dead code. */
export const MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME =
  "__CURLING_MOBILE_STORAGE_DIAGNOSTICS__";

/** The one value that enables diagnostics. Anything else — unset, empty,
 * "true", "0", a typo — leaves them off. An opt-in that accepts many spellings
 * is an opt-in that turns on by accident. */
export const MOBILE_STORAGE_DIAGNOSTICS_ON_VALUE = "1";

export function isStorageDiagnosticsRequested(rawValue: string | undefined): boolean {
  return rawValue === MOBILE_STORAGE_DIAGNOSTICS_ON_VALUE;
}
