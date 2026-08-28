// One coherent Legal snapshot, and the whole-response validation that produces it
// (ADR-0025 §17; Stage B0.2c).
//
// The two rules that shape everything here:
//
//  1. **One snapshot.** The metadata a person is shown and the ids their
//     acceptance submits come from the SAME server query
//     (`get_current_legal_documents()` returns both kinds from one `STABLE`
//     statement), so an acceptance can never be pinned to a version that was
//     never displayed.
//  2. **Whole-response validation, with unknown kinds failing closed.** Any
//     unknown kind, any malformed known-kind row, any duplicate for one known
//     kind, or any unsafe URL invalidates the ENTIRE response. There is no
//     "first wins", no "last wins" and no "ignored anomaly": treating one bad
//     row as absence would silently downgrade a corrupt or tampered response
//     into an ordinary expected state, and would let the OTHER document in the
//     same response be used as if the response were trustworthy.
//
// **Genuine absence stays distinct.** Zero rows for a known kind, with every
// returned row valid, is a normal state — that kind is `null`, and the caller
// applies the approved per-kind fail-closed rule (`legal_unavailable` for a
// missing Privacy Notice, `onboarding_blocked_legal` for missing Terms).
//
// This parser remains content-agnostic. ADR-0041 authors a public Privacy Notice
// page and an operational metadata snippet elsewhere; no Legal content or canonical
// URL is hard-coded into this untrusted-response boundary.

import { parseSafeLegalUrl, type SafeHttpsUrl } from "./safeLegalUrl";
import {
  isRecordLike,
  isValidLegalVersionLabel,
  isValidTimestamp,
  readUntrustedArray,
  readUntrustedLiteral,
  readUntrustedProperty,
  readUntrustedTimestamp,
  readUntrustedUuid,
} from "./untrustedValue";

export type LegalDocumentKind = "terms_of_service" | "privacy_notice";

export const LEGAL_DOCUMENT_KINDS: readonly LegalDocumentKind[] = [
  "terms_of_service",
  "privacy_notice",
];

/**
 * A document id that came out of a fully validated response. Branded, and
 * constructible only inside this module, so a bare `string` — notably a
 * `current_terms_document_id` read off `get_my_gate_state()`, which is
 * REPORTING-ONLY metadata — cannot be passed where acceptance evidence is
 * required.
 */
export type LegalDocumentId = string & { readonly __legalDocumentId: unique symbol };

/**
 * One current legal document. Parameterized by kind so the Terms field and the
 * Privacy field are **not interchangeable**: a
 * `SafeLegalDocument<"privacy_notice">` is not assignable to a
 * `SafeLegalDocument<"terms_of_service">`, which is what stops a swapped
 * argument from reaching `complete_personal_onboarding`'s two `uuid` parameters,
 * where both would be structurally acceptable.
 */
export type SafeLegalDocument<K extends LegalDocumentKind> = {
  id: LegalDocumentId;
  kind: K;
  versionLabel: string;
  href: SafeHttpsUrl;
  effectiveAt: string;
};

export type LegalSnapshot = {
  terms: SafeLegalDocument<"terms_of_service"> | null;
  privacy: SafeLegalDocument<"privacy_notice"> | null;
  /** When this snapshot was taken, for the caller's own staleness reasoning.
   * Supplied by the caller's clock — never invented here, and **validated as an
   * actual timestamp** before a snapshot is produced. */
  fetchedAt: string;
};

/**
 * Completion takes the validated document OBJECTS, never bare ids (ADR-0025
 * §17). That is what makes "the ids submitted are the ids displayed" a type-level
 * property rather than a convention a caller has to remember.
 */
export type CompleteOnboardingInput = {
  displayName: string;
  terms: SafeLegalDocument<"terms_of_service">;
  privacy: SafeLegalDocument<"privacy_notice">;
};

/** The whole-response verdict. The failure member carries **nothing** — no raw
 * row, no unknown kind string, no id, no URL, no count — so an invalid response
 * cannot leak a value into a normalized error, a log, a reducer or the UI. */
export type LegalResponseParse =
  | { ok: true; snapshot: LegalSnapshot }
  | { ok: false };


type ValidatedRow =
  | { kind: "terms_of_service"; document: SafeLegalDocument<"terms_of_service"> }
  | { kind: "privacy_notice"; document: SafeLegalDocument<"privacy_notice"> };

/**
 * Validates one row completely, or rejects it. Rejection is never local: every
 * caller below turns a `null` here into an invalid WHOLE response.
 */
function validateRow(row: unknown): ValidatedRow | null {
  if (!isRecordLike(row)) return null;

  const kind = readUntrustedLiteral<LegalDocumentKind>(row, "kind", LEGAL_DOCUMENT_KINDS);
  if (kind === null) return null;

  const id = readUntrustedUuid(row, "id");
  if (id === null) return null;

  // The committed `legal_documents.version_label` contract, from the ONE shared
  // validator every boundary uses — so this parser, the Supabase mapper and the
  // coordinator's injected-service snapshot cannot drift apart on what a label is.
  const rawVersionLabel = readUntrustedProperty(row, "version_label");
  if (!isValidLegalVersionLabel(rawVersionLabel)) return null;
  // Padding is normalized away for DISPLAY metadata only; the decision above was
  // made against the raw value, exactly as the database's own checks are.
  const versionLabel = rawVersionLabel.trim();

  const href = parseSafeLegalUrl(readUntrustedProperty(row, "document_url"));
  if (href === null) return null;

  const effectiveAt = readUntrustedTimestamp(row, "effective_at");
  if (effectiveAt === null) return null;

  // The brand is applied here and only here, after every field of this row has
  // passed. Nothing partially validated ever carries it.
  const base = { id: id as LegalDocumentId, versionLabel, href, effectiveAt };
  return kind === "terms_of_service"
    ? { kind, document: { ...base, kind } }
    : { kind, document: { ...base, kind } };
}

/**
 * Maps `get_current_legal_documents()`'s rows into a `LegalSnapshot`, or reports
 * the whole response invalid.
 *
 * Invalid: a non-array payload (including `null`/`undefined` — an empty result
 * set is `[]`, so anything else is a shape the mapper cannot trust); an array
 * whose traversal cannot be completed safely (a revoked or hostile Proxy); a
 * non-record row; an unknown `kind`; a malformed known-kind row; a duplicate
 * row for one known kind; an unsafe `document_url`.
 *
 * Valid: exactly one well-formed row per kind, one well-formed row and one
 * genuine absence, or two genuine absences. Never throws, including for a
 * Proxy-backed payload or a row whose getters throw.
 */
export function parseLegalDocumentsResponse(
  rows: unknown,
  fetchedAt: string
): LegalResponseParse {
  // The caller's own clock is validated too. It is injected, so "it returns a
  // timestamp" is a property of whatever was passed in — and a snapshot carrying an
  // unusable `fetchedAt` would let a caller reason about staleness from a value that
  // means nothing. An invalid one fails the whole response closed, which the gate
  // maps to `legal_unavailable`.
  if (!isValidTimestamp(fetchedAt)) return { ok: false };

  // Contained traversal: `Array.isArray` itself throws on a revoked Proxy, and a
  // hostile `length`, index getter or `Symbol.iterator` can throw part-way through.
  const payload = readUntrustedArray(rows);
  if (!payload.ok) return { ok: false };

  let terms: SafeLegalDocument<"terms_of_service"> | null = null;
  let privacy: SafeLegalDocument<"privacy_notice"> | null = null;

  for (const row of payload.items) {
    const validated = validateRow(row);
    if (validated === null) return { ok: false };
    if (validated.kind === "terms_of_service") {
      if (terms !== null) return { ok: false };
      terms = validated.document;
    } else {
      if (privacy !== null) return { ok: false };
      privacy = validated.document;
    }
  }

  return { ok: true, snapshot: { terms, privacy, fetchedAt } };
}

/**
 * Sign-in may be offered only when a current Privacy Notice exists (ADR-0025
 * §17 / §6.1a of the approved staging plan). A missing one is `legal_unavailable`
 * — a normal, expected state, distinct from an invalid response.
 */
export function canOfferSignIn(snapshot: LegalSnapshot): boolean {
  return snapshot.privacy !== null;
}

/**
 * Onboarding completion requires BOTH documents: Terms to accept and a Privacy
 * Notice to acknowledge. A missing Terms row is `onboarding_blocked_legal`.
 */
export function canCompleteOnboarding(snapshot: LegalSnapshot): boolean {
  return snapshot.terms !== null && snapshot.privacy !== null;
}

/**
 * The pair required by `CompleteOnboardingInput`, or `null` when the snapshot
 * cannot support completion. Exists so a caller never has to non-null-assert its
 * way from a `LegalSnapshot` to a submission.
 */
export function requiredLegalDocuments(
  snapshot: LegalSnapshot
): { terms: SafeLegalDocument<"terms_of_service">; privacy: SafeLegalDocument<"privacy_notice"> } | null {
  if (snapshot.terms === null || snapshot.privacy === null) return null;
  return { terms: snapshot.terms, privacy: snapshot.privacy };
}
