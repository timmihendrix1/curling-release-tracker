// The `InteractiveAuthAttempt` record (ADR-0025 §5, §10). Two invariants are
// STRUCTURAL here, and both are asserted at the type level as well as at runtime:
// `barrierId` is never null, and `flowId` is required for `google` and null for
// `email_otp`.
import { describe, expect, it } from "vitest";
import {
  INTERACTIVE_ATTEMPT_SCHEMA_VERSION,
  INTERACTIVE_ATTEMPT_STORAGE_KEY,
  createEmailOtpAttempt,
  createGoogleAttempt,
  validateInteractiveAuthAttempt,
  type InteractiveAuthAttempt,
} from "../interactiveAttempt";

const ATTEMPT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const BARRIER_ID = "11111111-1111-4111-8111-111111111111";
const FLOW_ID = "flow-selector-x-0000000000000000";
const NOW = "2026-03-01T10:00:00.000Z";

function googleRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    attemptId: ATTEMPT_ID,
    method: "google",
    flowId: FLOW_ID,
    barrierId: BARRIER_ID,
    capturedIdentityGeneration: 1,
    startedAt: NOW,
    ...overrides,
  };
}

function otpRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...googleRecord(), method: "email_otp", flowId: null, ...overrides };
}

describe("the two constructors enforce the method/selector pairing", () => {
  it("createGoogleAttempt requires a selector and always sets method 'google'", () => {
    const attempt = createGoogleAttempt({
      attemptId: ATTEMPT_ID,
      flowId: FLOW_ID,
      barrierId: BARRIER_ID,
      capturedIdentityGeneration: 7,
      startedAt: NOW,
    });
    expect(attempt.method).toBe("google");
    expect(attempt.flowId).toBe(FLOW_ID);
    expect(attempt.capturedIdentityGeneration).toBe(7);
    expect(INTERACTIVE_ATTEMPT_SCHEMA_VERSION).toBe(1);
  });

  it("createEmailOtpAttempt has no selector parameter at all and always sets null", () => {
    const attempt = createEmailOtpAttempt({
      attemptId: ATTEMPT_ID,
      barrierId: BARRIER_ID,
      capturedIdentityGeneration: 1,
      startedAt: NOW,
    });
    expect(attempt.method).toBe("email_otp");
    expect(attempt.flowId).toBeNull();
  });

  it("has a stable, versioned storage key", () => {
    expect(INTERACTIVE_ATTEMPT_STORAGE_KEY).toBe("curling.identity.interactiveAttempt.v1");
  });
});

describe("type-level: no attempt with a null barrierId can be constructed", () => {
  it("neither constructor accepts a null or missing barrierId", () => {
    const google = createGoogleAttempt({
      attemptId: ATTEMPT_ID,
      flowId: FLOW_ID,
      // @ts-expect-error barrierId is `string`, never `string | null`
      barrierId: null,
      capturedIdentityGeneration: 1,
      startedAt: NOW,
    });
    expect(google.barrierId).toBeNull();

    const withoutBarrier = { attemptId: ATTEMPT_ID, capturedIdentityGeneration: 1, startedAt: NOW };
    // @ts-expect-error barrierId is a required parameter
    const otp = createEmailOtpAttempt(withoutBarrier);
    expect(otp.flowId).toBeNull();
  });

  it("the record type itself rejects a null barrierId", () => {
    const attempt: InteractiveAuthAttempt = {
      schemaVersion: 1,
      attemptId: ATTEMPT_ID,
      method: "google",
      flowId: FLOW_ID,
      // @ts-expect-error `barrierId` is `string`, so `null` is not assignable
      barrierId: null,
      capturedIdentityGeneration: 1,
      startedAt: NOW,
    };
    expect(attempt.attemptId).toBe(ATTEMPT_ID);
  });

  it("a Google attempt cannot be built with a null selector", () => {
    const attempt: InteractiveAuthAttempt = {
      schemaVersion: 1,
      attemptId: ATTEMPT_ID,
      method: "google",
      flowId: null,
      barrierId: BARRIER_ID,
      capturedIdentityGeneration: 1,
      startedAt: NOW,
    };
    // The TYPE permits it (both methods share one shape), which is exactly why the
    // constructors and the validator enforce the pairing — asserted below.
    expect(validateInteractiveAuthAttempt(JSON.parse(JSON.stringify(attempt)))).toBeNull();
  });
});

describe("validateInteractiveAuthAttempt — acceptance", () => {
  it("accepts a well-formed Google attempt and a well-formed OTP attempt", () => {
    expect(validateInteractiveAuthAttempt(googleRecord())?.flowId).toBe(FLOW_ID);
    expect(validateInteractiveAuthAttempt(otpRecord())?.flowId).toBeNull();
  });

  it("accepts a captured generation of zero", () => {
    expect(
      validateInteractiveAuthAttempt(googleRecord({ capturedIdentityGeneration: 0 }))
        ?.capturedIdentityGeneration
    ).toBe(0);
  });
});

describe("validateInteractiveAuthAttempt — fail-closed rejection", () => {
  const rejected: Array<[string, unknown]> = [
    ["a wrong schemaVersion", googleRecord({ schemaVersion: 2 })],
    ["a non-canonical attemptId", googleRecord({ attemptId: "attempt-1" })],
    ["a null barrierId", googleRecord({ barrierId: null })],
    ["a missing barrierId", (() => { const r = googleRecord(); delete r.barrierId; return r; })()],
    ["a non-canonical barrierId", googleRecord({ barrierId: "barrier" })],
    ["an unknown method", googleRecord({ method: "magic_link" })],
    ["a null method", googleRecord({ method: null })],
    ["a google attempt with a null selector", googleRecord({ flowId: null })],
    ["a google attempt with a missing selector", (() => { const r = googleRecord(); delete r.flowId; return r; })()],
    ["a google attempt with an empty selector", googleRecord({ flowId: "" })],
    ["a google attempt with a whitespace-carrying selector", googleRecord({ flowId: "flow id" })],
    ["a google attempt with an over-long selector", googleRecord({ flowId: "x".repeat(65) })],
    ["an OTP attempt carrying a selector", otpRecord({ flowId: FLOW_ID })],
    ["an OTP attempt with a missing selector key", (() => { const r = otpRecord(); delete r.flowId; return r; })()],
    ["a fractional generation", googleRecord({ capturedIdentityGeneration: 1.5 })],
    ["a negative generation", googleRecord({ capturedIdentityGeneration: -1 })],
    ["a null generation", googleRecord({ capturedIdentityGeneration: null })],
    ["an unparseable startedAt", googleRecord({ startedAt: "soon" })],
    ["a non-object", "attempt"],
    ["null", null],
    ["an array", [googleRecord()]],
  ];

  for (const [label, value] of rejected) {
    it(`rejects ${label}`, () => {
      expect(validateInteractiveAuthAttempt(value)).toBeNull();
    });
  }

  it("never throws for a hostile source", () => {
    const proxy = new Proxy({}, { get() { throw "a thrown string"; } });
    expect(() => validateInteractiveAuthAttempt(proxy)).not.toThrow();
    expect(validateInteractiveAuthAttempt(proxy)).toBeNull();
  });
});
