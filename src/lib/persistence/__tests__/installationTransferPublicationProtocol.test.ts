import { afterEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { serializePublicationAnchor, parsePublicationAnchor, publicationAnchorSlot, hashPublicationValue, MAX_PUBLICATION_ASCII } from "../installationTransferPublicationProtocol";
import { encodeTransferCodeUnits, decodeTransferCodeUnits } from "../installationTransferCodeUnits";
import { parseCredentialPhysicalSlot } from "../credentialPhysicalSlots";
const profile = "10000000-0000-4000-8000-000000000001";
const anchor = () => ({ schemaVersion: 1, protocol: "curling-installation-publication-v1", publicationId: "50000000-0000-4000-8000-000000000005", providerConfigIdentity: "pc1:synthetic", sessionStorageKey: "sb-synthetic-auth-token", sdkContractVersion: "auth-js/2.112.3:credential-v1", protocolId: "10000000-0000-4000-8000-000000000001", credentialEpochId: "20000000-0000-4000-8000-000000000002", manifestId: "30000000-0000-4000-8000-000000000003", storeIdentity: "40000000-0000-4000-8000-000000000004", packageDigest: "a".repeat(64), sourceDenialDigest: "b".repeat(64), protectedWireDigest: "c".repeat(64), preparedDigest: "d".repeat(64), profiles: [profile], selectedProfileId: profile, accountScopeId: "synthetic-account", controlRevision: 4, workingLayout: "installation-live-ascii-v1" });
afterEach(() => vi.unstubAllGlobals());
it("roundtrips exact bounded canonical data without granting generic slot access", () => {
  const raw = serializePublicationAnchor(anchor())!; expect(parsePublicationAnchor(raw)).toEqual(anchor());
  expect(parseCredentialPhysicalSlot("pc1:synthetic", "sb-synthetic-auth-token", publicationAnchorSlot("pc1:synthetic")).ok).toBe(false);
});
it.each(["missing", "extra", "reordered", "duplicate", "whitespace", "version", "enum", "negative_zero", "ids", "digest", "profiles", "selection", "scope", "digest_newline", "id_newline", "profile_newline"])("refuses noncanonical %s", kind => {
  const a: Record<string, unknown> = anchor(); let json = decodeTransferCodeUnits(serializePublicationAnchor(a)!);
  if (kind === "missing") delete a.packageDigest;
  if (kind === "extra") a.extra = false;
  if (kind === "version") a.schemaVersion = 2;
  if (kind === "enum") a.workingLayout = "other";
  if (kind === "ids") a.publicationId = a.protocolId;
  if (kind === "digest") a.packageDigest = "A".repeat(64);
  if (kind === "profiles") a.profiles = [profile, profile];
  if (kind === "selection") a.selectedProfileId = "90000000-0000-4000-8000-000000000009";
  if (kind === "scope") a.accountScopeId = "x".repeat(257);
  if (kind === "digest_newline") a.packageDigest = "a".repeat(64) + "\n";
  if (kind === "id_newline") a.publicationId = String(a.publicationId) + "\n";
  if (kind === "profile_newline") { a.profiles = [profile + "\n"]; a.selectedProfileId = profile + "\n"; }
  if (kind === "reordered") json = JSON.stringify(Object.fromEntries(Object.entries(a).reverse()));
  else if (kind === "duplicate") json = json.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
  else if (kind === "whitespace") json += " ";
  else if (kind === "negative_zero") json = json.replace('"controlRevision":4', '"controlRevision":-0');
  else json = JSON.stringify(a);
  expect(parsePublicationAnchor(encodeTransferCodeUnits(json))).toBeNull();
});
it("admits all 32 Profiles and maximally escaped scope within the declared budget", () => {
  const a = anchor(); a.providerConfigIdentity = "pc1:" + "x".repeat(64); a.accountScopeId = "\ud800".repeat(256);
  a.profiles = Array.from({ length: 32 }, (_, i) => `${(i + 1).toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`).sort(); a.selectedProfileId = a.profiles[0];
  const raw = serializePublicationAnchor(a); expect(raw).not.toBeNull(); expect(raw!.length).toBeLessThanOrEqual(MAX_PUBLICATION_ASCII); expect(parsePublicationAnchor(raw)?.profiles).toHaveLength(32);
});
it("rejects getters/toJSON and does not invoke foreign coercion", () => {
  let called = false; const a = anchor(); Object.defineProperty(a, "accountScopeId", { get() { called = true; return "bad"; } });
  expect(serializePublicationAnchor(a)).toBeNull(); expect(called).toBe(false);
});
it.each(["wire", "prepared", "anchor", "source"] as const)("hashes actual framed %s with the standard platform entry", async kind => {
  vi.stubGlobal("crypto", webcrypto); const values = kind === "prepared" || kind === "source" ? ["a".repeat(64), "[]"] : ["synthetic"];
  const tag = kind === "wire" ? "installation-published-wire/v1" : kind === "prepared" ? "installation-published-sporting/v1" : kind === "source" ? "installation-source-denial/v2" : "installation-publication-anchor/v1";
  expect(await hashPublicationValue(kind, values, () => false, () => true)).toBe(createHash("sha256").update(JSON.stringify([tag, ...values])).digest("hex"));
});
it("excludes its own outward hash completion before adopting digest work", async () => {
  vi.stubGlobal("crypto", { subtle: { digest: () => hash } });
  const hash = hashPublicationValue("anchor", ["synthetic"], () => false, () => true); expect(await hash).toBeNull();
});
it("refuses escaped over-budget inputs before issuing crypto", async () => {
  const digest = vi.fn(); vi.stubGlobal("crypto", { subtle: { digest } });
  expect(await hashPublicationValue("anchor", ['"'.repeat(MAX_PUBLICATION_ASCII)], () => false, () => true)).toBeNull(); expect(digest).not.toHaveBeenCalled();
});

it("bounds the new fixed source frame before crypto and preserves cancellation", async () => {
  const digest = vi.fn(); vi.stubGlobal("crypto", { subtle: { digest } });
  for (const values of [["a".repeat(64)], ["x", "u16:"], ["a".repeat(64), "x".repeat(4 + 4 * 1048576 + 1)], ["a".repeat(64), "é"]]) {
    expect(await hashPublicationValue("source", values, () => false, () => true)).toBeNull();
  }
  expect(await hashPublicationValue("source", ["a".repeat(64), "u16:"], () => false, () => false)).toBeNull();
  expect(digest).not.toHaveBeenCalled();
});
