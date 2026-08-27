// Whole-response Legal validation (ADR-0025 §17). The central rule under test:
// **any unknown kind, any malformed known-kind row, any duplicate for one known
// kind, or any unsafe URL invalidates the ENTIRE response** — never "first wins",
// never "last wins", never an ignored anomaly. Genuine absence stays a distinct,
// normal state.
import { describe, expect, it } from "vitest";
import {
  canCompleteOnboarding,
  canOfferSignIn,
  parseLegalDocumentsResponse,
  requiredLegalDocuments,
  type CompleteOnboardingInput,
  type LegalSnapshot,
  type SafeLegalDocument,
} from "../legalSnapshot";

const TERMS_ID = "dddddddd-1111-4111-8111-dddddddddddd";
const PRIVACY_ID = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee";
const OTHER_TERMS_ID = "dddddddd-2222-4222-8222-dddddddddddd";
const FETCHED_AT = "2026-03-01T10:00:00.000Z";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TERMS_ID,
    kind: "terms_of_service",
    version_label: "2026-01",
    document_url: "https://example.invalid/legal/terms-fixture",
    effective_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const VALID_TERMS = row();
const VALID_PRIVACY = row({
  id: PRIVACY_ID,
  kind: "privacy_notice",
  document_url: "https://example.invalid/legal/privacy-fixture",
});

/** Every distinctive string a hostile fixture carries, so "the normalized failure
 * leaks nothing" can be asserted by scanning rather than assumed. */
const HOSTILE_VALUES = [
  "shadow_policy",
  "javascript:alert(1)",
  "00000000-not-a-uuid",
  "MARKETING_CONSENT",
  "https://attacker.invalid/steal",
];

describe("parseLegalDocumentsResponse — the valid cases", () => {
  it("maps an exact two-document response", () => {
    const parsed = parseLegalDocumentsResponse([VALID_TERMS, VALID_PRIVACY], FETCHED_AT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.terms?.id).toBe(TERMS_ID);
    expect(parsed.snapshot.terms?.kind).toBe("terms_of_service");
    expect(parsed.snapshot.privacy?.id).toBe(PRIVACY_ID);
    expect(parsed.snapshot.privacy?.kind).toBe("privacy_notice");
    expect(parsed.snapshot.fetchedAt).toBe(FETCHED_AT);
  });

  it("keeps GENUINE zero-row absence valid and distinguishable, per kind", () => {
    const none = parseLegalDocumentsResponse([], FETCHED_AT);
    expect(none.ok).toBe(true);
    if (none.ok) {
      expect(none.snapshot.terms).toBeNull();
      expect(none.snapshot.privacy).toBeNull();
      // The approved per-kind fail-closed states: no Privacy Notice means sign-in
      // is not offered; no Terms means completion is refused.
      expect(canOfferSignIn(none.snapshot)).toBe(false);
      expect(canCompleteOnboarding(none.snapshot)).toBe(false);
    }

    const termsOnly = parseLegalDocumentsResponse([VALID_TERMS], FETCHED_AT);
    expect(termsOnly.ok).toBe(true);
    if (termsOnly.ok) {
      expect(termsOnly.snapshot.privacy).toBeNull();
      expect(canOfferSignIn(termsOnly.snapshot)).toBe(false);
    }

    const privacyOnly = parseLegalDocumentsResponse([VALID_PRIVACY], FETCHED_AT);
    expect(privacyOnly.ok).toBe(true);
    if (privacyOnly.ok) {
      expect(privacyOnly.snapshot.terms).toBeNull();
      // Sign-in IS offerable — the Privacy Notice exists — while completion is
      // refused. These are different rules and stay different.
      expect(canOfferSignIn(privacyOnly.snapshot)).toBe(true);
      expect(canCompleteOnboarding(privacyOnly.snapshot)).toBe(false);
    }
  });

  it("trims a padded version label but keeps the URL byte-identical", () => {
    const parsed = parseLegalDocumentsResponse(
      [row({ version_label: "  2026-01  " }), VALID_PRIVACY],
      FETCHED_AT
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.terms?.versionLabel).toBe("2026-01");
    expect(parsed.snapshot.terms?.href).toBe("https://example.invalid/legal/terms-fixture");
  });

  it("requiredLegalDocuments yields the pair only when both exist", () => {
    const both = parseLegalDocumentsResponse([VALID_TERMS, VALID_PRIVACY], FETCHED_AT);
    expect(both.ok && requiredLegalDocuments(both.snapshot)).not.toBeNull();
    const one = parseLegalDocumentsResponse([VALID_TERMS], FETCHED_AT);
    expect(one.ok && requiredLegalDocuments(one.snapshot)).toBeNull();
  });
});

describe("parseLegalDocumentsResponse — whole-response invalidation", () => {
  const invalid: Array<[string, unknown]> = [
    [
      "a valid Terms, a valid Privacy AND one unknown-kind row",
      [VALID_TERMS, VALID_PRIVACY, row({ id: OTHER_TERMS_ID, kind: "shadow_policy" })],
    ],
    ["an unknown kind alone", [row({ kind: "shadow_policy" })]],
    ["a MARKETING_CONSENT-shaped kind", [row({ kind: "MARKETING_CONSENT" })]],
    ["duplicate Terms", [VALID_TERMS, row({ id: OTHER_TERMS_ID })]],
    ["duplicate Terms with identical ids", [VALID_TERMS, VALID_TERMS]],
    [
      "duplicate Privacy",
      [VALID_PRIVACY, row({ id: OTHER_TERMS_ID, kind: "privacy_notice" })],
    ],
    [
      "one safe and one malformed duplicate of the same kind",
      [VALID_TERMS, row({ id: OTHER_TERMS_ID, document_url: "javascript:alert(1)" })],
    ],
    ["a non-canonical UUID", [row({ id: "00000000-not-a-uuid" }), VALID_PRIVACY]],
    ["an upper-case UUID", [row({ id: TERMS_ID.toUpperCase() }), VALID_PRIVACY]],
    ["a null id", [row({ id: null }), VALID_PRIVACY]],
    ["a numeric id", [row({ id: 7 }), VALID_PRIVACY]],
    ["a null kind", [row({ kind: null }), VALID_PRIVACY]],
    ["a blank version label", [row({ version_label: "   " }), VALID_PRIVACY]],
    ["an empty version label", [row({ version_label: "" }), VALID_PRIVACY]],
    ["an oversized version label", [row({ version_label: "x".repeat(121) }), VALID_PRIVACY]],
    ["a non-string version label", [row({ version_label: 2026 }), VALID_PRIVACY]],
    ["an unsafe javascript: URL", [row({ document_url: "javascript:alert(1)" }), VALID_PRIVACY]],
    ["an http: URL", [row({ document_url: "http://example.invalid/legal" }), VALID_PRIVACY]],
    [
      "a credentialed URL",
      [row({ document_url: "https://user:pass@attacker.invalid/steal" }), VALID_PRIVACY],
    ],
    ["a null URL", [row({ document_url: null }), VALID_PRIVACY]],
    ["an invalid timestamp", [row({ effective_at: "not-a-date" }), VALID_PRIVACY]],
    ["a null timestamp", [row({ effective_at: null }), VALID_PRIVACY]],
    ["a numeric timestamp", [row({ effective_at: 1767225600 }), VALID_PRIVACY]],
    ["a non-object row", ["terms_of_service"]],
    ["a null row", [null]],
    ["an array row", [[VALID_TERMS]]],
    ["a non-array payload", { rows: [VALID_TERMS] }],
    ["a null payload", null],
    ["an undefined payload", undefined],
    ["a string payload", "terms_of_service"],
  ];

  for (const [label, payload] of invalid) {
    it(`fails closed on ${label}`, () => {
      const parsed = parseLegalDocumentsResponse(payload, FETCHED_AT);
      expect(parsed.ok).toBe(false);
      // No partial snapshot escapes: the failure member has no other property at
      // all, so there is nowhere for a document, an id or a URL to travel.
      expect(Object.keys(parsed)).toEqual(["ok"]);
    });
  }

  it("an unsafe URL invalidates the WHOLE response rather than making that one document absent", () => {
    const parsed = parseLegalDocumentsResponse(
      [row({ document_url: "javascript:alert(1)" }), VALID_PRIVACY],
      FETCHED_AT
    );
    // If it were treated as absence, this would be `ok` with `terms: null` and the
    // OTHER document usable — silently downgrading a corrupt response into an
    // ordinary, expected state.
    expect(parsed.ok).toBe(false);
  });

  it("the serialized failure contains none of the hostile fixture values", () => {
    const payload = [
      row({ id: "00000000-not-a-uuid", document_url: "javascript:alert(1)" }),
      row({ id: OTHER_TERMS_ID, kind: "shadow_policy" }),
      row({
        id: PRIVACY_ID,
        kind: "MARKETING_CONSENT",
        document_url: "https://attacker.invalid/steal",
      }),
    ];
    const parsed = parseLegalDocumentsResponse(payload, FETCHED_AT);
    const serialized = JSON.stringify(parsed);
    for (const value of HOSTILE_VALUES) {
      expect(serialized, value).not.toContain(value);
    }
  });

  it("never throws on a hostile row whose getters or Proxy traps throw", () => {
    const throwingGetter = {
      get kind(): string {
        throw new Error("hostile getter");
      },
    };
    const hostileProxy = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile get trap");
        },
        has() {
          throw new Error("hostile has trap");
        },
        getOwnPropertyDescriptor() {
          throw new Error("hostile descriptor trap");
        },
      }
    );
    for (const payload of [[throwingGetter], [hostileProxy], [VALID_TERMS, hostileProxy]]) {
      expect(() => parseLegalDocumentsResponse(payload, FETCHED_AT)).not.toThrow();
      expect(parseLegalDocumentsResponse(payload, FETCHED_AT).ok).toBe(false);
    }
  });
});

describe("type-level constraints", () => {
  it("a Privacy document is not assignable to the Terms field, and vice versa", () => {
    const parsed = parseLegalDocumentsResponse([VALID_TERMS, VALID_PRIVACY], FETCHED_AT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const terms = parsed.snapshot.terms;
    const privacy = parsed.snapshot.privacy;
    expect(terms).not.toBeNull();
    expect(privacy).not.toBeNull();
    if (terms === null || privacy === null) return;

    const swapped: LegalSnapshot = {
      // @ts-expect-error a privacy_notice document must not satisfy the Terms field
      terms: privacy,
      privacy,
      fetchedAt: FETCHED_AT,
    };
    expect(swapped.privacy?.kind).toBe("privacy_notice");

    const swappedBack: LegalSnapshot = {
      terms,
      // @ts-expect-error a terms_of_service document must not satisfy the Privacy field
      privacy: terms,
      fetchedAt: FETCHED_AT,
    };
    expect(swappedBack.terms?.kind).toBe("terms_of_service");
  });

  it("a bare `current_*` string cannot be supplied as completion evidence", () => {
    // `get_my_gate_state()`'s `current_terms_document_id` is REPORTING-ONLY and is
    // a plain string. Branding is applied only inside the mapper, after the whole
    // response passes, which is what makes this unassignable.
    const currentTermsDocumentId: string = TERMS_ID;
    const attempted: CompleteOnboardingInput = {
      displayName: "Athlete",
      // @ts-expect-error a raw id string is not a validated SafeLegalDocument
      terms: currentTermsDocumentId,
      // @ts-expect-error a raw id string is not a validated SafeLegalDocument
      privacy: PRIVACY_ID,
    };
    expect(attempted.displayName).toBe("Athlete");
  });

  it("a hand-built object cannot impersonate a SafeLegalDocument", () => {
    const forged = {
      id: TERMS_ID,
      kind: "terms_of_service" as const,
      versionLabel: "2026-01",
      href: "javascript:alert(1)",
      effectiveAt: "2026-01-01T00:00:00.000Z",
    };
    // @ts-expect-error neither `id` nor `href` carries its brand
    const assigned: SafeLegalDocument<"terms_of_service"> = forged;
    expect(assigned.versionLabel).toBe("2026-01");
  });
});
