import { describe, expect, it } from "vitest";
import { credentialItemSlot, credentialManifestSlot, parseCredentialPhysicalSlot } from "../credentialPhysicalSlots";
import { fixedCredentialSlots, type Result } from "../../supabase/providerCredentialContract";

const config = "pc1:fixture", root = "sb-fixture-auth-token";
const epoch = "12345678-1234-4234-8234-123456789abc";
function value<T>(result: Result<T>): T { if (!result.ok) throw new Error("fixture rejected"); return result.value; }

describe("inactive credential physical slots", () => {
  it("roundtrips every fixed kind and min/max dynamic flow at min/max roots/configs", () => {
    for (const id of ["pc1:a", "pc1:" + "a".repeat(64), "pc1:a..._-9"]) {
      for (const sdkRoot of ["sb-a-auth-token", "sb-" + "a".repeat(63) + "-auth-token"]) {
        const manifest = value(credentialManifestSlot(id));
        expect(manifest).toBe(`m1.${id.length.toString(16).padStart(2, "0")}.${id}`);
        expect(parseCredentialPhysicalSlot(id, sdkRoot, manifest)).toEqual({ ok: true, value: { kind: "manifest" } });
        const keys = [...fixedCredentialSlots(sdkRoot).map(slot => slot.key), ...["aB_-1234", "a".repeat(64)].map(flow => `${sdkRoot}-flow-${flow}-code-verifier`)];
        const slots = keys.map(key => value(credentialItemSlot(id, sdkRoot, epoch, key)));
        expect(new Set(slots).size).toBe(keys.length);
        slots.forEach((slot, i) => {
          expect(slot.length).toBeLessThanOrEqual(178);
          expect(/^[\x20-\x7e]+$/.test(slot)).toBe(true);
          const parsed = value(parseCredentialPhysicalSlot(id, sdkRoot, slot));
          expect(parsed).toEqual({ kind: "item", epoch, key: keys[i] });
          expect(Object.isFrozen(parsed)).toBe(true);
        });
      }
    }
    expect(value(credentialManifestSlot("pc1:" + "a".repeat(64))).length).toBe(74);
    expect(value(credentialItemSlot("pc1:" + "a".repeat(64), root, epoch, `${root}-flow-${"a".repeat(64)}-code-verifier`)).length).toBe(178);
  });
  it("length-prefixes dotted configs without ambiguous selector/config/epoch joins", () => {
    const configs = ["pc1:a", "pc1:a.s", "pc1:a.f.abcdefgh", "pc1:a.12345678-1234-4234-8234-123456789abc"];
    const slots = configs.flatMap(id => [value(credentialManifestSlot(id)), value(credentialItemSlot(id, root, epoch, root))]);
    expect(new Set(slots).size).toBe(slots.length);
    for (const id of configs) for (const slot of slots) {
      expect(parseCredentialPhysicalSlot(id, root, slot).ok).toBe(slot.includes(`.${id.length.toString(16).padStart(2, "0")}.${id}`));
    }
  });
  it("preserves any canonical epoch for the later full-inventory owner", () => {
    for (const id of [epoch, "12345678-1234-1234-9234-123456789abc", "12345678-1234-8234-b234-123456789abc"]) {
      expect(value(parseCredentialPhysicalSlot(config, root, value(credentialItemSlot(config, root, id, root))))).toEqual({ kind: "item", epoch: id, key: root });
    }
  });
  it("does not claim root identity: same config/epoch requires the owner's injective assignment", () => {
    const other = "sb-other-auth-token";
    const slot = value(credentialItemSlot(config, root, epoch, root));
    expect(value(credentialItemSlot(config, other, epoch, other))).toBe(slot);
    expect(value(parseCredentialPhysicalSlot(config, other, slot))).toEqual({ kind: "item", epoch, key: other });
  });
  it("refuses malformed config/root/epoch/flow and unsupported keys without canonicalization", () => {
    for (const id of ["", "pc1:", "pc1:A", "pc1:_x", "pc1:a\n", "pc1:a\r", "pc1:é", "pc1:" + "a".repeat(65)]) expect(credentialManifestSlot(id).ok).toBe(false);
    for (const sdkRoot of ["", root + "\n", root + "\r", "sb-A-auth-token", "sb--a-auth-token", "sb-" + "a".repeat(64) + "-auth-token"]) expect(credentialItemSlot(config, sdkRoot, epoch, sdkRoot).ok).toBe(false);
    for (const id of [epoch.toUpperCase(), epoch + "\n", epoch.replace("-4234-", "-0234-"), epoch.replace("-8234-", "-7234-"), epoch.slice(1)]) expect(credentialItemSlot(config, root, id, root).ok).toBe(false);
    for (const key of ["sb-other-auth-token", root + "-unknown", root + "-flow-short-code-verifier", root + "-flow-abcdefgh\n-code-verifier", root + "-flow-" + "a".repeat(65) + "-code-verifier", "x".repeat(193)]) expect(credentialItemSlot(config, root, epoch, key).ok).toBe(false);
  });
  it("refuses unknown, legacy, other-config and noncanonical physical names instead of hiding them", () => {
    const slot = value(credentialItemSlot(config, root, epoch, root));
    const prefix = slot.slice(0, -1);
    for (const name of [root, "", "m2.0b.pc1:fixture", "m1.b.pc1:fixture", "m1.0B.pc1:fixture", "m1.0c.pc1:fixture", value(credentialManifestSlot("pc1:other")), slot + "\n", slot + ".extra", prefix + "f.short", prefix + "unknown", prefix + "f.abcdefgh\n", slot.replace(epoch, epoch.toUpperCase()), "x".repeat(179)]) {
      expect(parseCredentialPhysicalSlot(config, root, name).ok, name).toBe(false);
    }
  });
  it("does not coerce or reflect hostile nonprimitive inputs", () => {
    const hostile = new Proxy({}, { get() { throw new Error("PRIVATE"); }, ownKeys() { throw null; } });
    for (const input of [undefined, null, false, 1, [], {}, new String(config), hostile]) {
      expect(credentialManifestSlot(input)).toEqual({ ok: false, issue: { code: "invalid_input", field: "input" } });
      expect(credentialItemSlot(config, root, epoch, input).ok).toBe(false);
      expect(parseCredentialPhysicalSlot(config, input, "").ok).toBe(false);
      expect(parseCredentialPhysicalSlot(config, root, input).ok).toBe(false);
    }
  });
});
