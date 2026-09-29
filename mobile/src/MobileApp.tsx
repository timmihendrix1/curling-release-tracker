import TrackerApp from "../../src/components/TrackerApp";
import IdentityProvider from "../../src/components/identity/IdentityProvider";
import AuthenticatedSportingPersistence from "../../src/components/ProfileScopedSportingPersistence";

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
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-md sm:max-w-xl">
        <IdentityProvider>
          <AuthenticatedSportingPersistence>
            <TrackerApp />
          </AuthenticatedSportingPersistence>
        </IdentityProvider>
      </div>
    </main>
  );
}
