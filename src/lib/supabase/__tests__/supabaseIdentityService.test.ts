// The production `IdentityService` over the Stage B0.2a RPCs.
//
// Every response here is treated as untrusted — not because the database is
// assumed hostile, but because the never-throw contract has to hold regardless.
// The assertions that matter: a shape that cannot be trusted resolves
// `invalid_response` or `invalid_legal_response` rather than a partial value, and
// **no raw row, column value, unknown legal kind, document id, unsafe URL or
// thrown value ever escapes**.
import { describe, expect, it, vi } from "vitest";
import { createSupabaseIdentityService } from "../supabaseIdentityService";
import type { SupabaseClient } from "../supabaseClient";
import { deriveGateEligibility } from "../../identity/identityService";
import { FRIENDLY_IDENTITY_MESSAGE } from "../../identity/errors";

const PROFILE_ID = "cccccccc-1111-4111-8111-cccccccccccc";
const TERMS_ID = "dddddddd-1111-4111-8111-dddddddddddd";
const PRIVACY_ID = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee";
const TERMS_ACCEPTANCE_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const PRIVACY_ACCEPTANCE_ID = "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa";
const NOW = "2026-03-01T10:00:00.000Z";

type RpcResult = { data: unknown; error: { message?: unknown } | null };

/** A client whose `rpc` returns programmed results and records its calls. Casting
 * to `SupabaseClient` keeps the service's real signature under test without
 * pulling in the SDK. */
function fakeClient(
  responses: Partial<Record<string, RpcResult | (() => RpcResult) | (() => never)>>
): { client: SupabaseClient; calls: Array<{ name: string; args: unknown }> } {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = {
    rpc: async (name: string, args?: unknown) => {
      calls.push({ name, args });
      const programmed = responses[name];
      if (programmed === undefined) return { data: null, error: null };
      return typeof programmed === "function" ? programmed() : programmed;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function legalRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TERMS_ID,
    kind: "terms_of_service",
    version_label: "2026-01",
    document_url: "https://example.invalid/legal/terms-fixture",
    effective_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const PRIVACY_ROW = legalRow({
  id: PRIVACY_ID,
  kind: "privacy_notice",
  document_url: "https://example.invalid/legal/privacy-fixture",
});

function gateStateRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    profile_id: PROFILE_ID,
    display_name: "Athlete",
    onboarding_completed_at: "2026-02-01T09:00:00.000Z",
    has_athlete_capability: true,
    free_entitlement_active: true,
    pinned_terms_acceptance_id: TERMS_ACCEPTANCE_ID,
    pinned_terms_document_id: TERMS_ID,
    pinned_terms_version_label: "2026-01",
    pinned_terms_accepted_at: "2026-02-01T09:00:00.000Z",
    pinned_privacy_acknowledgement_id: PRIVACY_ACCEPTANCE_ID,
    pinned_privacy_document_id: PRIVACY_ID,
    pinned_privacy_version_label: "2026-01",
    pinned_privacy_acknowledged_at: "2026-02-01T09:00:00.000Z",
    current_terms_document_id: TERMS_ID,
    current_terms_version_label: "2026-01",
    current_privacy_document_id: PRIVACY_ID,
    current_privacy_version_label: "2026-01",
    ...overrides,
  };
}

function service(responses: Parameters<typeof fakeClient>[0]) {
  const { client, calls } = fakeClient(responses);
  return { service: createSupabaseIdentityService(client, { now: () => NOW }), calls };
}

describe("getLegalSnapshot", () => {
  it("maps a valid two-document response and stamps the injected clock", async () => {
    const { service: identity } = service({
      get_current_legal_documents: { data: [legalRow(), PRIVACY_ROW], error: null },
    });
    const result = await identity.getLegalSnapshot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.terms?.id).toBe(TERMS_ID);
    expect(result.value.privacy?.id).toBe(PRIVACY_ID);
    expect(result.value.fetchedAt).toBe(NOW);
  });

  it("keeps genuine zero-row absence valid and per-kind", async () => {
    const { service: identity } = service({
      get_current_legal_documents: { data: [], error: null },
    });
    const result = await identity.getLegalSnapshot();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.terms).toBeNull();
      expect(result.value.privacy).toBeNull();
    }
  });

  it("fails the WHOLE response closed, leaking nothing, for every invalid shape", async () => {
    const hostile = [
      "shadow_policy",
      "javascript:alert(1)",
      "https://attacker.invalid/steal",
      "not-a-uuid",
    ];
    const payloads: Array<[string, unknown]> = [
      ["an unknown kind alongside two valid rows", [legalRow(), PRIVACY_ROW, legalRow({ kind: "shadow_policy", id: PRIVACY_ID })]],
      ["duplicate Terms", [legalRow(), legalRow({ id: PRIVACY_ID })]],
      ["an unsafe URL", [legalRow({ document_url: "javascript:alert(1)" }), PRIVACY_ROW]],
      ["an attacker-controlled credentialed URL", [legalRow({ document_url: "https://u:p@attacker.invalid/steal" }), PRIVACY_ROW]],
      ["a non-canonical id", [legalRow({ id: "not-a-uuid" }), PRIVACY_ROW]],
      ["a non-array payload", { rows: [legalRow()] }],
      ["a null payload", null],
    ];
    for (const [label, data] of payloads) {
      const { service: identity } = service({
        get_current_legal_documents: { data, error: null },
      });
      const result = await identity.getLegalSnapshot();
      expect(result.ok, label).toBe(false);
      if (result.ok) continue;
      expect(result.error.kind).toBe("invalid_legal_response");
      const serialized = JSON.stringify(result);
      for (const value of hostile) expect(serialized, `${label} / ${value}`).not.toContain(value);
      expect(serialized).not.toContain(TERMS_ID);
      expect(serialized).not.toContain(PRIVACY_ID);
    }
  });

  it("maps a raised RPC failure onto its declared kind and carries ONLY canonical copy", async () => {
    // The prefix decides the kind; the tail is discarded entirely. A known prefix
    // is not a guarantee about what follows it — a trigger, an extension or an
    // interpolated value could put schema detail or caller input there.
    const { service: declared } = service({
      get_current_legal_documents: {
        data: null,
        error: {
          message:
            "legal_unavailable: relation \"public.legal_documents\" owner=postgres sb_secret_leak",
        },
      },
    });
    const result = await declared.getLegalSnapshot();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("legal_unavailable");
      expect(result.error.message).toBe(FRIENDLY_IDENTITY_MESSAGE.legal_unavailable);
      for (const secret of ["relation", "public.legal_documents", "owner=postgres", "sb_secret_leak"]) {
        expect(result.error.message, secret).not.toContain(secret);
      }
      expect(JSON.stringify(result)).not.toContain("sb_secret_leak");
    }
  });

  it("discards the tail for EVERY known prefix", async () => {
    const SECRET = "sb_secret_must_not_travel";
    const prefixes = [
      "forbidden",
      "profile_required",
      "invalid_input",
      "legal_unavailable",
      "stale_legal_version",
      "conflict",
    ] as const;
    for (const prefix of prefixes) {
      const { service: identity } = service({
        get_my_gate_state: { data: null, error: { message: `${prefix}: ${SECRET}` } },
      });
      const result = await identity.resolveGateFacts();
      expect(result.ok, prefix).toBe(false);
      if (!result.ok) {
        expect(result.error.kind, prefix).toBe(prefix);
        expect(result.error.message, prefix).toBe(FRIENDLY_IDENTITY_MESSAGE[prefix]);
        expect(JSON.stringify(result), prefix).not.toContain(SECRET);
      }
    }
  });

  it("an unrecognized message becomes the generic default and leaks nothing", async () => {
    const { service: leaky } = service({
      get_current_legal_documents: {
        data: null,
        error: {
          message: 'permission denied for table legal_documents (constraint "legal_document_url_is_safe")',
        },
      },
    });
    const generic = await leaky.getLegalSnapshot();
    expect(generic.ok).toBe(false);
    if (!generic.ok) {
      expect(generic.error.kind).toBe("unexpected_error");
      expect(generic.error.message).not.toContain("permission denied");
      expect(generic.error.message).not.toContain("legal_document_url_is_safe");
    }
  });

  it("refuses a client-side classification smuggled in through a database message", async () => {
    // `invalid_legal_response`, `invalid_response`, `network_error` and
    // `unexpected_error` are decided on the client. A message claiming one of them
    // must fall through to the generic default.
    for (const prefix of ["invalid_legal_response", "invalid_response", "network_error"]) {
      const { service: identity } = service({
        get_current_legal_documents: { data: null, error: { message: `${prefix}: crafted` } },
      });
      const result = await identity.getLegalSnapshot();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind, prefix).toBe("unexpected_error");
        expect(result.error.message).not.toContain("crafted");
      }
    }
  });
});

describe("ensureProfile", () => {
  it("maps a bare Profile row", async () => {
    const { service: identity, calls } = service({
      ensure_my_profile: { data: { id: PROFILE_ID, display_name: null }, error: null },
    });
    const result = await identity.ensureProfile();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ profileId: PROFILE_ID, displayName: null });
    expect(calls).toEqual([{ name: "ensure_my_profile", args: undefined }]);
  });

  it("accepts the one-element array form, and refuses zero, duplicate or extra rows", async () => {
    const { service: identity } = service({
      ensure_my_profile: { data: [{ id: PROFILE_ID, display_name: "Athlete" }], error: null },
    });
    const result = await identity.ensureProfile();
    expect(result.ok && result.value.displayName).toBe("Athlete");

    for (const [label, data] of [
      ["zero rows", []],
      ["duplicate rows", [{ id: PROFILE_ID }, { id: PROFILE_ID }]],
      [
        "two different Profiles",
        [{ id: PROFILE_ID, display_name: null }, { id: PRIVACY_ID, display_name: null }],
      ],
    ] as Array<[string, unknown]>) {
      const { service: refusing } = service({ ensure_my_profile: { data, error: null } });
      const refused = await refusing.ensureProfile();
      expect(refused.ok, label).toBe(false);
      if (!refused.ok) expect(refused.error.kind).toBe("invalid_response");
    }
  });

  it("distinguishes an absent `display_name` property from an explicit null", async () => {
    const { service: explicit } = service({
      ensure_my_profile: { data: { id: PROFILE_ID, display_name: null }, error: null },
    });
    await expect(explicit.ensureProfile()).resolves.toMatchObject({ ok: true });

    const { service: truncated } = service({
      ensure_my_profile: { data: { id: PROFILE_ID }, error: null },
    });
    const result = await truncated.ensureProfile();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_response");
  });

  it("fails closed on an untrustworthy row", async () => {
    for (const data of [null, undefined, {}, { id: "not-a-uuid" }, { id: PROFILE_ID, display_name: 7 }, "row", []]) {
      const { service: identity } = service({ ensure_my_profile: { data, error: null } });
      const result = await identity.ensureProfile();
      expect(result.ok, JSON.stringify(data)).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_response");
    }
  });

  it("maps forbidden and profile_required from the RPC's own prefixes", async () => {
    const { service: forbidden } = service({
      ensure_my_profile: { data: null, error: { message: "forbidden: Sign in to continue." } },
    });
    const result = await forbidden.ensureProfile();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("forbidden");
  });
});

describe("resolveGateFacts", () => {
  it("maps a complete gate-state row", async () => {
    const { service: identity } = service({
      get_my_gate_state: { data: gateStateRow(), error: null },
    });
    const result = await identity.resolveGateFacts();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.profileId).toBe(PROFILE_ID);
    expect(result.value.hasAthleteCapability).toBe(true);
    expect(result.value.freeEntitlementActive).toBe(true);
    expect(result.value.pinnedTerms).toEqual({
      acceptanceId: TERMS_ACCEPTANCE_ID,
      documentId: TERMS_ID,
      versionLabel: "2026-01",
      actedAt: "2026-02-01T09:00:00.000Z",
    });
    expect(result.value.currentTermsDocumentId).toBe(TERMS_ID);
  });

  it("maps the no-Profile row — a null profile_id, not an empty result", async () => {
    const { service: identity } = service({
      get_my_gate_state: {
        data: gateStateRow({
          profile_id: null,
          display_name: null,
          onboarding_completed_at: null,
          has_athlete_capability: false,
          free_entitlement_active: false,
          pinned_terms_acceptance_id: null,
          pinned_terms_document_id: null,
          pinned_terms_version_label: null,
          pinned_terms_accepted_at: null,
          pinned_privacy_acknowledgement_id: null,
          pinned_privacy_document_id: null,
          pinned_privacy_version_label: null,
          pinned_privacy_acknowledged_at: null,
        }),
        error: null,
      },
    });
    const result = await identity.resolveGateFacts();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.profileId).toBeNull();
      expect(result.value.pinnedTerms).toBeNull();
      expect(result.value.pinnedPrivacy).toBeNull();
    }
  });

  it("INVALIDATES the response when a granting boolean is missing or wrong-typed", async () => {
    // Coercing to `false` would sound fail-closed, and for this field it would be.
    // But it would also let a truncated or renamed response look like an ordinary
    // "no capability yet" answer, hiding the fact that the response could not be
    // read at all.
    for (const value of [null, "true", "false", 1, 0, {}, []]) {
      const { service: identity } = service({
        get_my_gate_state: {
          data: gateStateRow({ has_athlete_capability: value }),
          error: null,
        },
      });
      const result = await identity.resolveGateFacts();
      expect(result.ok, JSON.stringify(value)).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_response");
    }
  });

  it("INVALIDATES the response when a granting boolean is entirely absent", async () => {
    for (const key of ["has_athlete_capability", "free_entitlement_active"]) {
      const row = gateStateRow();
      delete row[key];
      const { service: identity } = service({ get_my_gate_state: { data: row, error: null } });
      const result = await identity.resolveGateFacts();
      expect(result.ok, key).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_response");
    }
  });

  it("distinguishes an ABSENT property from an explicit SQL null", async () => {
    // An explicit null is a real answer; an absent property is a response this
    // build does not know how to read. A real PostgREST row carries every column.
    const withNull = gateStateRow({
      profile_id: null,
      display_name: null,
      onboarding_completed_at: null,
      has_athlete_capability: false,
      free_entitlement_active: false,
      pinned_terms_acceptance_id: null,
      pinned_terms_document_id: null,
      pinned_terms_version_label: null,
      pinned_terms_accepted_at: null,
      pinned_privacy_acknowledgement_id: null,
      pinned_privacy_document_id: null,
      pinned_privacy_version_label: null,
      pinned_privacy_acknowledged_at: null,
    });
    const { service: valid } = service({ get_my_gate_state: { data: withNull, error: null } });
    await expect(valid.resolveGateFacts()).resolves.toMatchObject({ ok: true });

    for (const key of ["profile_id", "display_name", "onboarding_completed_at"]) {
      const truncated = { ...withNull };
      delete truncated[key];
      const { service: identity } = service({
        get_my_gate_state: { data: truncated, error: null },
      });
      const result = await identity.resolveGateFacts();
      expect(result.ok, key).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_response");
    }
  });

  it("treats a THROWING getter as unreadable, not as null", async () => {
    const row = gateStateRow();
    Object.defineProperty(row, "profile_id", {
      get() {
        throw new Error("hostile getter");
      },
      enumerable: true,
      configurable: true,
    });
    const { service: identity } = service({ get_my_gate_state: { data: row, error: null } });
    const result = await identity.resolveGateFacts();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_response");
  });

  it("fails closed on EVERY partial pinned-evidence direction, in both groups", async () => {
    // All four null is a genuine "not completed". All four valid is a completion.
    // Everything between is corruption, and each member is checked even when the
    // acceptance id is null — short-circuiting on it would skip exactly the
    // direction where the acceptance id is the missing one.
    const termsKeys = [
      "pinned_terms_acceptance_id",
      "pinned_terms_document_id",
      "pinned_terms_version_label",
      "pinned_terms_accepted_at",
    ];
    const privacyKeys = [
      "pinned_privacy_acknowledgement_id",
      "pinned_privacy_document_id",
      "pinned_privacy_version_label",
      "pinned_privacy_acknowledged_at",
    ];

    // Direction 1: exactly one member nulled out of an otherwise complete group.
    for (const key of [...termsKeys, ...privacyKeys]) {
      const { service: identity } = service({
        get_my_gate_state: { data: gateStateRow({ [key]: null }), error: null },
      });
      const result = await identity.resolveGateFacts();
      expect(result.ok, `one null: ${key}`).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_response");
    }

    // Direction 2: exactly one member PRESENT in an otherwise all-null group —
    // including the acceptance id itself being the only null.
    for (const group of [termsKeys, privacyKeys]) {
      for (const present of group) {
        const overrides: Record<string, unknown> = {};
        for (const key of group) overrides[key] = null;
        overrides[present] = present.endsWith("_at")
          ? "2026-02-01T09:00:00.000Z"
          : present.endsWith("version_label")
            ? "2026-01"
            : TERMS_ACCEPTANCE_ID;
        const { service: identity } = service({
          get_my_gate_state: { data: gateStateRow(overrides), error: null },
        });
        const result = await identity.resolveGateFacts();
        expect(result.ok, `one present: ${present}`).toBe(false);
      }
    }

    // Direction 3: each member individually wrong-typed rather than null.
    const malformed: Array<[string, unknown]> = [
      ["pinned_terms_acceptance_id", "not-a-uuid"],
      ["pinned_terms_document_id", 7],
      ["pinned_terms_version_label", ""],
      ["pinned_terms_accepted_at", "someday"],
      ["pinned_privacy_acknowledgement_id", {}],
      ["pinned_privacy_version_label", 2026],
    ];
    for (const [key, value] of malformed) {
      const { service: identity } = service({
        get_my_gate_state: { data: gateStateRow({ [key]: value }), error: null },
      });
      expect((await identity.resolveGateFacts()).ok, `malformed: ${key}`).toBe(false);
    }

    // Direction 4: an entirely ABSENT member.
    for (const key of [...termsKeys, ...privacyKeys]) {
      const row = gateStateRow();
      delete row[key];
      const { service: identity } = service({ get_my_gate_state: { data: row, error: null } });
      expect((await identity.resolveGateFacts()).ok, `absent: ${key}`).toBe(false);
    }
  });

  it("a COMPLETED onboarding cannot be reported without both complete evidence groups", async () => {
    // The completion row and both evidence rows are established in one transaction
    // and pinned by composite foreign key, so they exist together or not at all.
    const nulledTerms = gateStateRow({
      pinned_terms_acceptance_id: null,
      pinned_terms_document_id: null,
      pinned_terms_version_label: null,
      pinned_terms_accepted_at: null,
    });
    const { service: missingTerms } = service({
      get_my_gate_state: { data: nulledTerms, error: null },
    });
    const termsResult = await missingTerms.resolveGateFacts();
    expect(termsResult.ok).toBe(false);
    if (!termsResult.ok) expect(termsResult.error.kind).toBe("invalid_response");

    const nulledPrivacy = gateStateRow({
      pinned_privacy_acknowledgement_id: null,
      pinned_privacy_document_id: null,
      pinned_privacy_version_label: null,
      pinned_privacy_acknowledged_at: null,
    });
    const { service: missingPrivacy } = service({
      get_my_gate_state: { data: nulledPrivacy, error: null },
    });
    expect((await missingPrivacy.resolveGateFacts()).ok).toBe(false);

    // And the converse: evidence with no completion timestamp is equally
    // inconsistent.
    const { service: noCompletion } = service({
      get_my_gate_state: { data: gateStateRow({ onboarding_completed_at: null }), error: null },
    });
    expect((await noCompletion.resolveGateFacts()).ok).toBe(false);
  });

  it("capability and the Free entitlement cannot precede completion, WITH a Profile present", async () => {
    // The no-Profile branch below checks its own case, but a row naming a real
    // Profile whose onboarding is incomplete while claiming Athlete capability or an
    // active entitlement is equally impossible — completed onboarding is the sole
    // grant source (ADR-0025 §16). Every one of these must be `invalid_response`,
    // not a partially trusted record.
    const impossible: Array<[string, Record<string, unknown>]> = [
      ["capability", { has_athlete_capability: true, free_entitlement_active: false }],
      ["entitlement", { has_athlete_capability: false, free_entitlement_active: true }],
      ["both", { has_athlete_capability: true, free_entitlement_active: true }],
    ];
    for (const [label, grants] of impossible) {
      const row = gateStateRow({
        // Incomplete, with the matching all-null evidence group, so ONLY the
        // premature grant is wrong.
        onboarding_completed_at: null,
        pinned_terms_acceptance_id: null,
        pinned_terms_document_id: null,
        pinned_terms_version_label: null,
        pinned_terms_accepted_at: null,
        pinned_privacy_acknowledgement_id: null,
        pinned_privacy_document_id: null,
        pinned_privacy_version_label: null,
        pinned_privacy_acknowledged_at: null,
        ...grants,
      });
      const { service: identity } = service({
        get_my_gate_state: { data: row, error: null },
      });
      const result = await identity.resolveGateFacts();
      expect(result.ok, label).toBe(false);
      if (result.ok) return;
      expect(result.error.kind, label).toBe("invalid_response");
    }

    // The same row WITHOUT the premature grant is the ordinary bare-Profile state.
    const legitimate = gateStateRow({
      onboarding_completed_at: null,
      has_athlete_capability: false,
      free_entitlement_active: false,
      pinned_terms_acceptance_id: null,
      pinned_terms_document_id: null,
      pinned_terms_version_label: null,
      pinned_terms_accepted_at: null,
      pinned_privacy_acknowledgement_id: null,
      pinned_privacy_document_id: null,
      pinned_privacy_version_label: null,
      pinned_privacy_acknowledged_at: null,
    });
    const { service: bare } = service({
      get_my_gate_state: { data: legitimate, error: null },
    });
    expect((await bare.resolveGateFacts()).ok).toBe(true);
  });

  it("a later document ROTATION still does not revoke valid pinned evidence", async () => {
    // The invariant above checks PINNED evidence only. `current_*` naming a newer
    // version is a normal, expected state and must remain eligible.
    const rotated = gateStateRow({
      current_terms_document_id: "dddddddd-2222-4222-8222-dddddddddddd",
      current_terms_version_label: "2026-06",
    });
    const { service: identity } = service({ get_my_gate_state: { data: rotated, error: null } });
    const result = await identity.resolveGateFacts();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pinnedTerms?.versionLabel).toBe("2026-01");
    expect(result.value.currentTermsVersionLabel).toBe("2026-06");
    expect(deriveGateEligibility(result.value).kind).toBe("complete");
  });

  it("a null profile_id cannot coexist with any derived fact", async () => {
    const inconsistencies: Array<[string, Record<string, unknown>]> = [
      ["a completion timestamp", { onboarding_completed_at: "2026-02-01T09:00:00.000Z" }],
      ["a display name", { display_name: "Athlete" }],
      ["athlete capability", { has_athlete_capability: true }],
      ["an active entitlement", { free_entitlement_active: true }],
    ];
    for (const [label, overrides] of inconsistencies) {
      const row = gateStateRow({
        profile_id: null,
        display_name: null,
        onboarding_completed_at: null,
        has_athlete_capability: false,
        free_entitlement_active: false,
        pinned_terms_acceptance_id: null,
        pinned_terms_document_id: null,
        pinned_terms_version_label: null,
        pinned_terms_accepted_at: null,
        pinned_privacy_acknowledgement_id: null,
        pinned_privacy_document_id: null,
        pinned_privacy_version_label: null,
        pinned_privacy_acknowledged_at: null,
        ...overrides,
      });
      const { service: identity } = service({ get_my_gate_state: { data: row, error: null } });
      expect((await identity.resolveGateFacts()).ok, label).toBe(false);
    }
  });

  it("fails closed on an inconsistent current* pair", async () => {
    for (const overrides of [
      { current_terms_document_id: null },
      { current_terms_version_label: null },
      { current_terms_document_id: "not-a-uuid" },
    ]) {
      const { service: identity } = service({
        get_my_gate_state: { data: gateStateRow(overrides), error: null },
      });
      const result = await identity.resolveGateFacts();
      expect(result.ok, JSON.stringify(overrides)).toBe(false);
    }
  });

  it("accepts a genuinely absent current* pair", async () => {
    const { service: identity } = service({
      get_my_gate_state: {
        data: gateStateRow({
          current_terms_document_id: null,
          current_terms_version_label: null,
          current_privacy_document_id: null,
          current_privacy_version_label: null,
        }),
        error: null,
      },
    });
    const result = await identity.resolveGateFacts();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.currentTermsDocumentId).toBeNull();
  });

  it("fails closed on a missing row, a non-object row and a bad profile id", async () => {
    for (const data of [null, undefined, [], "row", 7, gateStateRow({ profile_id: "nope" })]) {
      const { service: identity } = service({ get_my_gate_state: { data, error: null } });
      const result = await identity.resolveGateFacts();
      expect(result.ok, JSON.stringify(data)).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_response");
    }
  });

  it("accepts a one-element array, and REFUSES zero, duplicate or additional rows", async () => {
    // A composite contract permits an object or a one-element array. Silently
    // taking `[0]` from a longer response would let two different Profiles be read
    // as one.
    const { service: single } = service({
      get_my_gate_state: { data: [gateStateRow()], error: null },
    });
    await expect(single.resolveGateFacts()).resolves.toMatchObject({ ok: true });

    const invalidArrays: Array<[string, unknown[]]> = [
      ["zero rows", []],
      ["duplicate rows", [gateStateRow(), gateStateRow()]],
      ["an additional differing row", [gateStateRow(), gateStateRow({ profile_id: PRIVACY_ID })]],
      ["a nested array", [[gateStateRow()]]],
      ["a non-object row", ["row"]],
    ];
    for (const [label, data] of invalidArrays) {
      const { service: identity } = service({ get_my_gate_state: { data, error: null } });
      const result = await identity.resolveGateFacts();
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_response");
    }
  });
});

describe("completeOnboarding", () => {
  it("passes the display name and the two ids from the validated snapshot objects", async () => {
    const { service: identity, calls } = service({
      get_current_legal_documents: { data: [legalRow(), PRIVACY_ROW], error: null },
      complete_personal_onboarding: { data: gateStateRow(), error: null },
    });
    const snapshot = await identity.getLegalSnapshot();
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const terms = snapshot.value.terms;
    const privacy = snapshot.value.privacy;
    if (terms === null || privacy === null) throw new Error("snapshot incomplete");

    const result = await identity.completeOnboarding({ displayName: "Athlete", terms, privacy });

    expect(result.ok).toBe(true);
    expect(calls[calls.length - 1]).toEqual({
      name: "complete_personal_onboarding",
      args: {
        p_display_name: "Athlete",
        p_terms_document_id: TERMS_ID,
        p_privacy_document_id: PRIVACY_ID,
      },
    });
  });

  it("maps every RPC-raised kind", async () => {
    const cases = [
      ["profile_required: Set up your profile before continuing.", "profile_required"],
      ["invalid_input: Enter a display name.", "invalid_input"],
      ["stale_legal_version: The legal documents were updated.", "stale_legal_version"],
      ["legal_unavailable: Legal documents are unavailable right now.", "legal_unavailable"],
      ["conflict: Onboarding could not be completed. Try again.", "conflict"],
      ["forbidden: Sign in to continue.", "forbidden"],
    ] as const;
    for (const [message, expected] of cases) {
      const { service: identity } = service({
        get_current_legal_documents: { data: [legalRow(), PRIVACY_ROW], error: null },
        complete_personal_onboarding: { data: null, error: { message } },
      });
      const snapshot = await identity.getLegalSnapshot();
      if (!snapshot.ok || snapshot.value.terms === null || snapshot.value.privacy === null) {
        throw new Error("snapshot incomplete");
      }
      const result = await identity.completeOnboarding({
        displayName: "Athlete",
        terms: snapshot.value.terms,
        privacy: snapshot.value.privacy,
      });
      expect(result.ok, message).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe(expected);
    }
  });
});

describe("the never-throw contract", () => {
  it("contains a rejecting rpc for every method, with no thrown value escaping", async () => {
    const thrown = [new Error("transport exploded"), "a thrown string", Symbol("boom"), null];
    for (const value of thrown) {
      const { service: identity } = service({
        get_current_legal_documents: () => {
          throw value;
        },
        ensure_my_profile: () => {
          throw value;
        },
        get_my_gate_state: () => {
          throw value;
        },
        complete_personal_onboarding: () => {
          throw value;
        },
      });
      const legal = await identity.getLegalSnapshot();
      const profile = await identity.ensureProfile();
      const facts = await identity.resolveGateFacts();
      expect(legal.ok).toBe(false);
      expect(profile.ok).toBe(false);
      expect(facts.ok).toBe(false);
      for (const result of [legal, profile, facts]) {
        if (result.ok) continue;
        expect(result.error.kind).toBe("unexpected_error");
        expect(JSON.stringify(result)).not.toContain("transport exploded");
      }
    }
  });

  it("contains an error object whose own message getter throws", async () => {
    const hostileError = {
      get message(): string {
        throw new Error("hostile getter");
      },
    };
    const { service: identity } = service({
      get_my_gate_state: { data: null, error: hostileError },
    });
    const result = await identity.resolveGateFacts();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unexpected_error");
  });

  it("a Proxy-backed row whose traps throw INVALIDATES the response", async () => {
    // The earlier expectation here — that such a row truthfully means "nothing is
    // granted" — was wrong. A row whose every field is unreadable is not a row
    // reporting an unonboarded account; it is a response that could not be read.
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile trap");
        },
        has() {
          throw new Error("hostile trap");
        },
        getOwnPropertyDescriptor() {
          throw new Error("hostile trap");
        },
        ownKeys() {
          throw new Error("hostile trap");
        },
      }
    );
    const { service: identity } = service({ get_my_gate_state: { data: proxy, error: null } });

    const result = await identity.resolveGateFacts();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_response");
    expect(JSON.stringify(result)).not.toContain("hostile");
  });

  it("a REVOKED Proxy array is contained rather than throwing", async () => {
    // `Array.isArray` itself throws on a revoked proxy, so even the type test needs
    // containment.
    const revocable = Proxy.revocable([gateStateRow()], {});
    revocable.revoke();
    const { service: identity } = service({
      get_my_gate_state: { data: revocable.proxy, error: null },
    });
    await expect(identity.resolveGateFacts()).resolves.toMatchObject({
      ok: false,
      error: { kind: "invalid_response" },
    });

    const revocableLegal = Proxy.revocable([legalRow(), PRIVACY_ROW], {});
    revocableLegal.revoke();
    const { service: legal } = service({
      get_current_legal_documents: { data: revocableLegal.proxy, error: null },
    });
    await expect(legal.getLegalSnapshot()).resolves.toMatchObject({
      ok: false,
      error: { kind: "invalid_legal_response" },
    });
  });

  it("a hostile array whose length or index getters throw is contained", async () => {
    const throwingLength = new Proxy([gateStateRow()], {
      get(target, property, receiver) {
        if (property === "length") throw new Error("hostile length");
        return Reflect.get(target, property, receiver);
      },
    });
    const { service: lengthy } = service({
      get_my_gate_state: { data: throwingLength, error: null },
    });
    await expect(lengthy.resolveGateFacts()).resolves.toMatchObject({ ok: false });

    const throwingIndex = new Proxy([gateStateRow()], {
      get(target, property, receiver) {
        if (property === "0") throw new Error("hostile index");
        return Reflect.get(target, property, receiver);
      },
    });
    const { service: indexed } = service({
      get_my_gate_state: { data: throwingIndex, error: null },
    });
    await expect(indexed.resolveGateFacts()).resolves.toMatchObject({ ok: false });
  });

  it("a hostile Symbol.iterator cannot influence traversal, because traversal is by index", async () => {
    const rows: unknown[] = [legalRow(), PRIVACY_ROW];
    Object.defineProperty(rows, Symbol.iterator, {
      value: () => {
        throw new Error("hostile iterator");
      },
      configurable: true,
    });
    const { service: identity } = service({
      get_current_legal_documents: { data: rows, error: null },
    });
    const result = await identity.getLegalSnapshot();
    expect(result.ok).toBe(true);
  });

  it("a Proxy-backed Profile row DOES fail closed, because a Profile id cannot be read", async () => {
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile trap");
        },
      }
    );
    const { service: identity } = service({ ensure_my_profile: { data: proxy, error: null } });
    const result = await identity.ensureProfile();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_response");
  });

  it("does not inspect, log or forward a caught value", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const { service: identity } = service({
      get_my_gate_state: () => {
        throw new Error("must not be logged");
      },
    });
    await identity.resolveGateFacts();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    consoleLog.mockRestore();
  });
});
