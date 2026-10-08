import { lazy, Suspense } from "react";
import TrackerApp from "../../src/components/TrackerApp";
import IdentityProvider from "../../src/components/identity/IdentityProvider";
import AuthenticatedSportingPersistence from "../../src/components/ProfileScopedSportingPersistence";

/**
 * The opt-in native storage diagnostics surface (Stage M3b engine evidence).
 *
 * `__CURLING_MOBILE_STORAGE_DIAGNOSTICS__` is a build-time literal. Its name is
 * owned by `mobile/storageDiagnosticsFlag.ts`; `mobile/vite.config.ts` replaces
 * it with the build's verdict and `mobile/vitest.config.ts` replaces it with
 * `false`, so nothing ever evaluates an undeclared identifier. `declare const`
 * is type-only and erases, so nothing shadows it at runtime.
 *
 * It is read HERE, inline, rather than through a shared boolean export, and
 * that is deliberate: the bundler folds a literal in this expression and then
 * drops the dynamic import entirely, so a default build contains no diagnostics
 * chunk, no synthetic database name and no SQLite plugin at all. Reading it
 * through another module left the constant unpropagated and the chunk emitted —
 * inert, but shipped. `mobile/__tests__/bundle.test.ts` asserts the difference
 * against the real artifact.
 *
 * There is deliberately no runtime switch: no URL parameter and no stored
 * preference can reach this.
 *
 * The panel is a sibling of the gated provider tree and renders `null` when
 * disabled, which is why the element tree this component returns is still
 * identical to the Web root's in a default build
 * (`mobile/__tests__/entryComposition.test.tsx`).
 */
declare const __CURLING_MOBILE_STORAGE_DIAGNOSTICS__: boolean;

const StorageDiagnostics = __CURLING_MOBILE_STORAGE_DIAGNOSTICS__
  ? lazy(() => import("./diagnostics/NativeStorageDiagnosticsLauncher"))
  : null;

/**
 * The opt-in native STORAGE COMPOSITION (Stage M3b3), a separate axis from the
 * diagnostics panel above and from `NODE_ENV`. Its name is owned by
 * `mobile/nativeStorageFlag.ts`; `mobile/vite.config.ts` replaces it with the
 * build's verdict and `mobile/vitest.config.ts` replaces it with `false`.
 *
 * Read HERE, inline, for the same reason the diagnostics literal is: the
 * bundler folds it in this expression and then drops the dynamic import
 * entirely, so a default build contains no composition code, no SQLite plugin,
 * no secure-storage plugin and no application database name. Reading it through
 * another module left the constant unpropagated and the chunk emitted — inert,
 * but shipped.
 *
 * **A flag-enabled build does not cut over, and cannot.** The composition asks a
 * migration/activation authority for a verdict before constructing anything, and
 * the production authority is unavailable in this stage — so the build shows a
 * blocking preparation state instead of mounting the application against an
 * empty store. See `mobile/README.md`: it is not a build for normal training.
 *
 * There is deliberately no runtime switch: no URL parameter and no stored
 * preference can reach this.
 */
declare const __CURLING_MOBILE_NATIVE_STORAGE__: boolean;

const NativeStorageComposition = __CURLING_MOBILE_NATIVE_STORAGE__
  ? lazy(() => import("./storage/NativeStorageCompositionRoot"))
  : null;

/**
 * The mobile client's root component.
 *
 * This is the **same real application** the Web build renders: it composes the
 * identical provider tree and container markup as `src/app/page.tsx`
 * (IdentityProvider → AuthenticatedSportingPersistence → TrackerApp), importing
 * the shared modules directly rather than copying them (ADR-free: see
 * docs/MOBILE_APP_MIGRATION.md §3.1 Candidate A, and §3.2 — the application is
 * never copied into a per-platform codebase).
 *
 * Nothing here bypasses the identity gate, substitutes a Profile, or mounts a
 * demonstration surface. `IdentityProvider` renders `IdentityGateScreen` instead
 * of its children until a session exists, so the sporting workspace is
 * unreachable on mobile for exactly the same reason it is on the Web.
 *
 * The container markup below is duplicated from `src/app/page.tsx` because
 * Next's `layout.tsx`/`page.tsx` pair is not available to a Vite entry. That
 * duplication is the one accepted cost of Candidate A.
 * `mobile/__tests__/entryComposition.test.tsx` compares the returned element
 * trees and component identities. Its rendered tests separately verify
 * identity-gate behavior.
 */
export default function MobileApp() {
  const shell = (
    <IdentityProvider>
      <AuthenticatedSportingPersistence>
        <TrackerApp />
      </AuthenticatedSportingPersistence>
    </IdentityProvider>
  );

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-md sm:max-w-xl">
        {/* A default build folds this to `shell`, so the element tree stays
            IDENTICAL to the Web root's — which is what
            `mobile/__tests__/entryComposition.test.tsx` compares. When the flag
            is on, the composition wraps the provider tree rather than sitting
            beside it: until storage is ready its children do not exist, so
            nothing hydrates, restores a session, starts the sync manager or
            retires anything. */}
        {NativeStorageComposition === null ? (
          shell
        ) : (
          <Suspense fallback={null}>
            <NativeStorageComposition>{shell}</NativeStorageComposition>
          </Suspense>
        )}
      </div>
      {StorageDiagnostics === null ? null : (
        <Suspense fallback={null}>
          <StorageDiagnostics />
        </Suspense>
      )}
    </main>
  );
}
