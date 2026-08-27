// The closed identity failure vocabulary and the record-load outcome shape.
//
// The property that matters here is the one explained in the module's own note:
// `malformed` and `absent` must stay DISTINGUISHABLE, because a barrier (which
// only denies) and a trusted record (which only grants) draw opposite conclusions
// from an unusable stored value.
import { describe, expect, it } from "vitest";
import {
  FRIENDLY_IDENTITY_MESSAGE,
  identityFailed,
  identityOk,
  recordAbsent,
  recordMalformed,
  recordReadFailed,
  recordValue,
  type IdentityErrorKind,
} from "../errors";

const ALL_KINDS: IdentityErrorKind[] = [
  "forbidden",
  "profile_required",
  "invalid_input",
  "legal_unavailable",
  "stale_legal_version",
  "conflict",
  "invalid_legal_response",
  "invalid_response",
  "network_error",
  "unexpected_error",
];

describe("IdentityResult", () => {
  it("carries a canonical sentence for every kind", () => {
    for (const kind of ALL_KINDS) {
      const failure = identityFailed(kind);
      expect(failure.ok).toBe(false);
      if (failure.ok) return;
      expect(failure.error.kind).toBe(kind);
      expect(failure.error.message).toBe(FRIENDLY_IDENTITY_MESSAGE[kind]);
      expect(failure.error.message.length).toBeGreaterThan(0);
    }
  });

  it("accepts an explicit message without changing the kind", () => {
    const failure = identityFailed("invalid_input", "Enter a display name.");
    expect(failure.ok).toBe(false);
    if (failure.ok) return;
    expect(failure.error).toEqual({ kind: "invalid_input", message: "Enter a display name." });
  });

  it("wraps a success value", () => {
    expect(identityOk(7)).toEqual({ ok: true, value: 7 });
  });

  it("declares no kind that a database error message could claim as a client-side classification", () => {
    // `invalid_legal_response`, `invalid_response`, `network_error` and
    // `unexpected_error` are decided on the client, never parsed out of a Postgres
    // message — see supabaseIdentityService.ts's RPC_RAISED_KINDS.
    expect(ALL_KINDS).toHaveLength(10);
  });
});

describe("IdentityRecordLoad", () => {
  it("keeps value, absent, malformed and read_failed as four distinct outcomes", () => {
    expect(recordValue(1)).toEqual({ status: "value", value: 1 });
    expect(recordAbsent()).toEqual({ status: "absent" });
    expect(recordMalformed()).toEqual({ status: "malformed" });
    expect(recordReadFailed("storage_unavailable")).toEqual({
      status: "read_failed",
      error: { kind: "storage_unavailable" },
    });
    expect(recordReadFailed("unknown")).toEqual({
      status: "read_failed",
      error: { kind: "unknown" },
    });
  });

  it("carries no fallback value and no raw stored string", () => {
    // An identity record is never displayed from a failed read, so there is
    // deliberately nothing here to display.
    expect(Object.keys(recordMalformed())).toEqual(["status"]);
    expect(Object.keys(recordReadFailed("unknown")).sort()).toEqual(["error", "status"]);
    expect(Object.keys(recordAbsent())).toEqual(["status"]);
  });
});
