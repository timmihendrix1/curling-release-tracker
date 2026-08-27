// The safe Legal-document URL boundary (ADR-0025 §17). This is the load-bearing
// check — the database's regular expression is defence in depth and cannot parse a
// URL — so the rejection matrix here is the thing that decides whether a value may
// ever be rendered as an `href`.
import { describe, expect, it } from "vitest";
import { parseSafeLegalUrl } from "../safeLegalUrl";

const CONTROL_CHARACTER = String.fromCharCode(0x0a);
const TAB_CHARACTER = String.fromCharCode(0x09);

describe("parseSafeLegalUrl — the rejection matrix", () => {
  const rejected: Array<[string, unknown]> = [
    ["javascript: scheme", "javascript:alert(1)"],
    ["javascript: scheme with a plausible host", "javascript://example.invalid/legal"],
    ["data: scheme", "data:text/html,<h1>terms</h1>"],
    ["blob: scheme", "blob:https://example.invalid/9f0"],
    ["file: scheme", "file:///etc/terms"],
    ["http: scheme", "http://example.invalid/legal/terms"],
    ["protocol-relative", "//example.invalid/legal/terms"],
    ["base-relative absolute path", "/legal/terms"],
    ["base-relative bare path", "legal/terms"],
    ["credentialed", "https://user:pass@example.invalid/legal/terms"],
    ["username only", "https://user@example.invalid/legal/terms"],
    ["bare word", "example.invalid"],
    ["empty string", ""],
    ["leading whitespace", " https://example.invalid/legal/terms"],
    ["trailing whitespace", "https://example.invalid/legal/terms "],
    ["embedded space", "https://example.invalid/legal /terms"],
    ["embedded newline", `https://example.invalid/legal${CONTROL_CHARACTER}terms`],
    ["embedded tab", `https://example.invalid/legal${TAB_CHARACTER}terms`],
    ["percent-encoded newline", "https://example.invalid/legal%0aterms"],
    ["percent-encoded tab", "https://example.invalid/legal%09terms"],
    ["percent-encoded NUL", "https://example.invalid/legal%00terms"],
    ["percent-encoded DEL", "https://example.invalid/legal%7fterms"],
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["boolean", true],
    ["object", { href: "https://example.invalid/legal/terms" }],
    ["array", ["https://example.invalid/legal/terms"]],
    ["URL instance rather than a string", new URL("https://example.invalid/legal/terms")],
  ];

  for (const [label, value] of rejected) {
    it(`rejects ${label}`, () => {
      expect(parseSafeLegalUrl(value)).toBeNull();
    });
  }

  it("rejects an empty authority", () => {
    expect(parseSafeLegalUrl("https://")).toBeNull();
  });

  it("rejects an extra authority slash, which WHATWG parsing would otherwise read as a host", () => {
    // `new URL("https:///legal/terms")` succeeds with hostname "legal". It is a
    // valid URL but not one anybody wrote, and the database's check constraint
    // refuses it — so the mapper refuses it too rather than diverging.
    expect(new URL("https:///legal/terms").hostname).toBe("legal");
    expect(parseSafeLegalUrl("https:///legal/terms")).toBeNull();
  });

  it("rejects an upper-case scheme rather than normalizing it", () => {
    // `new URL` lower-cases the protocol, so a protocol-only check would accept
    // this. The database constraint would not.
    expect(new URL("HTTPS://example.invalid/legal").protocol).toBe("https:");
    expect(parseSafeLegalUrl("HTTPS://example.invalid/legal")).toBeNull();
  });

  it("never throws, whatever it is handed", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile get trap");
        },
      }
    );
    expect(() => parseSafeLegalUrl(hostile)).not.toThrow();
    expect(parseSafeLegalUrl(hostile)).toBeNull();
    expect(() => parseSafeLegalUrl(Symbol("hostile"))).not.toThrow();
  });
});

describe("parseSafeLegalUrl — acceptance", () => {
  it("accepts a plain https host and path", () => {
    const raw = "https://example.invalid/legal/terms-fixture";
    expect(parseSafeLegalUrl(raw)).toBe(raw);
  });

  it("accepts an explicit port, a query and a percent-encoded space", () => {
    for (const raw of [
      "https://example.invalid:8443/legal/terms",
      "https://example.invalid/legal/terms?version=1",
      "https://example.invalid/legal/terms%20of%20service",
    ]) {
      expect(parseSafeLegalUrl(raw), raw).toBe(raw);
    }
  });

  it("returns the raw string unchanged, never a normalized re-serialization", () => {
    // `new URL(...).toString()` would append a trailing slash here. Returning the
    // caller's own string is what keeps "what was rendered" identical to "what the
    // response contained".
    const raw = "https://example.invalid";
    expect(parseSafeLegalUrl(raw)).toBe(raw);
  });
});
