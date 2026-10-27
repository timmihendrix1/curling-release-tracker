import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountDeletionGuardRepository, DELETION_GUARD_PREFIX, DELETION_GUARD_RESOLUTION_PREFIX, isAccountDeletionGuardStorageKey, isAccountDeletionGuardResolutionStorageKey } from "../../identity/accountDeletionGuard";
import { classifyMigrationSourceKey, isUnsupportedMigrationIdentityControlKey } from "../nativeMigrationEligibility";
import { validateSourceAgainstManifest } from "../nativeMigrationDecision";
import { applicationRows, boot, commitReaches, committedRecord, device, once, PLATFORMS, reachCopying, reachEnumerating, reachVerified, runToRest } from "./nativeMigrationMTestKit";
import { BASE_SOURCE, fp, isSyntheticFingerprint, PROFILE_A, PROFILE_B, BARRIER, verifiedBytes } from "./nativeMigrationTestKit";
import { evaluateActivationRecord } from "../nativeMigrationRecord";

const guardKey = DELETION_GUARD_PREFIX + PROFILE_A + ".v1";
const resolutionKey = DELETION_GUARD_RESOLUTION_PREFIX + BARRIER + ".v1";
const guardRaw = ' {"schemaVersion":1,"profileId":"' + PROFILE_A + '","nonce":"' + BARRIER + '","revision":4} ';
const resolutionRaw = JSON.stringify({ schemaVersion: 1, profileId: PROFILE_A, nonce: BARRIER, fencedRevision: 5 });
const unsupported = DELETION_GUARD_PREFIX + PROFILE_A + ".v2";
afterEach(() => vi.unstubAllGlobals());

describe("deletion-control key membership remains pure", () => {
  it("admits exactly two distinct UUID/version families without coercing hostile inputs", () => {
    expect(isAccountDeletionGuardStorageKey(guardKey)).toBe(true);
    expect(isAccountDeletionGuardResolutionStorageKey(resolutionKey)).toBe(true);
    expect(classifyMigrationSourceKey(guardKey)).toEqual({ eligible: true, family: "identity_deletion_guard" });
    expect(classifyMigrationSourceKey(resolutionKey)).toEqual({ eligible: true, family: "identity_deletion_resolution" });
    expect(isAccountDeletionGuardStorageKey(resolutionKey)).toBe(false);
    const hostile = new Proxy({}, { get() { throw new Error("must not inspect"); } });
    for (const value of [null, undefined, hostile, new String(guardKey), 1, [], "", unsupported, guardKey + "\n", guardKey + ".extra", guardKey.replace(PROFILE_A, "NOT-A-UUID"), guardKey.replace(".v1", ".v01")]) {
      expect(isAccountDeletionGuardStorageKey(value)).toBe(false);
      expect(isAccountDeletionGuardResolutionStorageKey(value)).toBe(false);
    }
  });
  it("refuses unsupported owned controls in the shared full-manifest validator", () => {
    const record = evaluateActivationRecord(verifiedBytes(BASE_SOURCE), isSyntheticFingerprint);
    if (!record.ok) throw new Error("fixture");
    const listed = Object.entries(BASE_SOURCE).map(([key, raw]) => ({ key, fingerprint: { status: "computed" as const, value: fp(raw) } }));
    expect(validateSourceAgainstManifest(record.record, [...listed, { key: unsupported, fingerprint: { status: "computed", value: fp("opaque") } }], isSyntheticFingerprint)).toEqual({ status: "failed", findings: [{ rule: "C1", code: "unsupported_identity_control" }] });
    expect(isUnsupportedMigrationIdentityControlKey(unsupported)).toBe(true);
    expect(isUnsupportedMigrationIdentityControlKey("foreign." + unsupported)).toBe(false);
  });
});

describe.each(PLATFORMS)("%s dormant D migration preserves denial evidence", platform => {
  for (const [label, source, admits] of [
    ["unresolved guard", { [guardKey]: guardRaw }, false],
    ["resolved guard", { [guardKey]: guardRaw, [resolutionKey]: resolutionRaw }, true],
    ["orphan resolution", { [resolutionKey]: resolutionRaw }, true],
    ["malformed opaque guard", { [guardKey]: "not JSON\u0000🥌" }, false],
    ["mismatched receipt", { [guardKey]: guardRaw, [resolutionKey]: resolutionRaw.replace(PROFILE_A, PROFILE_B) }, false],
  ] as const) {
    it(`copies ${label} byte-exactly and preserves real destination repository admission`, async () => {
      const d = device(platform, source), p = await boot(d);
      const report = await runToRest(p);
      expect(report.outcome).toBe("access");
      expect(report.completedPlans.some(plan => plan.name === "D1")).toBe(false);
      expect(applicationRows(d)).toEqual(source);
      expect(committedRecord(d)?.entryKeys).toEqual(Object.keys(source).sort());
      expect(await p.runner.dispose()).toEqual({ ok: true });
      // Real adapter opens again after the lease's positive close/release.
      const guards = createAccountDeletionGuardRepository(p.store.adapter);
      expect(await guards.canAdmit(PROFILE_A)).toBe(admits);
      expect(await p.store.close()).toEqual({ ok: true });
    });
  }
  it("refuses malformed owned keys before reading their values or writing D", async () => {
    const d = device(platform, { [unsupported]: "must not read" });
    const report = await (await boot(d)).run();
    expect(report.outcome).toBe("blocked");
    if (report.outcome === "blocked") expect(report.findings.map(f => f.code)).toContain("unsupported_identity_control");
    expect(d.storage.valueReads).not.toContain(unsupported);
    expect(committedRecord(d)).toBeNull(); expect(applicationRows(d)).toEqual({});
  });
  for (const phase of ["copying", "verified"] as const) {
    for (const fault of ["held", "failed"] as const) {
      it(`refuses an initially listed malformed control before any ${fault} source read/digest in ${phase}`, async () => {
        const d = device(platform, { [guardKey]: guardRaw });
        if (phase === "copying") await reachCopying(d, 0); else await reachVerified(d);
        // Sorts AFTER the valid guard: a per-entry guard is insufficient.
        const malformed = DELETION_GUARD_RESOLUTION_PREFIX + "zz.v2";
        d.storage.map.set(malformed, "PRIVATE_OPAQUE_CONTROL");
        const before = new Map(d.state.rows);
        const sourceRead = vi.fn(async () => {
          if (fault === "held") return new Promise<never>(() => {});
          throw new Error("must not begin a source value operation");
        });
        const digest = vi.fn((value: string) => fp(value));
        const p = await boot(d, { wrapSource: source => ({ ...source, readValue: sourceRead }), fingerprint: digest });
        const report = await p.run();
        expect(report.outcome).toBe("blocked");
        if (report.outcome === "blocked") expect(report.findings[0]).toEqual({ rule: "C1", code: "unsupported_identity_control" });
        expect(sourceRead).not.toHaveBeenCalled();
        // Independent target evidence is still collected in verified state.
        expect(digest).toHaveBeenCalledTimes(phase === "verified" ? 1 : 0);
        expect(d.storage.valueReads).not.toContain(malformed);
        expect(d.state.rows).toEqual(before);
        expect(JSON.stringify(report)).not.toContain("PRIVATE_OPAQUE_CONTROL");
      });
    }
  }
  for (const [label, prepare] of [["enumerating", reachEnumerating], ["verified", reachVerified]] as const) {
    it(`halts a late malformed key observed in a fresh ${label} inventory before progress/activation`, async () => {
      const d = device(platform, { [guardKey]: guardRaw }); await prepare(d);
      let before = new Map(d.state.rows); let listings = 0;
      const p = await boot(d, { wrapSource: source => ({ ...source, listKeys: async () => {
        listings++; if (listings === 2) { d.storage.map.set(unsupported, "late opaque"); before = new Map(d.state.rows); }
        return source.listKeys();
      } }) });
      const report = await p.run();
      expect(report.outcome).toBe("halted");
      if (report.outcome === "halted" && report.halt.kind === "plan_run") expect(report.halt.observed).toBe("unsupported_identity_control");
      expect(d.storage.valueReads).not.toContain(unsupported);
      expect(d.state.rows).toEqual(before);
      const next = await p.run(); expect(next.outcome).toBe("blocked");
    });
  }
  it("catches malformed addition at the second entry-key enumeration", async () => {
    const d = device(platform, { [guardKey]: guardRaw }); await reachEnumerating(d);
    let listings = 0, before = new Map(d.state.rows);
    const p = await boot(d, { wrapSource: source => ({ ...source, listKeys: async () => {
      listings++; if (listings === 3) { d.storage.map.set(unsupported, "late opaque"); before = new Map(d.state.rows); }
      return source.listKeys();
    } }) });
    const report = await p.run(); expect(report.outcome).toBe("halted");
    if (report.outcome === "halted" && report.halt.kind === "plan_run") expect(report.halt.observed).toBe("unsupported_identity_control");
    expect(d.state.rows).toEqual(before);
  });
  for (const effect of ["reject_before_effect", "reject_after_effect"] as const) {
    it(`recovers an uncertain guard checkpoint with ${effect} without losing either control`, async () => {
      const source = { [guardKey]: guardRaw, [resolutionKey]: resolutionRaw };
      const d = device(platform, source);
      const p = await boot(d, { faults: { onCommit: once(commitReaches("copying", rows => (JSON.parse(rows.get("curling.nativeMigration.activationRecord.v1")!)?.copied?.length ?? 0) > 0), effect, "ok") } });
      const halted = await p.run(); expect(halted.outcome).toBe("halted");
      expect((await runToRest(p)).outcome).toBe("access");
      expect(applicationRows(d)).toEqual(source);
    });
  }
  it("keeps a vanished recorded denial key blocked across restart", async () => {
    const d = device(platform, { [guardKey]: guardRaw, [resolutionKey]: resolutionRaw, ...BASE_SOURCE });
    await reachCopying(d, 0); d.storage.map.delete(guardKey);
    const report = await (await boot(d)).run(); expect(report.outcome).toBe("blocked");
    expect(committedRecord(d)?.phase).toBe("copying");
  });
  it("keeps B4 source-free even with unsupported source residue after activation", async () => {
    const d = device(platform, { [guardKey]: guardRaw }), p = await boot(d);
    expect((await runToRest(p)).outcome).toBe("access");
    d.storage.map.set(unsupported, "preserve"); d.storage.faults.lengthThrows = true;
    const reads = d.storage.valueReads.length;
    expect((await p.run()).outcome).toBe("access");
    expect(d.storage.valueReads.length).toBe(reads);
  });
});
