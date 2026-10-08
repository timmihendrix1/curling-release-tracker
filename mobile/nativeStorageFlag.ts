/**
 * The build-time opt-in for NATIVE STORAGE COMPOSITION (Stage M3b3).
 *
 * This is a FOURTH axis, separate from `--mode`, from `NODE_ENV` and from the
 * storage-diagnostics opt-in in `mobile/storageDiagnosticsFlag.ts`. The two
 * storage flags are deliberately not one flag:
 *
 *   - diagnostics drives a SYNTHETIC database through the adapter and touches no
 *     application data at all;
 *   - this flag decides whether the real application attempts to compose its
 *     storage over the native store.
 *
 * Sharing one switch would mean anyone gathering engine evidence had also opted
 * their real training data into a different store, which is exactly the coupling
 * Stage M3b1's isolation requirement exists to prevent.
 *
 * It is also deliberately NOT a runtime switch. There is no URL parameter, no
 * stored preference and no in-app setting that can enable it.
 *
 * **Enabling it does not perform a cutover, and cannot.** Native composition
 * asks a migration/activation authority for a verdict before it constructs
 * anything, and the production authority reports `unavailable` because the
 * migration does not exist yet (Stage M3b4) and cutover is its own named stage
 * (M3b5). A flag-enabled build therefore shows a blocking preparation state and
 * does NOT mount the application — see `mobile/README.md`. It is not a build for
 * normal training.
 *
 * This is not a member of `MOBILE_INLINED_PUBLIC_ENV_NAMES`: that list is the
 * allow-list of environment-variable VALUES the bundle inlines. Nothing from
 * this variable's value reaches the bundle — the build reads it, decides, and
 * inlines a plain boolean literal under the define name below, which is what
 * lets Rollup eliminate the whole composition chunk from a default build.
 */
export const MOBILE_NATIVE_STORAGE_ENV_NAME = "CURLING_MOBILE_NATIVE_STORAGE";

/** The identifier `mobile/src/MobileApp.tsx` reads inline. Replaced by a literal
 * `true`/`false` at build time. */
export const MOBILE_NATIVE_STORAGE_DEFINE_NAME = "__CURLING_MOBILE_NATIVE_STORAGE__";

/** The one value that enables composition. Anything else — unset, empty, "true",
 * "0", a typo — leaves it off. An opt-in that accepts many spellings is an
 * opt-in that turns on by accident. */
export const MOBILE_NATIVE_STORAGE_ON_VALUE = "1";

export function isNativeStorageCompositionRequested(rawValue: string | undefined): boolean {
  return rawValue === MOBILE_NATIVE_STORAGE_ON_VALUE;
}
