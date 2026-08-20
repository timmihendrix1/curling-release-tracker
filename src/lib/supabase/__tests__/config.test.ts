import { describe, expect, it } from "vitest";
import { resolveCloudConfig } from "../config";

const VALID_URL = "https://example.supabase.co";
const VALID_KEY = "sb_publishable_abcdefghijklmnopqrstuvwxyz";

describe("resolveCloudConfig", () => {
  it("resolves cloud_disabled when neither variable is supplied", () => {
    expect(resolveCloudConfig(undefined, undefined)).toEqual({ status: "cloud_disabled" });
  });

  it("resolves cloud_disabled when both variables are empty strings", () => {
    expect(resolveCloudConfig("", "  ")).toEqual({ status: "cloud_disabled" });
  });

  it("resolves configured for a valid URL/publishable-key pair", () => {
    expect(resolveCloudConfig(VALID_URL, VALID_KEY)).toEqual({
      status: "configured",
      url: VALID_URL,
      publishableKey: VALID_KEY,
    });
  });

  it("trims surrounding whitespace from a valid pair", () => {
    expect(resolveCloudConfig(`  ${VALID_URL}  `, `  ${VALID_KEY}  `)).toEqual({
      status: "configured",
      url: VALID_URL,
      publishableKey: VALID_KEY,
    });
  });

  it("resolves invalid_configuration when the URL is missing but the key is present", () => {
    expect(resolveCloudConfig(undefined, VALID_KEY)).toEqual({
      status: "invalid_configuration",
      reason: "missing_url",
    });
  });

  it("resolves invalid_configuration when the key is missing but the URL is present", () => {
    expect(resolveCloudConfig(VALID_URL, undefined)).toEqual({
      status: "invalid_configuration",
      reason: "missing_publishable_key",
    });
  });

  it("resolves invalid_configuration for a malformed URL", () => {
    expect(resolveCloudConfig("not-a-url", VALID_KEY)).toEqual({
      status: "invalid_configuration",
      reason: "malformed_url",
    });
  });

  it("resolves invalid_configuration for a URL with an unsupported protocol", () => {
    expect(resolveCloudConfig("ftp://example.supabase.co", VALID_KEY)).toEqual({
      status: "invalid_configuration",
      reason: "malformed_url",
    });
  });

  it("resolves invalid_configuration for a too-short publishable key", () => {
    expect(resolveCloudConfig(VALID_URL, "short")).toEqual({
      status: "invalid_configuration",
      reason: "invalid_publishable_key",
    });
  });

  it("resolves invalid_configuration for a publishable key containing whitespace", () => {
    expect(resolveCloudConfig(VALID_URL, "sb_publishable abcdefghijklmno")).toEqual({
      status: "invalid_configuration",
      reason: "invalid_publishable_key",
    });
  });

  it("resolves invalid_configuration for a whitespace-only key (after trimming, missing)", () => {
    expect(resolveCloudConfig(VALID_URL, "   ")).toEqual({
      status: "invalid_configuration",
      reason: "missing_publishable_key",
    });
  });

  describe("secret-key and other non-publishable shapes must fail closed", () => {
    it("rejects a service-role/secret key (sb_secret_...) even though it is long and whitespace-free", () => {
      expect(
        resolveCloudConfig(VALID_URL, "sb_secret_abcdefghijklmnopqrstuvwxyz")
      ).toEqual({
        status: "invalid_configuration",
        reason: "invalid_publishable_key",
      });
    });

    it("rejects a legacy JWT-shaped anon/service key", () => {
      const jwtShaped =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MTYxNjIzOTAyMn0.abcdefghijklmnopqrstuvwxyz";
      expect(resolveCloudConfig(VALID_URL, jwtShaped)).toEqual({
        status: "invalid_configuration",
        reason: "invalid_publishable_key",
      });
    });

    it("rejects an arbitrary long whitespace-free string with no recognizable key shape", () => {
      expect(resolveCloudConfig(VALID_URL, "x".repeat(60))).toEqual({
        status: "invalid_configuration",
        reason: "invalid_publishable_key",
      });
    });

    it("rejects a publishable-prefixed key whose suffix is too short", () => {
      expect(resolveCloudConfig(VALID_URL, "sb_publishable_short")).toEqual({
        status: "invalid_configuration",
        reason: "invalid_publishable_key",
      });
    });

    it("never resolves configured for any rejected key shape (so no client is ever constructed for one)", () => {
      const rejected = [
        "sb_secret_abcdefghijklmnopqrstuvwxyz",
        "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature",
        "x".repeat(60),
        "   ",
        "sb_publishable_short",
      ];
      for (const key of rejected) {
        expect(resolveCloudConfig(VALID_URL, key).status).not.toBe("configured");
      }
    });
  });

  it("defaults to reading NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY when called with no arguments", () => {
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = VALID_URL;
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = VALID_KEY;
      expect(resolveCloudConfig()).toEqual({
        status: "configured",
        url: VALID_URL,
        publishableKey: VALID_KEY,
      });
    } finally {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
    }
  });
});
