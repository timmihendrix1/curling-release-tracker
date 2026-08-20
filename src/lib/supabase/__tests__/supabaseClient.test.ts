// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseBrowserClient, resetSupabaseBrowserClientForTests } from "../supabaseClient";
import type { ConfiguredCloudConfig } from "../config";

const CONFIG_A: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://a.supabase.co",
  publishableKey: "sb_publishable_aaaaaaaaaaaaaaaaaaaa",
};
const CONFIG_B: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://b.supabase.co",
  publishableKey: "sb_publishable_bbbbbbbbbbbbbbbbbbbb",
};

afterEach(() => {
  resetSupabaseBrowserClientForTests();
});

describe("getSupabaseBrowserClient", () => {
  it("constructs a client for a valid configured config", () => {
    const client = getSupabaseBrowserClient(CONFIG_A);
    expect(client).toBeDefined();
    expect(client.auth).toBeDefined();
  });

  it("returns the same cached instance for the same configuration", () => {
    const first = getSupabaseBrowserClient(CONFIG_A);
    const second = getSupabaseBrowserClient(CONFIG_A);
    expect(second).toBe(first);
  });

  it("constructs a fresh client when the configuration changes", () => {
    const first = getSupabaseBrowserClient(CONFIG_A);
    const second = getSupabaseBrowserClient(CONFIG_B);
    expect(second).not.toBe(first);
  });
});
