// In-memory reference implementation of `IdentityService` — the injected stand-in
// for the Stage B0.2a RPCs in unit and integration tests.
//
// **This is not a shortcut.** Per CLAUDE.md's Timing Simulator precedent
// (ADR-0006) and the `fakeTeamService.ts` convention, a test stand-in must
// implement the real contract rather than feed a parallel code path. So this fake
// performs the SAME state transitions and the SAME checks the Postgres functions
// perform, in the same order:
//
//  - `ensureProfile` creates a **bare** Profile and nothing else, and is
//    idempotent — a second call returns the same Profile id;
//  - `resolveGateFacts` DERIVES every field on read and stores no eligibility
//    flag;
//  - `completeOnboarding` is **completion-first and write-once**: it checks for an
//    existing completion BEFORE validating any legal document or touching any
//    Profile fact, and returns the existing state with zero writes if one exists;
//    otherwise it validates the display name, re-derives the server-current
//    documents, compares the supplied ids, and establishes all five consequences
//    together;
//  - the legal snapshot goes through the REAL `parseLegalDocumentsResponse`, from
//    raw row shapes, so whole-response validation is exercised rather than
//    bypassed.
//
// It also records every call and every write, so a test can assert "a retry
// against an already-completed Profile performed no additional writes" as a
// measured fact.

import { identityFailed, identityOk, type IdentityErrorKind, type IdentityResult } from "./errors";
import type {
  BareProfile,
  GateFacts,
  IdentityService,
  PinnedLegalEvidence,
} from "./identityService";
import {
  parseLegalDocumentsResponse,
  type CompleteOnboardingInput,
  type LegalSnapshot,
} from "./legalSnapshot";
import { MAX_DISPLAY_NAME_LENGTH } from "./untrustedValue";

export type FakeIdentityMethod =
  | "getLegalSnapshot"
  | "ensureProfile"
  | "resolveGateFacts"
  | "completeOnboarding";

/** One row exactly as `get_current_legal_documents()` returns it. Deliberately the
 * raw snake-case shape, so the fake exercises the real mapper. */
export type FakeLegalRow = {
  id: string;
  kind: string;
  version_label: string;
  document_url: string;
  effective_at: string;
};

export type FakeAccountState = {
  profileId: string | null;
  displayName: string | null;
  onboardingCompletedAt: string | null;
  hasAthleteCapability: boolean;
  freeEntitlementActive: boolean;
  pinnedTerms: PinnedLegalEvidence | null;
  pinnedPrivacy: PinnedLegalEvidence | null;
};

export type FakeIdentityBackend = {
  /** The rows `get_current_legal_documents()` would return. Any value is
   * accepted — including a deliberately malformed one — because the real mapper
   * is what judges it. */
  legalRows: unknown;
  /** When set, the legal RPC itself fails instead of returning rows. */
  legalRpcFailure: IdentityErrorKind | null;
  /** Which account the (simulated) session belongs to. `null` means no
   * authenticated caller, which the RPCs answer with `forbidden`. */
  currentAccountScopeId: string | null;
  accounts: Map<string, FakeAccountState>;
  /** Programmed failures, consumed once per entry, per method. */
  failures: Map<FakeIdentityMethod, IdentityErrorKind[]>;
  /** Every call, in order. */
  calls: FakeIdentityMethod[];
  /** Every mutation the fake actually performed, in order. A completion retry
   * must add nothing here. */
  writes: string[];
  /** Deterministic id source for created Profiles and acceptance rows. */
  nextId: () => string;
  /** Deterministic clock. */
  now: () => string;
};

export function createFakeIdentityBackend(
  overrides: Partial<FakeIdentityBackend> = {}
): FakeIdentityBackend {
  let idCounter = 0;
  let clockCounter = 0;
  return {
    legalRows: [],
    legalRpcFailure: null,
    currentAccountScopeId: null,
    accounts: new Map<string, FakeAccountState>(),
    failures: new Map<FakeIdentityMethod, IdentityErrorKind[]>(),
    calls: [],
    writes: [],
    nextId: () => {
      idCounter += 1;
      // A canonical, deterministic UUID: the validators require the canonical
      // shape, so a fake id has to be a real one rather than "fake-1".
      const suffix = idCounter.toString(16).padStart(12, "0");
      return `00000000-0000-4000-8000-${suffix}`;
    },
    now: () => {
      clockCounter += 1;
      return new Date(Date.UTC(2026, 0, 1, 0, 0, clockCounter)).toISOString();
    },
    ...overrides,
  };
}

/** Programs the next call to `method` to fail with `kind`. */
export function programIdentityFailure(
  backend: FakeIdentityBackend,
  method: FakeIdentityMethod,
  kind: IdentityErrorKind
): void {
  const queued = backend.failures.get(method) ?? [];
  queued.push(kind);
  backend.failures.set(method, queued);
}

function takeProgrammedFailure(
  backend: FakeIdentityBackend,
  method: FakeIdentityMethod
): IdentityErrorKind | null {
  const queued = backend.failures.get(method);
  if (queued === undefined || queued.length === 0) return null;
  return queued.shift() ?? null;
}

function accountState(backend: FakeIdentityBackend, accountScopeId: string): FakeAccountState {
  const existing = backend.accounts.get(accountScopeId);
  if (existing !== undefined) return existing;
  const fresh: FakeAccountState = {
    profileId: null,
    displayName: null,
    onboardingCompletedAt: null,
    hasAthleteCapability: false,
    freeEntitlementActive: false,
    pinnedTerms: null,
    pinnedPrivacy: null,
  };
  backend.accounts.set(accountScopeId, fresh);
  return fresh;
}

/** The server-current documents, derived from the same rows the snapshot RPC
 * returns — never from a separate store that could drift. */
function currentDocuments(
  backend: FakeIdentityBackend
): { terms: FakeLegalRow | null; privacy: FakeLegalRow | null } {
  const rows = Array.isArray(backend.legalRows) ? (backend.legalRows as FakeLegalRow[]) : [];
  return {
    terms: rows.find((row) => row?.kind === "terms_of_service") ?? null,
    privacy: rows.find((row) => row?.kind === "privacy_notice") ?? null,
  };
}

function deriveGateFacts(backend: FakeIdentityBackend, state: FakeAccountState): GateFacts {
  const current = currentDocuments(backend);
  return {
    profileId: state.profileId,
    displayName: state.displayName,
    onboardingCompletedAt: state.onboardingCompletedAt,
    hasAthleteCapability: state.hasAthleteCapability,
    freeEntitlementActive: state.freeEntitlementActive,
    pinnedTerms: state.pinnedTerms,
    pinnedPrivacy: state.pinnedPrivacy,
    currentTermsDocumentId: current.terms?.id ?? null,
    currentTermsVersionLabel: current.terms?.version_label ?? null,
    currentPrivacyDocumentId: current.privacy?.id ?? null,
    currentPrivacyVersionLabel: current.privacy?.version_label ?? null,
  };
}

export function createFakeIdentityService(backend: FakeIdentityBackend): IdentityService {
  return {
    async getLegalSnapshot(): Promise<IdentityResult<LegalSnapshot>> {
      backend.calls.push("getLegalSnapshot");
      const programmed = takeProgrammedFailure(backend, "getLegalSnapshot");
      if (programmed !== null) return identityFailed<LegalSnapshot>(programmed);
      if (backend.legalRpcFailure !== null) {
        return identityFailed<LegalSnapshot>(backend.legalRpcFailure);
      }
      const parsed = parseLegalDocumentsResponse(backend.legalRows, backend.now());
      if (!parsed.ok) return identityFailed<LegalSnapshot>("invalid_legal_response");
      return identityOk(parsed.snapshot);
    },

    async ensureProfile(): Promise<IdentityResult<BareProfile>> {
      backend.calls.push("ensureProfile");
      const programmed = takeProgrammedFailure(backend, "ensureProfile");
      if (programmed !== null) return identityFailed<BareProfile>(programmed);
      const scope = backend.currentAccountScopeId;
      if (scope === null) return identityFailed<BareProfile>("forbidden");

      const state = accountState(backend, scope);
      if (state.profileId === null) {
        state.profileId = backend.nextId();
        backend.writes.push("profiles:insert");
        backend.writes.push("account_profile_links:insert");
      }
      // Nothing else. A bare Profile grants no capability and no entitlement.
      return identityOk<BareProfile>({
        profileId: state.profileId,
        displayName: state.displayName,
      });
    },

    async resolveGateFacts(): Promise<IdentityResult<GateFacts>> {
      backend.calls.push("resolveGateFacts");
      const programmed = takeProgrammedFailure(backend, "resolveGateFacts");
      if (programmed !== null) return identityFailed<GateFacts>(programmed);
      const scope = backend.currentAccountScopeId;
      if (scope === null) return identityFailed<GateFacts>("forbidden");
      return identityOk(deriveGateFacts(backend, accountState(backend, scope)));
    },

    async completeOnboarding(input: CompleteOnboardingInput): Promise<IdentityResult<GateFacts>> {
      backend.calls.push("completeOnboarding");
      const programmed = takeProgrammedFailure(backend, "completeOnboarding");
      if (programmed !== null) return identityFailed<GateFacts>(programmed);
      const scope = backend.currentAccountScopeId;
      if (scope === null) return identityFailed<GateFacts>("forbidden");

      const state = accountState(backend, scope);
      // Step 2 of the RPC: the Profile must already exist. There is no second
      // creation path inside completion.
      if (state.profileId === null) return identityFailed<GateFacts>("profile_required");

      // Step 3, BEFORE any legal validation or any Profile write: an existing
      // completion short-circuits with zero writes.
      if (state.onboardingCompletedAt !== null) {
        return identityOk(deriveGateFacts(backend, state));
      }

      const displayName = input.displayName.trim();
      if (displayName.length === 0) return identityFailed<GateFacts>("invalid_input");
      if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
        return identityFailed<GateFacts>("invalid_input");
      }

      const current = currentDocuments(backend);
      if (current.terms === null || current.privacy === null) {
        return identityFailed<GateFacts>("legal_unavailable");
      }
      if (input.terms.id !== current.terms.id || input.privacy.id !== current.privacy.id) {
        return identityFailed<GateFacts>("stale_legal_version");
      }

      const completedAt = backend.now();
      const termsAcceptanceId = backend.nextId();
      const privacyAcceptanceId = backend.nextId();
      backend.writes.push("legal_acceptances:insert:terms");
      backend.writes.push("legal_acceptances:insert:privacy");
      backend.writes.push("athletes:insert");
      backend.writes.push("profile_entitlements:insert");
      backend.writes.push("profile_onboarding:insert");
      backend.writes.push("profiles:update:display_name");

      state.displayName = displayName;
      state.onboardingCompletedAt = completedAt;
      state.hasAthleteCapability = true;
      state.freeEntitlementActive = true;
      state.pinnedTerms = {
        acceptanceId: termsAcceptanceId,
        documentId: current.terms.id,
        versionLabel: current.terms.version_label,
        actedAt: completedAt,
      };
      state.pinnedPrivacy = {
        acceptanceId: privacyAcceptanceId,
        documentId: current.privacy.id,
        versionLabel: current.privacy.version_label,
        actedAt: completedAt,
      };

      return identityOk(deriveGateFacts(backend, state));
    },
  };
}
