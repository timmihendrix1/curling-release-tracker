// The one production `IdentityService` implementation (Stage B0.2c) over the four
// Stage B0.2a RPCs. Deliberately does NOT import "@supabase/supabase-js" — it only
// names the client's TYPE via supabaseClient.ts's re-export and receives an
// already-constructed client, exactly as supabaseTeamService.ts does, so the SDK
// import stays confined to the three files the architecture-boundary test allows.
//
// EVERY RPC RESPONSE IS UNTRUSTED. Not because the database is assumed hostile,
// but because the never-throw contract has to hold regardless: PostgREST could
// return a shape this build does not expect, a future migration could change a
// column, and a caller must never receive a half-mapped record or an unhandled
// rejection. So:
//
//  - every field is validated before it is used, through the audited readers in
//    src/lib/identity/untrustedValue.ts (which contain throwing getters and Proxy
//    traps as well as ordinary wrong types);
//  - a shape that cannot be trusted resolves `invalid_response`, never a partial
//    value;
//  - **no raw row, no column value, no unknown legal `kind`, no document id, no
//    unsafe URL and no thrown value ever escapes** into a returned error, a log or
//    the UI. A caught value is discarded without being inspected.
//
// LEGAL VALIDATION IS WHOLE-RESPONSE (ADR-0025 §17). One unknown kind, one
// duplicate kind, one malformed row or one unsafe URL invalidates the ENTIRE
// response; a genuine zero-row absence stays valid with that kind `null`. The
// mapper, not the database's check constraint, is the load-bearing boundary.
import type { SupabaseClient } from "./supabaseClient";
import {
  identityFailed,
  identityOk,
  type IdentityErrorKind,
  type IdentityResult,
} from "../identity/errors";
import {
  parseLegalDocumentsResponse,
  type CompleteOnboardingInput,
  type LegalSnapshot,
} from "../identity/legalSnapshot";
import type {
  BareProfile,
  GateFacts,
  IdentityService,
  PinnedLegalEvidence,
} from "../identity/identityService";
import {
  isCanonicalUuid,
  isRecordLike,
  isValidDisplayName,
  isValidLegalVersionLabel,
  isValidTimestamp,
  readUntrustedArray,
  readUntrustedField,
  readUntrustedProperty,
} from "../identity/untrustedValue";

/**
 * The RPC-raised failure kinds. Every Stage B0.2a function raises expected
 * failures as `'<kind>: <message>'` with a kind from this set
 * (supabase/migrations/20260825120200_identity_onboarding_functions.sql).
 *
 * The client-side classifications (`invalid_legal_response`, `invalid_response`,
 * `network_error`, `unexpected_error`) are deliberately NOT here: a database error
 * message must never be able to claim one of them.
 */
const RPC_RAISED_KINDS: ReadonlySet<IdentityErrorKind> = new Set<IdentityErrorKind>([
  "forbidden",
  "profile_required",
  "invalid_input",
  "legal_unavailable",
  "stale_legal_version",
  "conflict",
]);

type PostgrestLikeError = { message?: unknown } | null | undefined;

/**
 * Parses a raw Postgres/PostgREST error into a normalized `IdentityResult` failure,
 * **carrying only this repository's own canonical copy**.
 *
 * The prefix decides the kind; the tail is discarded entirely. That is stricter
 * than the committed Team boundary, and deliberately so: a known prefix is not a
 * guarantee about what follows it. A future migration, an extension, a trigger, or
 * a value interpolated into a message could put schema detail — or a caller's own
 * input — after a recognizable `invalid_input:`. Fixed copy makes "no raw
 * Postgres/PostgREST text ever reaches a caller" a property of the code rather
 * than a property of every message anyone ever writes.
 *
 * Fail-closed by default: anything that does not match `'<known-kind>: …'` becomes
 * `unexpected_error`. An attacker cannot obtain a sharper error, or any schema
 * detail, by causing an unexpected failure.
 */
function failFromRpcError<T>(error: PostgrestLikeError): IdentityResult<T> {
  const raw = readUntrustedProperty(error, "message");
  if (typeof raw !== "string") return identityFailed<T>("unexpected_error");
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0) return identityFailed<T>("unexpected_error");
  const candidate = raw.slice(0, separatorIndex).trim();
  if (!RPC_RAISED_KINDS.has(candidate as IdentityErrorKind)) {
    return identityFailed<T>("unexpected_error");
  }
  // No second argument: the canonical sentence for this kind, never the tail.
  return identityFailed<T>(candidate as IdentityErrorKind);
}

/**
 * Resolves the single row of a COMPOSITE-returning RPC.
 *
 * PostgREST may deliver a composite as an object or as a one-element array. Both
 * are accepted; **zero rows, two rows, or any additional row are not**. A
 * "duplicate" composite is not a shape this contract permits, and silently taking
 * `[0]` would let a response carrying two different Profiles be read as one.
 */
function singleCompositeRow(data: unknown): { ok: true; row: unknown } | { ok: false } {
  const asArray = readUntrustedArray(data);
  if (asArray.ok) {
    if (asArray.items.length !== 1) return { ok: false };
    const row = asArray.items[0];
    return isRecordLike(row) ? { ok: true, row } : { ok: false };
  }
  return isRecordLike(data) ? { ok: true, row: data } : { ok: false };
}

type Validated<T> = { ok: true; value: T } | { ok: false };

const INVALID: { ok: false } = { ok: false };

/** An explicit SQL null, or a canonical UUID. Absent or unreadable is invalid. */
function readNullableUuid(row: unknown, key: string): Validated<string | null> {
  const field = readUntrustedField(row, key);
  if (!field.present) return INVALID;
  if (field.value === null) return { ok: true, value: null };
  return isCanonicalUuid(field.value) ? { ok: true, value: field.value } : INVALID;
}

/**
 * An explicit SQL null, or a **display name** satisfying the committed
 * `profiles.display_name` contract: non-blank after trimming, at most 80
 * characters. Absent or unreadable is invalid.
 *
 * The bound is not decoration. `complete_personal_onboarding` refuses a name this
 * validator would refuse, so a row carrying one describes a Profile the database
 * cannot hold — and accepting it here would put an impossible value into a gate
 * session and, from there, into a trusted device record.
 */
function readNullableDisplayName(row: unknown, key: string): Validated<string | null> {
  const field = readUntrustedField(row, key);
  if (!field.present) return INVALID;
  if (field.value === null) return { ok: true, value: null };
  return isValidDisplayName(field.value) ? { ok: true, value: field.value } : INVALID;
}

/** An explicit SQL null, or a parseable timestamp. Absent or unreadable is invalid. */
function readNullableTimestamp(row: unknown, key: string): Validated<string | null> {
  const field = readUntrustedField(row, key);
  if (!field.present) return INVALID;
  if (field.value === null) return { ok: true, value: null };
  return isValidTimestamp(field.value) ? { ok: true, value: field.value } : INVALID;
}

/**
 * A boolean that GRANTS something, which must therefore be an actual boolean.
 *
 * A missing, null or wrong-typed value invalidates the whole response rather than
 * masquerading as `false`. Coercing to `false` sounds fail-closed, and for THIS
 * field it would be — but it would also let a truncated or renamed response look
 * like an ordinary "no capability yet" answer, hiding the fact that the response
 * could not be read at all. The database's own expressions can only ever produce a
 * boolean, so anything else is a response this build does not understand.
 */
function readGrantingBoolean(row: unknown, key: string): Validated<boolean> {
  const field = readUntrustedField(row, key);
  if (!field.present) return INVALID;
  return typeof field.value === "boolean" ? { ok: true, value: field.value } : INVALID;
}

/**
 * Reads one pinned-evidence group, **all-null or all-valid, with every member
 * checked in both directions**.
 *
 * All four columns null is the genuine "this Profile has not completed onboarding"
 * answer. All four valid is a completion. Anything between is a partial group, and
 * every partial direction invalidates the response — not just "the acceptance id is
 * present but the rest is not". These columns come from FK-guaranteed rows, so a
 * partial group cannot happen in a consistent database; treating it as "no
 * evidence" would silently hide real corruption, and short-circuiting on a null
 * acceptance id would skip the check entirely for the corrupt direction.
 */
function readPinnedEvidence(
  row: unknown,
  acceptanceKey: string,
  documentKey: string,
  labelKey: string,
  actedAtKey: string
): Validated<PinnedLegalEvidence | null> {
  const acceptance = readUntrustedField(row, acceptanceKey);
  const document = readUntrustedField(row, documentKey);
  const label = readUntrustedField(row, labelKey);
  const actedAt = readUntrustedField(row, actedAtKey);
  if (!acceptance.present || !document.present || !label.present || !actedAt.present) {
    return INVALID;
  }

  const nullCount = [acceptance, document, label, actedAt].filter(
    (field) => field.value === null
  ).length;
  if (nullCount === 4) return { ok: true, value: null };
  if (nullCount !== 0) return INVALID;

  if (!isCanonicalUuid(acceptance.value)) return INVALID;
  if (!isCanonicalUuid(document.value)) return INVALID;
  if (!isValidLegalVersionLabel(label.value)) return INVALID;
  if (!isValidTimestamp(actedAt.value)) return INVALID;

  return {
    ok: true,
    value: {
      acceptanceId: acceptance.value,
      documentId: document.value,
      versionLabel: label.value,
      actedAt: actedAt.value,
    },
  };
}

/**
 * Reads one `current_*` reporting pair as a coherent whole: both null, or both
 * valid. An id with no label, and a label with no id, are equally inconsistent.
 *
 * Both members stay plain `string`s. They are never branded as `LegalDocumentId`,
 * so they cannot reach `CompleteOnboardingInput`: acceptance evidence must come
 * from the same `getLegalSnapshot()` response the person was shown (ADR-0025 §17),
 * and this pair is reporting metadata that may legitimately describe a NEWER
 * version than the one pinned.
 */
function readCurrentPair(
  row: unknown,
  idKey: string,
  labelKey: string
): Validated<{ id: string | null; label: string | null }> {
  const id = readUntrustedField(row, idKey);
  const label = readUntrustedField(row, labelKey);
  if (!id.present || !label.present) return INVALID;

  if (id.value === null && label.value === null) {
    return { ok: true, value: { id: null, label: null } };
  }
  if (id.value === null || label.value === null) return INVALID;
  if (!isCanonicalUuid(id.value)) return INVALID;
  // The SAME committed `legal_documents.version_label` contract the pinned group
  // and the Legal parser use. A reporting label is still a real row's label.
  if (!isValidLegalVersionLabel(label.value)) return INVALID;
  return { ok: true, value: { id: id.value, label: label.value } };
}

/** Maps a `public.gate_state` row, or reports the response untrustworthy. */
function mapGateFacts(data: unknown): IdentityResult<GateFacts> {
  const single = singleCompositeRow(data);
  // The RPC always returns exactly one row — including for an account with no
  // Profile, reported as a null `profile_id`. Zero rows, two rows, or a shape that
  // is neither an object nor a one-element array is not the response this build
  // knows how to read.
  if (!single.ok) return identityFailed<GateFacts>("invalid_response");
  const row = single.row;

  const profileId = readNullableUuid(row, "profile_id");
  if (!profileId.ok) return identityFailed<GateFacts>("invalid_response");

  const displayName = readNullableDisplayName(row, "display_name");
  if (!displayName.ok) return identityFailed<GateFacts>("invalid_response");

  const onboardingCompletedAt = readNullableTimestamp(row, "onboarding_completed_at");
  if (!onboardingCompletedAt.ok) return identityFailed<GateFacts>("invalid_response");

  const hasAthleteCapability = readGrantingBoolean(row, "has_athlete_capability");
  if (!hasAthleteCapability.ok) return identityFailed<GateFacts>("invalid_response");

  const freeEntitlementActive = readGrantingBoolean(row, "free_entitlement_active");
  if (!freeEntitlementActive.ok) return identityFailed<GateFacts>("invalid_response");

  const pinnedTerms = readPinnedEvidence(
    row,
    "pinned_terms_acceptance_id",
    "pinned_terms_document_id",
    "pinned_terms_version_label",
    "pinned_terms_accepted_at"
  );
  if (!pinnedTerms.ok) return identityFailed<GateFacts>("invalid_response");

  const pinnedPrivacy = readPinnedEvidence(
    row,
    "pinned_privacy_acknowledgement_id",
    "pinned_privacy_document_id",
    "pinned_privacy_version_label",
    "pinned_privacy_acknowledged_at"
  );
  if (!pinnedPrivacy.ok) return identityFailed<GateFacts>("invalid_response");

  const currentTerms = readCurrentPair(row, "current_terms_document_id", "current_terms_version_label");
  if (!currentTerms.ok) return identityFailed<GateFacts>("invalid_response");

  const currentPrivacy = readCurrentPair(
    row,
    "current_privacy_document_id",
    "current_privacy_version_label"
  );
  if (!currentPrivacy.ok) return identityFailed<GateFacts>("invalid_response");

  // ---------------------------------------------------------------------
  // Server invariants, re-checked here because this is an UNTRUSTED response.
  //
  // `complete_personal_onboarding` establishes the completion row and both
  // evidence rows in one transaction, and `profile_onboarding` pins its exact
  // evidence by composite foreign key. So completion and evidence exist together
  // or not at all, and neither can exist without a Profile.
  //
  // Enforcing that here is what stops a response from reporting a completed,
  // eligible Profile whose justifying evidence is absent. Note this checks the
  // PINNED evidence only: a later document rotation changes `current_*` and must
  // never revoke or re-open what was pinned (ADR-0025 §17).
  // ---------------------------------------------------------------------
  const completed = onboardingCompletedAt.value !== null;
  const hasEvidence = pinnedTerms.value !== null && pinnedPrivacy.value !== null;
  const hasNoEvidence = pinnedTerms.value === null && pinnedPrivacy.value === null;
  if (completed && !hasEvidence) return identityFailed<GateFacts>("invalid_response");
  if (!completed && !hasNoEvidence) return identityFailed<GateFacts>("invalid_response");

  // Completed onboarding is the SOLE grant source for Athlete capability and the
  // default Free entitlement (ADR-0025 §16), so neither can precede it. This holds
  // whether or not a Profile id is present: the no-Profile branch below checks the
  // same thing for its own case, but a row naming a Profile whose onboarding is
  // incomplete while claiming capability or an active entitlement is equally
  // impossible — and would otherwise pass every check here.
  if (!completed && (hasAthleteCapability.value || freeEntitlementActive.value)) {
    return identityFailed<GateFacts>("invalid_response");
  }

  if (profileId.value === null) {
    // No Profile means nothing is derived from one.
    if (
      completed ||
      displayName.value !== null ||
      hasAthleteCapability.value ||
      freeEntitlementActive.value ||
      !hasNoEvidence
    ) {
      return identityFailed<GateFacts>("invalid_response");
    }
  }

  return identityOk<GateFacts>({
    profileId: profileId.value,
    displayName: displayName.value,
    onboardingCompletedAt: onboardingCompletedAt.value,
    hasAthleteCapability: hasAthleteCapability.value,
    freeEntitlementActive: freeEntitlementActive.value,
    pinnedTerms: pinnedTerms.value,
    pinnedPrivacy: pinnedPrivacy.value,
    currentTermsDocumentId: currentTerms.value.id,
    currentTermsVersionLabel: currentTerms.value.label,
    currentPrivacyDocumentId: currentPrivacy.value.id,
    currentPrivacyVersionLabel: currentPrivacy.value.label,
  });
}

/** Injected so no timestamp is invented inside the mapper and tests are
 * deterministic. */
export type SupabaseIdentityServiceOverrides = {
  now?: () => string;
};

export function createSupabaseIdentityService(
  client: SupabaseClient,
  overrides: SupabaseIdentityServiceOverrides = {}
): IdentityService {
  const now = overrides.now ?? (() => new Date().toISOString());

  return {
    async getLegalSnapshot(): Promise<IdentityResult<LegalSnapshot>> {
      try {
        const { data, error } = await client.rpc("get_current_legal_documents");
        if (error) return failFromRpcError<LegalSnapshot>(error);
        // A table-returning RPC: the contract permits an array, and only an array.
        // The mapper below performs the contained traversal and the whole-response
        // validation.
        const parsed = parseLegalDocumentsResponse(data, now());
        // The failure member carries nothing at all, so nothing from the response
        // can travel with this error.
        if (!parsed.ok) return identityFailed<LegalSnapshot>("invalid_legal_response");
        return identityOk(parsed.snapshot);
      } catch {
        return identityFailed<LegalSnapshot>("unexpected_error");
      }
    },

    async ensureProfile(): Promise<IdentityResult<BareProfile>> {
      try {
        const { data, error } = await client.rpc("ensure_my_profile");
        if (error) return failFromRpcError<BareProfile>(error);
        const single = singleCompositeRow(data);
        if (!single.ok) return identityFailed<BareProfile>("invalid_response");
        const id = readUntrustedField(single.row, "id");
        if (!id.present || !isCanonicalUuid(id.value)) {
          return identityFailed<BareProfile>("invalid_response");
        }
        const displayName = readNullableDisplayName(single.row, "display_name");
        if (!displayName.ok) return identityFailed<BareProfile>("invalid_response");
        return identityOk<BareProfile>({ profileId: id.value, displayName: displayName.value });
      } catch {
        return identityFailed<BareProfile>("unexpected_error");
      }
    },

    async resolveGateFacts(): Promise<IdentityResult<GateFacts>> {
      try {
        const { data, error } = await client.rpc("get_my_gate_state");
        if (error) return failFromRpcError<GateFacts>(error);
        return mapGateFacts(data);
      } catch {
        return identityFailed<GateFacts>("unexpected_error");
      }
    },

    async completeOnboarding(input: CompleteOnboardingInput): Promise<IdentityResult<GateFacts>> {
      try {
        const { data, error } = await client.rpc("complete_personal_onboarding", {
          p_display_name: input.displayName,
          // The IDS come from the validated snapshot objects themselves, never
          // from a caller-supplied string — that is what makes "the ids submitted
          // are the ids displayed" structural rather than conventional.
          p_terms_document_id: input.terms.id,
          p_privacy_document_id: input.privacy.id,
        });
        if (error) return failFromRpcError<GateFacts>(error);
        return mapGateFacts(data);
      } catch {
        return identityFailed<GateFacts>("unexpected_error");
      }
    },
  };
}
