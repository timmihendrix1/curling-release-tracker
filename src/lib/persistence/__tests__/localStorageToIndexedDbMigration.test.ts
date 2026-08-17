// @vitest-environment jsdom
//
// jsdom (rather than the default node environment) is deliberate here: it provides a
// real `localStorage`, letting the "localStorage source remains byte-for-byte
// unchanged" and repository-equivalence tests exercise the actual production
// localStorage-backed adapter, not a hand-rolled stand-in — while fake-indexeddb/auto
// still installs a fully working `indexedDB` global on top of jsdom exactly as it does
// under the default node environment.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { openDB } from "idb";
import {
  createIndexedDbAdapter,
  createIndexedDbMigrationTarget,
  INDEXED_DB_VERSION,
  METADATA_STORE_NAME,
  RECORDS_STORE_NAME,
  buildMigrationMarkerKey,
} from "../indexedDbAdapter";
import { createLocalStorageAdapter } from "../localStorageAdapter";
import type { PersistenceReadError, StorageAdapter, StorageGetResult } from "../types";
import {
  MIGRATION_DOMAINS,
  runLocalStorageToIndexedDbMigration,
  type MigrationDomainId,
} from "../localStorageToIndexedDbMigration";
import { createSessionRepository } from "../../sessionRepository";
import { createAssessmentRepository } from "../../assessment/repository";
import { createAssessmentPreferencesRepository } from "../../assessmentPreferencesRepository";

function freshDatabaseName(label: string): string {
  return `test-migration-run-${label}-${Math.floor(Math.random() * 1e9)}`;
}

const ALL_SOURCE_KEYS = MIGRATION_DOMAINS.flatMap((d) => d.sourceKeys);

/** A deterministic in-memory StorageAdapter double — used where a test needs precise
 * control over which key fails and how, which a real localStorage instance can't give
 * us as cleanly. */
function createFakeSourceAdapter(initial: Record<string, string> = {}): StorageAdapter & {
  values: Map<string, string>;
  failOnGet: Set<string>;
  getCalls: string[];
  setCalls: string[];
} {
  const values = new Map(Object.entries(initial));
  const failOnGet = new Set<string>();
  const getCalls: string[] = [];
  const setCalls: string[] = [];
  return {
    values,
    failOnGet,
    getCalls,
    setCalls,
    async get(key: string): Promise<StorageGetResult> {
      getCalls.push(key);
      if (failOnGet.has(key)) {
        const error: PersistenceReadError = { kind: "unknown", message: `induced failure: ${key}` };
        return { status: "read_failed", fallback: null, error };
      }
      return { status: "value", value: values.has(key) ? values.get(key)! : null };
    },
    async set(key: string) {
      setCalls.push(key);
      throw new Error("the migration engine must never call source.set");
    },
  };
}

/** Replaces every UUID-v4-shaped substring with a fixed placeholder — used only to
 * compare two independent migration-function outputs that each fabricate their own
 * fresh random IDs (e.g. Legacy Block creation, ADR-0005) from the same input, where
 * the IDs themselves are expected to differ but everything else must not. */
function normalizeGeneratedIds(value: unknown): string {
  return JSON.stringify(value).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "<generated-id>"
  );
}

async function readAllMetadataKeys(databaseName: string): Promise<string[]> {
  const db = await openDB(databaseName, INDEXED_DB_VERSION);
  const keys = await db.getAllKeys(METADATA_STORE_NAME);
  db.close();
  return keys as string[];
}

/** Unlike `readAllMetadataKeys`, reads every marker's full stored *value* too — used
 * where a test must prove the complete marker (protocolVersion/domain/status/
 * sourceKeys), not merely that a key with the right name exists. */
async function readAllMetadata(databaseName: string): Promise<Record<string, unknown>> {
  const db = await openDB(databaseName, INDEXED_DB_VERSION);
  const keys = (await db.getAllKeys(METADATA_STORE_NAME)) as string[];
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = await db.get(METADATA_STORE_NAME, key);
  }
  db.close();
  return result;
}

async function readAllRecords(databaseName: string): Promise<Record<string, string>> {
  const db = await openDB(databaseName, INDEXED_DB_VERSION);
  const keys = (await db.getAllKeys(RECORDS_STORE_NAME)) as string[];
  const result: Record<string, string> = {};
  for (const key of keys) {
    result[key] = await db.get(RECORDS_STORE_NAME, key);
  }
  db.close();
  return result;
}

describe("runLocalStorageToIndexedDbMigration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has no storage side effects merely from being imported or constructed", async () => {
    const openSpy = vi.spyOn(globalThis.indexedDB, "open");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    try {
      vi.resetModules();
      const mod = await import("../localStorageToIndexedDbMigration");
      expect(openSpy).not.toHaveBeenCalled();
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(getItemSpy).not.toHaveBeenCalled();

      // Merely referencing the exported domain table and building options objects
      // (no call to runLocalStorageToIndexedDbMigration) must still touch nothing.
      expect(mod.MIGRATION_DOMAINS.length).toBe(7);
      expect(openSpy).not.toHaveBeenCalled();
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(getItemSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
      setItemSpy.mockRestore();
      getItemSpy.mockRestore();
      vi.resetModules();
    }
  });

  it("covers exactly seven domains and all ten known source keys, with no duplicates", () => {
    expect(MIGRATION_DOMAINS.map((d) => d.id)).toEqual([
      "session",
      "historyFilters",
      "assessment",
      "trainingPlans",
      "accuracyToleranceProfiles",
      "smartRandomProfiles",
      "assessmentPreferences",
    ]);
    expect(ALL_SOURCE_KEYS).toHaveLength(10);
    expect(new Set(ALL_SOURCE_KEYS).size).toBe(10);
  });

  it("gives a fresh user seven complete markers and zero records", async () => {
    const databaseName = freshDatabaseName("fresh-user");
    const source = createFakeSourceAdapter(); // every key absent
    const target = createIndexedDbMigrationTarget({ databaseName });

    const result = await runLocalStorageToIndexedDbMigration({ source, target });

    expect(result.failedDomain).toBeNull();
    expect(result.completedDomains).toEqual(MIGRATION_DOMAINS.map((d) => d.id));
    expect(result.alreadyCompleteDomains).toEqual([]);

    const metadataKeys = await readAllMetadataKeys(databaseName);
    expect(metadataKeys.sort()).toEqual(
      MIGRATION_DOMAINS.map((d) => buildMigrationMarkerKey(d.id)).sort()
    );
    const records = await readAllRecords(databaseName);
    expect(records).toEqual({});
  });

  it("copies representative values for all ten keys byte-for-byte", async () => {
    const databaseName = freshDatabaseName("byte-copy-all");
    const initial: Record<string, string> = {};
    for (const key of ALL_SOURCE_KEYS) {
      initial[key] = `${key}::representative-value-${key.length}`;
    }
    const source = createFakeSourceAdapter(initial);
    const target = createIndexedDbMigrationTarget({ databaseName });

    const result = await runLocalStorageToIndexedDbMigration({ source, target });
    expect(result.failedDomain).toBeNull();
    expect(result.completedDomains).toHaveLength(7);

    const records = await readAllRecords(databaseName);
    expect(records).toEqual(initial);
  });

  it("leaves the localStorage source byte-for-byte unchanged and never calls its set()", async () => {
    const databaseName = freshDatabaseName("source-unchanged");
    const source = createLocalStorageAdapter();
    const before: Record<string, string> = {};
    for (const key of ALL_SOURCE_KEYS) {
      const value = `${key}-untouched-value`;
      localStorage.setItem(key, value);
      before[key] = value;
    }
    const setSpy = vi.spyOn(Storage.prototype, "setItem");

    const target = createIndexedDbMigrationTarget({ databaseName });
    const result = await runLocalStorageToIndexedDbMigration({ source, target });

    expect(result.failedDomain).toBeNull();
    expect(setSpy).not.toHaveBeenCalled();
    for (const key of ALL_SOURCE_KEYS) {
      expect(localStorage.getItem(key)).toBe(before[key]);
    }
  });

  it("removes stale target records for a domain's null (absent) source keys", async () => {
    const databaseName = freshDatabaseName("null-removes-domain");
    const sessionDomain = MIGRATION_DOMAINS.find((d) => d.id === "session")!;
    const [currentKey, historyKey] = sessionDomain.sourceKeys;

    // Pre-seed a stale IndexedDB record for the history key, bypassing the migration
    // engine, before it has ever run.
    const seedDb = await openDB(databaseName, INDEXED_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(RECORDS_STORE_NAME)) db.createObjectStore(RECORDS_STORE_NAME);
        if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) db.createObjectStore(METADATA_STORE_NAME);
      },
    });
    await seedDb.put(RECORDS_STORE_NAME, "stale-history", historyKey);
    seedDb.close();

    const source = createFakeSourceAdapter({ [currentKey]: "real-current-session" });
    const target = createIndexedDbMigrationTarget({ databaseName });
    const result = await runLocalStorageToIndexedDbMigration({ source, target });

    expect(result.completedDomains).toContain("session");
    const records = await readAllRecords(databaseName);
    expect(records[currentKey]).toBe("real-current-session");
    expect(records[historyKey]).toBeUndefined();
  });

  it("copies malformed JSON and legacy serialized shapes exactly, without parsing them", async () => {
    const databaseName = freshDatabaseName("malformed-legacy");
    const sessionDomain = MIGRATION_DOMAINS.find((d) => d.id === "session")!;
    const assessmentDomain = MIGRATION_DOMAINS.find((d) => d.id === "assessment")!;
    const legacySessionShape = '{"id":"legacy-1","shots":[{"releaseTime":1.5}]}'; // no `blocks`
    const malformedAssessmentJson = '{"currentRun": [1,2, not valid json';

    const source = createFakeSourceAdapter({
      [sessionDomain.sourceKeys[0]]: legacySessionShape,
      [assessmentDomain.sourceKeys[0]]: malformedAssessmentJson,
    });
    const target = createIndexedDbMigrationTarget({ databaseName });
    await runLocalStorageToIndexedDbMigration({ source, target });

    const records = await readAllRecords(databaseName);
    expect(records[sessionDomain.sourceKeys[0]]).toBe(legacySessionShape);
    expect(records[assessmentDomain.sourceKeys[0]]).toBe(malformedAssessmentJson);
  });

  describe("repository load equivalence", () => {
    it("SessionRepository.loadCurrent() agrees between localStorage and the copied IndexedDB value, for a legacy shape", async () => {
      const databaseName = freshDatabaseName("equivalence-session");
      const legacySessionShape = '{"id":"legacy-1","shots":[{"releaseTime":1.5}]}';
      localStorage.setItem("curling-release-tracker-current-session", legacySessionShape);

      const source = createLocalStorageAdapter();
      const target = createIndexedDbMigrationTarget({ databaseName });
      const result = await runLocalStorageToIndexedDbMigration({ source, target });
      expect(result.failedDomain).toBeNull();

      // migrateSession's Legacy Block fabrication (ADR-0005) generates a fresh random
      // UUID and a fresh `new Date().toISOString()` createdAt on every independent
      // call — this is expected even for two loadCurrent() calls against the *same*
      // backend a millisecond apart, and is unrelated to the migration-copy engine,
      // which only proves the raw string was copied exactly (proven separately by the
      // byte-for-byte copy tests above). Freezing the clock around both calls removes
      // the timestamp non-determinism; normalizing generated IDs (below) removes the
      // rest, isolating the property this test actually cares about: every other
      // field — structure, defaults, computed values — must still agree.
      // Only Date is faked — fake-indexeddb schedules its own internal task
      // completion via real setTimeout/setImmediate (IndexedDB semantics require
      // transactions to go inactive on a real event-loop tick, not a microtask), so
      // faking those too would hang every IndexedDB call below indefinitely.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      let fromLocalStorage;
      let fromIndexedDb;
      try {
        fromLocalStorage = await createSessionRepository(source).loadCurrent();
        fromIndexedDb = await createSessionRepository(
          createIndexedDbAdapter({ databaseName })
        ).loadCurrent();
      } finally {
        vi.useRealTimers();
      }
      expect(normalizeGeneratedIds(fromIndexedDb)).toEqual(normalizeGeneratedIds(fromLocalStorage));
    });

    it("AssessmentRepository.loadState() agrees between localStorage and the copied IndexedDB value, for malformed JSON", async () => {
      const databaseName = freshDatabaseName("equivalence-assessment");
      localStorage.setItem(
        "curling-release-tracker-assessment-data",
        '{"currentRun": [1,2, not valid json'
      );

      const source = createLocalStorageAdapter();
      const target = createIndexedDbMigrationTarget({ databaseName });
      const result = await runLocalStorageToIndexedDbMigration({ source, target });
      expect(result.failedDomain).toBeNull();

      const fromLocalStorage = await createAssessmentRepository(source).loadState();
      const fromIndexedDb = await createAssessmentRepository(
        createIndexedDbAdapter({ databaseName })
      ).loadState();
      expect(fromIndexedDb).toEqual(fromLocalStorage);
    });

    it("AssessmentPreferencesRepository agrees between backends for a partial (subset-present) domain", async () => {
      const databaseName = freshDatabaseName("equivalence-preferences");
      // Only the threshold preset is present; the other two keys are genuinely absent.
      localStorage.setItem(
        "curling-release-tracker-assessment-last-threshold-preset",
        "tight"
      );

      const source = createLocalStorageAdapter();
      const target = createIndexedDbMigrationTarget({ databaseName });
      const result = await runLocalStorageToIndexedDbMigration({ source, target });
      expect(result.failedDomain).toBeNull();

      const localRepo = createAssessmentPreferencesRepository(source);
      const idbRepo = createAssessmentPreferencesRepository(createIndexedDbAdapter({ databaseName }));

      expect(await idbRepo.getShowIntroduction()).toEqual(await localRepo.getShowIntroduction());
      expect(await idbRepo.getLastThresholdPreset()).toEqual(await localRepo.getLastThresholdPreset());
      expect(await idbRepo.getLastCustomThreshold()).toEqual(await localRepo.getLastCustomThreshold());

      // And exactly one marker covers the whole three-key domain, not three.
      const metadataKeys = await readAllMetadataKeys(databaseName);
      expect(metadataKeys.filter((k) => k.endsWith(":assessmentPreferences"))).toHaveLength(1);
    });
  });

  it("a source read failure prevents every write and marker for that domain, and stops at the first failed domain", async () => {
    const databaseName = freshDatabaseName("source-read-failure");
    const historyFiltersDomain = MIGRATION_DOMAINS.find((d) => d.id === "historyFilters")!;
    const source = createFakeSourceAdapter();
    source.failOnGet.add(historyFiltersDomain.sourceKeys[0]);

    const target = createIndexedDbMigrationTarget({ databaseName });
    const result = await runLocalStorageToIndexedDbMigration({ source, target });

    expect(result.completedDomains).toEqual(["session"]);
    expect(result.failedDomain).toEqual({
      domain: "historyFilters",
      stage: "source_read",
      error: { kind: "unknown", message: expect.any(String) },
    });

    const records = await readAllRecords(databaseName);
    expect(Object.keys(records).some((k) => historyFiltersDomain.sourceKeys.includes(k))).toBe(false);
    const metadataKeys = await readAllMetadataKeys(databaseName);
    expect(metadataKeys).not.toContain(buildMigrationMarkerKey("historyFilters"));
    // Stopped at the first failure — assessment (domain 3) was never even attempted.
    expect(source.getCalls).not.toContain(
      MIGRATION_DOMAINS.find((d) => d.id === "assessment")!.sourceKeys[0]
    );
  });

  it("a target commit failure is surfaced as target_commit and stops the run there", async () => {
    const databaseName = freshDatabaseName("target-commit-failure");
    const source = createFakeSourceAdapter({
      [MIGRATION_DOMAINS[0].sourceKeys[0]]: "session-value",
      [MIGRATION_DOMAINS[0].sourceKeys[1]]: "history-value",
      [MIGRATION_DOMAINS[1].sourceKeys[0]]: "filters-value",
    });

    const realTarget = createIndexedDbMigrationTarget({ databaseName });
    const failingTarget = {
      readDomainMarker: realTarget.readDomainMarker,
      commitDomainSnapshot: async (snapshot: Parameters<typeof realTarget.commitDomainSnapshot>[0]) => {
        if (snapshot.domain === "historyFilters") {
          return { status: "failed" as const, error: { kind: "unknown" as const, message: "induced" } };
        }
        return realTarget.commitDomainSnapshot(snapshot);
      },
    };

    const result = await runLocalStorageToIndexedDbMigration({ source, target: failingTarget });
    expect(result.completedDomains).toEqual(["session"]);
    expect(result.failedDomain).toEqual({
      domain: "historyFilters",
      stage: "target_commit",
      error: { kind: "unknown", message: "induced" },
    });
    expect(source.getCalls).not.toContain(MIGRATION_DOMAINS[2].sourceKeys[0]);
  });

  it("retries a previously failed domain successfully on a later run", async () => {
    const databaseName = freshDatabaseName("retry-failed-domain");
    const source = createFakeSourceAdapter({
      [MIGRATION_DOMAINS[0].sourceKeys[0]]: "session-value",
      [MIGRATION_DOMAINS[0].sourceKeys[1]]: "history-value",
    });
    source.failOnGet.add(MIGRATION_DOMAINS[0].sourceKeys[1]);
    const target = createIndexedDbMigrationTarget({ databaseName });

    const firstRun = await runLocalStorageToIndexedDbMigration({ source, target });
    expect(firstRun.failedDomain?.domain).toBe("session");

    source.failOnGet.delete(MIGRATION_DOMAINS[0].sourceKeys[1]);
    const secondRun = await runLocalStorageToIndexedDbMigration({ source, target });
    expect(secondRun.failedDomain).toBeNull();
    expect(secondRun.completedDomains[0]).toBe("session");
  });

  it("resumes after an interruption without re-reading or re-writing already-completed domains", async () => {
    const databaseName = freshDatabaseName("resume-after-interruption");
    const assessmentDomain = MIGRATION_DOMAINS.find((d) => d.id === "assessment")!;
    const source = createFakeSourceAdapter();
    source.failOnGet.add(assessmentDomain.sourceKeys[0]);
    const target = createIndexedDbMigrationTarget({ databaseName });

    const firstRun = await runLocalStorageToIndexedDbMigration({ source, target });
    expect(firstRun.completedDomains).toEqual(["session", "historyFilters"]);
    expect(firstRun.failedDomain?.domain).toBe("assessment");

    const completedKeysFromFirstRun = [...source.getCalls];
    source.failOnGet.delete(assessmentDomain.sourceKeys[0]);
    source.getCalls.length = 0;

    const secondRun = await runLocalStorageToIndexedDbMigration({ source, target });
    expect(secondRun.failedDomain).toBeNull();
    expect(secondRun.alreadyCompleteDomains).toEqual(["session", "historyFilters"]);
    expect(secondRun.completedDomains).toEqual([
      "assessment",
      "trainingPlans",
      "accuracyToleranceProfiles",
      "smartRandomProfiles",
      "assessmentPreferences",
    ]);

    // None of the first run's already-completed domains' source keys were read again.
    const firstRunCompletedKeys = MIGRATION_DOMAINS.slice(0, 2).flatMap((d) => d.sourceKeys);
    for (const key of firstRunCompletedKeys) {
      expect(source.getCalls).not.toContain(key);
    }
    expect(completedKeysFromFirstRun.length).toBeGreaterThan(0);
  });

  it("running the complete migration twice produces byte-identical records and metadata, reading nothing from source the second time", async () => {
    const databaseName = freshDatabaseName("run-twice");
    const initial: Record<string, string> = {};
    for (const key of ALL_SOURCE_KEYS) {
      initial[key] = `${key}-stable-value`;
    }
    const source = createFakeSourceAdapter(initial);
    const target = createIndexedDbMigrationTarget({ databaseName });

    const firstRun = await runLocalStorageToIndexedDbMigration({ source, target });
    expect(firstRun.failedDomain).toBeNull();
    const recordsAfterFirst = await readAllRecords(databaseName);
    const metadataAfterFirst = await readAllMetadata(databaseName);
    // Every marker is a genuine, exact "complete" marker after the first run — not
    // just a plausible-looking key list — so the second run's comparison below is
    // actually comparing real marker values, not merely their names.
    for (const { id: domain, sourceKeys } of MIGRATION_DOMAINS) {
      expect(metadataAfterFirst[buildMigrationMarkerKey(domain)]).toEqual({
        protocolVersion: 1,
        domain,
        status: "complete",
        sourceKeys,
      });
    }

    source.getCalls.length = 0;
    const secondRun = await runLocalStorageToIndexedDbMigration({ source, target });
    expect(secondRun.failedDomain).toBeNull();
    expect(secondRun.completedDomains).toEqual([]);
    expect(secondRun.alreadyCompleteDomains).toEqual(MIGRATION_DOMAINS.map((d) => d.id));
    expect(source.getCalls).toEqual([]);

    const recordsAfterSecond = await readAllRecords(databaseName);
    const metadataAfterSecond = await readAllMetadata(databaseName);
    expect(recordsAfterSecond).toEqual(recordsAfterFirst);
    // Full marker values compared, not just which keys exist — the second run must
    // leave every marker's protocolVersion/domain/status/sourceKeys byte-identical,
    // not merely "a marker with this name still exists."
    expect(metadataAfterSecond).toEqual(metadataAfterFirst);
  });

  it("a valid complete marker prevents any source reads for that domain", async () => {
    const databaseName = freshDatabaseName("complete-prevents-reads");
    const source = createFakeSourceAdapter();
    const target = createIndexedDbMigrationTarget({ databaseName });
    await runLocalStorageToIndexedDbMigration({ source, target });

    source.getCalls.length = 0;
    const result = await runLocalStorageToIndexedDbMigration({ source, target });
    expect(result.alreadyCompleteDomains).toHaveLength(7);
    expect(source.getCalls).toEqual([]);
  });

  it("a malformed marker fails closed and leaves target records for that domain unchanged", async () => {
    const databaseName = freshDatabaseName("malformed-marker-orchestrator");
    const seedDb = await openDB(databaseName, INDEXED_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(RECORDS_STORE_NAME)) db.createObjectStore(RECORDS_STORE_NAME);
        if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) db.createObjectStore(METADATA_STORE_NAME);
      },
    });
    await seedDb.put(METADATA_STORE_NAME, "not-a-marker-object", buildMigrationMarkerKey("session"));
    seedDb.close();

    const source = createFakeSourceAdapter({
      [MIGRATION_DOMAINS[0].sourceKeys[0]]: "should-not-be-written",
    });
    const target = createIndexedDbMigrationTarget({ databaseName });
    const result = await runLocalStorageToIndexedDbMigration({ source, target });

    expect(result.completedDomains).toEqual([]);
    expect(result.failedDomain?.domain).toBe("session");
    expect(result.failedDomain?.stage).toBe("marker_read");
    expect(result.failedDomain?.error.kind).toBe("invalid_marker");

    const records = await readAllRecords(databaseName);
    expect(records[MIGRATION_DOMAINS[0].sourceKeys[0]]).toBeUndefined();
  });

  it("two concurrent full runs commit each domain at most once", async () => {
    const databaseName = freshDatabaseName("concurrent-runs");
    const initial: Record<string, string> = {};
    for (const key of ALL_SOURCE_KEYS) {
      initial[key] = `${key}-concurrent-value`;
    }
    const sourceA = createFakeSourceAdapter(initial);
    const sourceB = createFakeSourceAdapter(initial);
    // Two independently constructed targets (separate connections) against the same
    // database name — a single shared target would only prove safety within one
    // connection's own internal serialization, not the cross-connection case this
    // protocol actually has to hold for (e.g. two separate tabs).
    const targetA = createIndexedDbMigrationTarget({ databaseName });
    const targetB = createIndexedDbMigrationTarget({ databaseName });

    const [resultA, resultB] = await Promise.all([
      runLocalStorageToIndexedDbMigration({ source: sourceA, target: targetA }),
      runLocalStorageToIndexedDbMigration({ source: sourceB, target: targetB }),
    ]);

    expect(resultA.failedDomain).toBeNull();
    expect(resultB.failedDomain).toBeNull();

    for (const { id: domain } of MIGRATION_DOMAINS) {
      const inA = resultA.completedDomains.includes(domain);
      const inB = resultB.completedDomains.includes(domain);
      // Exactly one of the two runs actually committed each domain — the other must
      // have observed it as already complete instead.
      expect(inA !== inB).toBe(true);
    }

    const records = await readAllRecords(databaseName);
    expect(records).toEqual(initial);
  });

  it("has no activation or global source-of-truth marker — only the seven domain markers exist after a full run", async () => {
    const databaseName = freshDatabaseName("no-activation-marker");
    const source = createFakeSourceAdapter();
    const target = createIndexedDbMigrationTarget({ databaseName });
    await runLocalStorageToIndexedDbMigration({ source, target });

    const metadataKeys = (await readAllMetadataKeys(databaseName)).sort();
    const expectedKeys = MIGRATION_DOMAINS.map((d) => buildMigrationMarkerKey(d.id)).sort();
    expect(metadataKeys).toEqual(expectedKeys);
  });

  it("never invokes any domain repository save method (source is never written to)", async () => {
    const databaseName = freshDatabaseName("never-saves");
    const source = createFakeSourceAdapter({
      [MIGRATION_DOMAINS[0].sourceKeys[0]]: "value",
    });
    const target = createIndexedDbMigrationTarget({ databaseName });
    await runLocalStorageToIndexedDbMigration({ source, target });
    expect(source.setCalls).toEqual([]);
  });
});

describe("architecture: migration domain identifiers", () => {
  it("MigrationDomainId values match the seven documented domain names exactly", () => {
    const ids: MigrationDomainId[] = MIGRATION_DOMAINS.map((d) => d.id);
    expect(ids).toEqual([
      "session",
      "historyFilters",
      "assessment",
      "trainingPlans",
      "accuracyToleranceProfiles",
      "smartRandomProfiles",
      "assessmentPreferences",
    ]);
  });
});
