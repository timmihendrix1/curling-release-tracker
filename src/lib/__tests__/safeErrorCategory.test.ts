// Direct unit coverage for safeErrorCategory (docs/adr/0022 §Sanitized Operational
// Logging, fourth correction pass): every returned value must be a hard-coded
// literal, never anything read off the caught error — proven here by throwing
// deliberately sensitive-looking values into every field a naive implementation
// might have been tempted to read (`message`, `name`, `code`, `status`) and
// asserting the exact literal returned never contains any of that text.
import { describe, expect, it } from "vitest";
import { safeErrorCategory } from "../safeErrorCategory";

const SENSITIVE_EMAIL = "invitee@example.com";
const SENSITIVE_TOKEN = "rawInvitationToken123abcXYZ";
const SENSITIVE_OTP = "482913";

function assertNeverLeaks(result: string) {
  expect(result).not.toContain(SENSITIVE_EMAIL);
  expect(result).not.toContain(SENSITIVE_TOKEN);
  expect(result).not.toContain(SENSITIVE_OTP);
  expect(result).not.toContain("@");
}

describe("safeErrorCategory — never returns a runtime-controlled value", () => {
  it("an Error whose name contains an email address and a raw invitation token still returns the hard-coded 'Error' literal", () => {
    const err = new Error("generic message");
    err.name = `${SENSITIVE_EMAIL} ${SENSITIVE_TOKEN}`;
    const result = safeErrorCategory(err);
    expect(result).toBe("Error");
    assertNeverLeaks(result);
  });

  it("a custom Error subclass whose name was overwritten to a sensitive value still returns the hard-coded 'Error' literal", () => {
    class CustomProviderError extends Error {}
    const err = new CustomProviderError("some detail");
    err.name = SENSITIVE_TOKEN;
    const result = safeErrorCategory(err);
    expect(result).toBe("Error");
    assertNeverLeaks(result);
  });

  it("a plain object whose code contains an alphanumeric token returns only 'provider_error'", () => {
    const err = { code: SENSITIVE_TOKEN };
    const result = safeErrorCategory(err);
    expect(result).toBe("provider_error");
    assertNeverLeaks(result);
  });

  it("a plain object whose string status resembles a secret/OTP returns only 'provider_error'", () => {
    const err = { status: SENSITIVE_OTP };
    const result = safeErrorCategory(err);
    expect(result).toBe("provider_error");
    assertNeverLeaks(result);
  });

  it("a plain object whose numeric status resembles an OTP returns only 'provider_error', never the number", () => {
    const err = { status: 482913 };
    const result = safeErrorCategory(err);
    expect(result).toBe("provider_error");
    expect(result).not.toContain("482913");
  });

  it("a plain object whose message contains sensitive text returns only 'provider_error'", () => {
    const err = { message: `Authentication failed for ${SENSITIVE_EMAIL} with token ${SENSITIVE_TOKEN}` };
    const result = safeErrorCategory(err);
    expect(result).toBe("provider_error");
    assertNeverLeaks(result);
  });

  it("classifies an ordinary TypeError distinctly from a generic Error", () => {
    expect(safeErrorCategory(new TypeError("x"))).toBe("TypeError");
    expect(safeErrorCategory(new RangeError("x"))).toBe("RangeError");
    expect(safeErrorCategory(new SyntaxError("x"))).toBe("SyntaxError");
    expect(safeErrorCategory(new ReferenceError("x"))).toBe("ReferenceError");
    expect(safeErrorCategory(new URIError("x"))).toBe("URIError");
  });

  it("classifies a plain Error (or an unrecognized Error subclass) as the generic 'Error' literal", () => {
    expect(safeErrorCategory(new Error("plain"))).toBe("Error");
    class SomeUnrelatedErrorSubclass extends Error {}
    expect(safeErrorCategory(new SomeUnrelatedErrorSubclass("x"))).toBe("Error");
  });

  it("classifies primitive and unknown thrown values as 'unknown_error', never echoing them", () => {
    expect(safeErrorCategory(SENSITIVE_TOKEN)).toBe("unknown_error");
    expect(safeErrorCategory(482913)).toBe("unknown_error");
    expect(safeErrorCategory(null)).toBe("unknown_error");
    expect(safeErrorCategory(undefined)).toBe("unknown_error");
    expect(safeErrorCategory(true)).toBe("unknown_error");
    expect(safeErrorCategory({})).toBe("unknown_error");
    expect(safeErrorCategory({ unrelatedField: SENSITIVE_TOKEN })).toBe("unknown_error");
  });

  it("never returns a value containing the character-restricted 'code' text even when it matches the old safe-character pattern", () => {
    // A value that would have passed the OLD implementation's character/length
    // regex (alphanumeric, <= 40 chars) but is still a genuine secret-shaped value —
    // proving the fix isn't merely a stricter pattern, but the complete removal of
    // any field-value passthrough.
    const err = { code: "sb_secret_abcdef0123456789" };
    const result = safeErrorCategory(err);
    expect(result).toBe("provider_error");
    expect(result).not.toContain("sb_secret_abcdef0123456789");
  });
});

describe("safeErrorCategory — total and non-throwing against hostile Proxy reflection traps (fifth correction pass)", () => {
  it("a Proxy whose getPrototypeOf trap throws never escapes — classification fails closed to 'unknown_error'", () => {
    // `err instanceof TypeError` (and every other instanceof check) walks the
    // prototype chain via `Object.getPrototypeOf`, which invokes this trap.
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(`proxy trap escaped: ${SENSITIVE_TOKEN} ${SENSITIVE_EMAIL}`);
        },
      }
    );
    let result: string | undefined;
    expect(() => {
      result = safeErrorCategory(hostile);
    }).not.toThrow();
    expect(result).toBe("unknown_error");
    assertNeverLeaks(result!);
  });

  it("a Proxy whose has trap throws never escapes — classification fails closed to 'unknown_error'", () => {
    // getPrototypeOf resolves normally here (so every instanceof check completes,
    // finds no match, and falls through) — only the `in` operator inside
    // isProviderErrorShape's presence check reaches this trap.
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          return Object.prototype;
        },
        has() {
          throw new Error(`proxy trap escaped: ${SENSITIVE_TOKEN} ${SENSITIVE_OTP}`);
        },
      }
    );
    let result: string | undefined;
    expect(() => {
      result = safeErrorCategory(hostile);
    }).not.toThrow();
    expect(result).toBe("unknown_error");
    assertNeverLeaks(result!);
  });

  it("a Proxy whose BOTH getPrototypeOf and has traps throw never escapes", () => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(`getPrototypeOf escaped: ${SENSITIVE_TOKEN}`);
        },
        has() {
          throw new Error(`has escaped: ${SENSITIVE_TOKEN}`);
        },
      }
    );
    let result: string | undefined;
    expect(() => {
      result = safeErrorCategory(hostile);
    }).not.toThrow();
    expect(result).toBe("unknown_error");
    assertNeverLeaks(result!);
  });

  it("a Proxy wrapping a genuine Error-like target with sensitive-looking values still categorizes safely, transparently (no throwing traps)", () => {
    const sensitiveError = new Error("generic message");
    sensitiveError.name = SENSITIVE_TOKEN;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sensitiveError as any).code = SENSITIVE_TOKEN;
    // No trap overrides at all — default Proxy behavior transparently forwards
    // getPrototypeOf/has to the real Error target, so `instanceof Error` succeeds
    // normally (no adversarial trap involved in this case).
    const wrapped = new Proxy(sensitiveError, {});
    const result = safeErrorCategory(wrapped);
    expect(result).toBe("Error");
    assertNeverLeaks(result);
  });

  it("a Proxy wrapping a plain provider-shaped object with sensitive code/status still categorizes safely (no throwing traps)", () => {
    const wrapped = new Proxy({ code: SENSITIVE_TOKEN, status: SENSITIVE_OTP }, {});
    const result = safeErrorCategory(wrapped);
    expect(result).toBe("provider_error");
    assertNeverLeaks(result);
  });
});
