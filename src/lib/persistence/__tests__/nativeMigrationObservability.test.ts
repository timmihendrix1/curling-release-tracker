// Stage M3b4c — the runner's narrow observability extension.
//
// EVIDENCE CLASS M: the REAL source binding, target capability, evidence
// collector and runner over the plugin-faithful engine and a disposable
// synthetic WebView store. Fingerprints are the labelled synthetic digests.
//
// What is asserted: a halted plan names the cause its failing step had ALREADY
// observed (`halt.observed`), a blocked/access report names the validated
// record's phase (`recordPhase`), and neither carries a key name, value or
// identifier. The extension adds no read, write, digest or reopen — the
// unchanged M3b4b suites pin behaviour and call order, and a one-time
// differential run against the pre-extension runner is recorded in
// docs/MOBILE_APP_MIGRATION.md §7, "M3b4c implementation status".
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MigrationSourceStore } from "../localStorageAdapter";
import type { NativeMigrationRunReport } from "../nativeMigrationRunner";
import { BASE_SOURCE, ELIGIBLE_BASE, KEY_SESSION, fp } from "./nativeMigrationTestKit";
import {
  PLATFORMS,
  RECORD_KEY,
  boot,
  device,
  reachCopying,
  reachVerified,
  runToRest,
  type Device,
} from "./nativeMigrationMTestKit";

afterEach(() => vi.unstubAllGlobals());

const PROFILE_FRAGMENT = KEY_SESSION.split(".")[3];
const SORTED = [...ELIGIBLE_BASE].sort();

function observedOf(report: NativeMigrationRunReport): string | undefined {
  if (report.outcome !== "halted" || report.halt.kind !== "plan_run") return undefined;
  return report.halt.observed;
}

function expectNoIdentifiers(report: NativeMigrationRunReport): void {
  const added = JSON.stringify({
    observed: observedOf(report),
    recordPhase: "recordPhase" in report ? report.recordPhase : undefined,
  });
  expect(added).not.toContain(PROFILE_FRAGMENT);
  expect(added).not.toContain("curling.");
  expect(added).not.toContain("fp:");
}

/** Wraps `listKeys` so the n-th call (1-based) runs `act` first, or fails. */
function onListKeys(n: number, act: "fail" | ((d: Device) => void), d: Device) {
  return (source: MigrationSourceStore): MigrationSourceStore => {
    let calls = 0;
    return {
      ...source,
      listKeys: async () => {
        calls += 1;
        if (calls === n) {
          if (act === "fail") return { status: "read_failed" } as Awaited<ReturnType<MigrationSourceStore["listKeys"]>>;
          act(d);
        }
        return source.listKeys();
      },
      readValue: (key) => source.readValue(key),
      readMarker: () => source.readMarker(),
      writeMarkerIfAbsent: (value) => source.writeMarkerIfAbsent(value),
    };
  };
}

describe.each(PLATFORMS)("halt observations through the real runner (%s)", (platform) => {
  it("AP-D3's read step: a failed enumeration is `source_listing_failed`", async () => {
    const d = device(platform, BASE_SOURCE);
    const report = await (await boot(d, { wrapSource: onListKeys(2, "fail", d) })).run();
    expect(report.outcome).toBe("halted");
    expect(observedOf(report)).toBe("source_listing_failed");
    expectNoIdentifiers(report);
  });

  it("the entry-key recheck: failed enumeration versus a positively missing key", async () => {
    const failed = device(platform, BASE_SOURCE);
    const r1 = await (await boot(failed, { wrapSource: onListKeys(3, "fail", failed) })).run();
    expect(observedOf(r1)).toBe("recheck_enumeration_failed");
    const missing = device(platform, BASE_SOURCE);
    const r2 = await (await boot(missing, { wrapSource: onListKeys(3, (dev) => dev.storage.map.delete(KEY_SESSION), missing) })).run();
    expect(observedOf(r2)).toBe("entry_key_missing");
    expectNoIdentifiers(r2);
  });

  it("a value read: unreadable versus listed-then-absent", async () => {
    const unreadable = device(platform, BASE_SOURCE);
    unreadable.storage.faults.getItemThrows = (key) => key === KEY_SESSION;
    expect(observedOf(await (await boot(unreadable)).run())).toBe("source_value_unreadable");
    const absent = device(platform, BASE_SOURCE);
    absent.storage.faults.beforeGetItem = (key, storage) => {
      if (key === KEY_SESSION) storage.map.delete(KEY_SESSION);
    };
    expect(observedOf(await (await boot(absent)).run())).toBe("listed_value_absent");
  });

  it("a digest: unavailable versus malformed", async () => {
    const unavailable = await (await boot(device(platform, BASE_SOURCE), { fingerprint: () => Promise.reject(new Error("no digest")) })).run();
    expect(observedOf(unavailable)).toBe("digest_unavailable");
    const malformed = await (await boot(device(platform, BASE_SOURCE), { fingerprint: () => "not-a-fingerprint" })).run();
    expect(observedOf(malformed)).toBe("digest_malformed");
  });

  it("AP-COPY: a manifest key gone at the batch read is `planned_value_absent`; a changed value is `batch_digest_mismatch`", async () => {
    const batchKey = SORTED[0];
    for (const [mutation, expected] of [
      [(storage: Device["storage"]) => storage.map.delete(batchKey), "planned_value_absent"],
      [(storage: Device["storage"]) => storage.map.set(batchKey, "changed after validation"), "batch_digest_mismatch"],
    ] as const) {
      const d = device(platform, BASE_SOURCE);
      await reachCopying(d, 0);
      let reads = 0;
      d.storage.faults.beforeGetItem = (key, storage) => {
        if (key !== batchKey) return;
        reads += 1;
        // The first read is the evidence collector's; the second is the plan's.
        if (reads === 2) mutation(storage);
      };
      const report = await (await boot(d)).run();
      expect(report.outcome, JSON.stringify(report)).toBe("halted");
      expect(observedOf(report)).toBe(expected);
      expectNoIdentifiers(report);
    }
  });

  it("AP-ACT's final validation: a changed value is `source_validation_diverged`", async () => {
    const d = device(platform, BASE_SOURCE);
    await reachVerified(d);
    let reads = 0;
    d.storage.faults.beforeGetItem = (key, storage) => {
      if (key !== KEY_SESSION) return;
      reads += 1;
      if (reads === 2) storage.map.set(KEY_SESSION, "raced");
    };
    const report = await (await boot(d)).run();
    expect(report.outcome).toBe("halted");
    expect(observedOf(report)).toBe("source_validation_diverged");
  });

  it("AP-CC/AP-ACT in-transaction evidence: mismatch, unavailable and malformed are distinguished", async () => {
    const cases: Array<[(value: string) => string | Promise<string>, string]> = [
      [() => fp("tampered inside the transaction"), "target_evidence_mismatch"],
      [() => Promise.reject(new Error("digest gone")), "target_evidence_unavailable"],
      [() => "not-a-fingerprint", "digest_malformed"],
    ];
    for (const [armedDigest, expected] of cases) {
      const d = device(platform, BASE_SOURCE);
      await reachVerified(d);
      let armed = false;
      const p = await boot(d, {
        fingerprint: (value) => (armed ? armedDigest(value) : fp(value)),
        // Arm only once the activation transaction has begun, so the evidence
        // collector and the plan's source reads see the honest digests.
        faults: { gate: (call) => { if (call.kind === "begin") armed = true; } },
      });
      const report = await p.run();
      expect(report.outcome, JSON.stringify(report)).toBe("halted");
      if (report.outcome !== "halted") return;
      expect(report.transaction).toMatchObject({ status: "not_committed", reason: "evidence_mismatch", writeIssued: false });
      expect(observedOf(report)).toBe(expected);
    }
  });

  it("an in-transaction read failure carries the adapter's reason and no verifier observation", async () => {
    const d = device(platform, BASE_SOURCE);
    await reachVerified(d);
    let inside = false;
    const p = await boot(d, {
      faults: {
        gate: (call) => { if (call.kind === "begin") inside = true; },
        onQuery: (statement) => (inside && /^SELECT value FROM records/.test(statement) ? { reject: true } : undefined),
      },
    });
    const report = await p.run();
    expect(report.outcome, JSON.stringify(report)).toBe("halted");
    if (report.outcome !== "halted") return;
    expect(report.transaction).toMatchObject({ status: "not_committed", reason: "evidence_unreadable", writeIssued: false });
    expect(observedOf(report)).toBeUndefined();
  });
});

describe.each(PLATFORMS)("recordPhase (%s)", (platform) => {
  it("is the validated phase a blocked decision was made from, `no_record`, or omitted", async () => {
    const copying = device(platform, BASE_SOURCE);
    await reachCopying(copying, 2);
    copying.storage.map.set(KEY_SESSION, "changed");
    const blocked = await (await boot(copying)).run();
    expect(blocked).toMatchObject({ outcome: "blocked", rule: "E′7", recordPhase: "copying" });
    expectNoIdentifiers(blocked);

    const populated = device(platform, BASE_SOURCE);
    populated.state.tables.add("records");
    populated.state.rows.set(SORTED[0], "stray row");
    const noRecord = await (await boot(populated)).run();
    expect(noRecord).toMatchObject({ outcome: "blocked", rule: "PV2", recordPhase: "no_record" });

    const malformed = device(platform, BASE_SOURCE);
    malformed.state.tables.add("records");
    malformed.state.rows.set(RECORD_KEY, "{not json");
    const a2 = await (await boot(malformed)).run();
    expect(a2.outcome).toBe("blocked");
    expect("recordPhase" in a2).toBe(false);
  });

  it("an access report carries `active`", async () => {
    const report = await runToRest(await boot(device(platform, BASE_SOURCE)));
    expect(report).toMatchObject({ outcome: "access", rule: "B4", recordPhase: "active" });
  });

});
