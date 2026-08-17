import { afterEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { openDB } from "idb";
import {
  buildMigrationMarkerKey,
  createIndexedDbAdapter,
  createIndexedDbMigrationTarget,
  INDEXED_DB_VERSION,
  METADATA_STORE_NAME,
  MIGRATION_METADATA_NAMESPACE,
  MIGRATION_PROTOCOL_VERSION,
  RECORDS_STORE_NAME,
} from "../indexedDbAdapter";

function freshDatabaseName(label: string): string {
  return `test-migration-target-${label}-${Math.floor(Math.random() * 1e9)}`;
}

const DOMAIN = "session";
const SOURCE_KEYS = ["curling-release-tracker-current-session", "curling-release-tracker-session-history"];

function snapshot(records: Array<{ key: string; value: string | null }>) {
  return { domain: DOMAIN, sourceKeys: SOURCE_KEYS, records };
}

async function readRawRecord(databaseName: string, key: string): Promise<string | undefined> {
  const db = await openDB(databaseName, INDEXED_DB_VERSION);
  const value = await db.get(RECORDS_STORE_NAME, key);
  db.close();
  return value;
}

async function readRawMetadata(databaseName: string, key: string): Promise<unknown> {
  const db = await openDB(databaseName, INDEXED_DB_VERSION);
  const value = await db.get(METADATA_STORE_NAME, key);
  db.close();
  return value;
}

/** Raw pre-seed writes in these tests bypass the migration target entirely, so — unlike
 * every other test, which lets the target's own lazy `upgrade` create the database —
 * they need the schema to already exist before they can write into either store. */
async function ensureDatabaseExists(databaseName: string): Promise<void> {
  const db = await openDB(databaseName, INDEXED_DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(RECORDS_STORE_NAME)) {
        database.createObjectStore(RECORDS_STORE_NAME);
      }
      if (!database.objectStoreNames.contains(METADATA_STORE_NAME)) {
        database.createObjectStore(METADATA_STORE_NAME);
      }
    },
  });
  db.close();
}

describe("createIndexedDbMigrationTarget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has the expected marker namespace and protocol version constants", () => {
    expect(MIGRATION_METADATA_NAMESPACE).toBe("migration:local-storage-to-indexeddb:v1");
    expect(MIGRATION_PROTOCOL_VERSION).toBe(1);
    expect(buildMigrationMarkerKey("session")).toBe(
      "migration:local-storage-to-indexeddb:v1:session"
    );
  });

  describe("readDomainMarker", () => {
    it("returns absent when no marker exists", async () => {
      const target = createIndexedDbMigrationTarget({ databaseName: freshDatabaseName("absent") });
      const result = await target.readDomainMarker(DOMAIN, SOURCE_KEYS);
      expect(result).toEqual({ status: "absent" });
    });

    it("returns complete for an exact valid marker", async () => {
      const databaseName = freshDatabaseName("complete");
      const target = createIndexedDbMigrationTarget({ databaseName });
      const commit = await target.commitDomainSnapshot(
        snapshot(SOURCE_KEYS.map((key) => ({ key, value: `${key}-value` })))
      );
      expect(commit).toEqual({ status: "committed" });

      const result = await target.readDomainMarker(DOMAIN, SOURCE_KEYS);
      expect(result).toEqual({ status: "complete" });
    });

    it("fails closed on a malformed (non-object) marker", async () => {
      const databaseName = freshDatabaseName("malformed");
      await ensureDatabaseExists(databaseName);
      const db = await openDB(databaseName, INDEXED_DB_VERSION);
      await db.put(METADATA_STORE_NAME, "not-an-object", buildMigrationMarkerKey(DOMAIN));
      db.close();

      const target = createIndexedDbMigrationTarget({ databaseName });
      const result = await target.readDomainMarker(DOMAIN, SOURCE_KEYS);
      expect(result.status).toBe("invalid");
    });

    it.each([
      ["wrong protocolVersion", { protocolVersion: 2, domain: DOMAIN, status: "complete", sourceKeys: SOURCE_KEYS }],
      ["wrong domain", { protocolVersion: 1, domain: "wrong-domain", status: "complete", sourceKeys: SOURCE_KEYS }],
      [
        "wrong sourceKeys list",
        { protocolVersion: 1, domain: DOMAIN, status: "complete", sourceKeys: ["only-one-key"] },
      ],
      ["wrong status", { protocolVersion: 1, domain: DOMAIN, status: "in_progress", sourceKeys: SOURCE_KEYS }],
    ])("fails closed on %s", async (_label, badMarker) => {
      const databaseName = freshDatabaseName("bad-marker");
      await ensureDatabaseExists(databaseName);
      const db = await openDB(databaseName, INDEXED_DB_VERSION);
      await db.put(METADATA_STORE_NAME, badMarker, buildMigrationMarkerKey(DOMAIN));
      db.close();

      const target = createIndexedDbMigrationTarget({ databaseName });
      const result = await target.readDomainMarker(DOMAIN, SOURCE_KEYS);
      expect(result.status).toBe("invalid");
      if (result.status === "invalid") {
        expect(result.reason).toEqual(expect.any(String));
      }
    });

    it("classifies a read failure using the same storage_unavailable/unknown taxonomy as the generic adapter", async () => {
      const original = globalThis.indexedDB;
      // @ts-expect-error -- simulate indexedDB being unavailable.
      delete globalThis.indexedDB;
      const target = createIndexedDbMigrationTarget({ databaseName: freshDatabaseName("read-fail") });
      const result = await target.readDomainMarker(DOMAIN, SOURCE_KEYS);
      expect(result).toEqual({ status: "read_failed", error: { kind: "storage_unavailable" } });
      globalThis.indexedDB = original;
    });
  });

  describe("commitDomainSnapshot", () => {
    it("commits records byte-for-byte and writes the marker last", async () => {
      const databaseName = freshDatabaseName("byte-copy");
      const target = createIndexedDbMigrationTarget({ databaseName });
      const values = SOURCE_KEYS.map((key) => ({ key, value: `${key}::{"malformed": [1,2,` }));

      const result = await target.commitDomainSnapshot(snapshot(values));
      expect(result).toEqual({ status: "committed" });

      for (const { key, value } of values) {
        expect(await readRawRecord(databaseName, key)).toBe(value);
      }
      const marker = await readRawMetadata(databaseName, buildMigrationMarkerKey(DOMAIN));
      expect(marker).toEqual({
        protocolVersion: 1,
        domain: DOMAIN,
        status: "complete",
        sourceKeys: SOURCE_KEYS,
      });
    });

    it("treats a null source value as an absent target record, not a written empty string", async () => {
      const databaseName = freshDatabaseName("null-removes");
      // Pre-seed a stale record directly, bypassing the target, for the key that will
      // be null this run.
      await ensureDatabaseExists(databaseName);
      const db = await openDB(databaseName, INDEXED_DB_VERSION);
      await db.put(RECORDS_STORE_NAME, "stale-value", SOURCE_KEYS[1]);
      db.close();

      const target = createIndexedDbMigrationTarget({ databaseName });
      const result = await target.commitDomainSnapshot(
        snapshot([
          { key: SOURCE_KEYS[0], value: "real-value" },
          { key: SOURCE_KEYS[1], value: null },
        ])
      );
      expect(result).toEqual({ status: "committed" });

      expect(await readRawRecord(databaseName, SOURCE_KEYS[0])).toBe("real-value");
      expect(await readRawRecord(databaseName, SOURCE_KEYS[1])).toBeUndefined();
    });

    it("already_complete short-circuits without changing existing records", async () => {
      const databaseName = freshDatabaseName("already-complete");
      const target = createIndexedDbMigrationTarget({ databaseName });
      const firstValues = SOURCE_KEYS.map((key) => ({ key, value: `${key}-first` }));
      await target.commitDomainSnapshot(snapshot(firstValues));

      const second = await target.commitDomainSnapshot(
        snapshot(SOURCE_KEYS.map((key) => ({ key, value: `${key}-SHOULD-NOT-BE-WRITTEN` })))
      );
      expect(second).toEqual({ status: "already_complete" });

      for (const { key, value } of firstValues) {
        expect(await readRawRecord(databaseName, key)).toBe(value);
      }
    });

    it("fails closed on an invalid existing marker, leaving records unchanged", async () => {
      const databaseName = freshDatabaseName("invalid-marker-commit");
      await ensureDatabaseExists(databaseName);
      const db = await openDB(databaseName, INDEXED_DB_VERSION);
      await db.put(
        METADATA_STORE_NAME,
        { protocolVersion: 1, domain: DOMAIN, status: "complete", sourceKeys: ["wrong-key"] },
        buildMigrationMarkerKey(DOMAIN)
      );
      db.close();

      const target = createIndexedDbMigrationTarget({ databaseName });
      const result = await target.commitDomainSnapshot(
        snapshot(SOURCE_KEYS.map((key) => ({ key, value: "should-not-be-written" })))
      );
      expect(result.status).toBe("invalid_marker");

      for (const key of SOURCE_KEYS) {
        expect(await readRawRecord(databaseName, key)).toBeUndefined();
      }
    });

    it("rolls back every record change when a records-store write fails", async () => {
      const databaseName = freshDatabaseName("records-write-fails");
      const target = createIndexedDbMigrationTarget({ databaseName });

      const originalPut = IDBObjectStore.prototype.put;
      const putSpy = vi
        .spyOn(IDBObjectStore.prototype, "put")
        .mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
          if (this.name === RECORDS_STORE_NAME && key === SOURCE_KEYS[1]) {
            throw new DOMException("boom", "UnknownError");
          }
          return originalPut.call(this, value, key);
        });

      const result = await target.commitDomainSnapshot(
        snapshot([
          { key: SOURCE_KEYS[0], value: "should-not-survive" },
          { key: SOURCE_KEYS[1], value: "triggers-failure" },
        ])
      );
      expect(result.status).toBe("failed");

      for (const key of SOURCE_KEYS) {
        expect(await readRawRecord(databaseName, key)).toBeUndefined();
      }
      expect(await readRawMetadata(databaseName, buildMigrationMarkerKey(DOMAIN))).toBeUndefined();

      putSpy.mockRestore();
    });

    it("rolls back record changes when the marker write itself fails", async () => {
      const databaseName = freshDatabaseName("marker-write-fails");
      const target = createIndexedDbMigrationTarget({ databaseName });

      const originalPut = IDBObjectStore.prototype.put;
      const putSpy = vi
        .spyOn(IDBObjectStore.prototype, "put")
        .mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
          if (this.name === METADATA_STORE_NAME) {
            throw new DOMException("boom", "UnknownError");
          }
          return originalPut.call(this, value, key);
        });

      const result = await target.commitDomainSnapshot(
        snapshot(SOURCE_KEYS.map((key) => ({ key, value: `${key}-value` })))
      );
      expect(result.status).toBe("failed");

      for (const key of SOURCE_KEYS) {
        expect(await readRawRecord(databaseName, key)).toBeUndefined();
      }
      expect(await readRawMetadata(databaseName, buildMigrationMarkerKey(DOMAIN))).toBeUndefined();

      putSpy.mockRestore();
    });

    it("allows a retry after a failed commit to succeed", async () => {
      const databaseName = freshDatabaseName("retry-after-commit-failure");
      const target = createIndexedDbMigrationTarget({ databaseName });

      const originalPut = IDBObjectStore.prototype.put;
      const putSpy = vi
        .spyOn(IDBObjectStore.prototype, "put")
        .mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
          if (this.name === METADATA_STORE_NAME) {
            throw new DOMException("boom", "UnknownError");
          }
          return originalPut.call(this, value, key);
        });

      const values = SOURCE_KEYS.map((key) => ({ key, value: `${key}-value` }));
      const failed = await target.commitDomainSnapshot(snapshot(values));
      expect(failed.status).toBe("failed");
      putSpy.mockRestore();

      const retried = await target.commitDomainSnapshot(snapshot(values));
      expect(retried).toEqual({ status: "committed" });
      for (const { key, value } of values) {
        expect(await readRawRecord(databaseName, key)).toBe(value);
      }
    });

    it("uses one transaction spanning both records and metadata", async () => {
      const databaseName = freshDatabaseName("one-transaction");
      const target = createIndexedDbMigrationTarget({ databaseName });
      // Warm the connection first so we only observe the transaction call made by
      // the commit itself.
      await target.readDomainMarker(DOMAIN, SOURCE_KEYS);

      const transactionSpy = vi.spyOn(IDBDatabase.prototype, "transaction");
      await target.commitDomainSnapshot(
        snapshot(SOURCE_KEYS.map((key) => ({ key, value: `${key}-value` })))
      );

      const relevantCalls = transactionSpy.mock.calls.filter((call) => {
        const storeNames = call[0];
        return (
          Array.isArray(storeNames) &&
          storeNames.includes(RECORDS_STORE_NAME) &&
          storeNames.includes(METADATA_STORE_NAME)
        );
      });
      expect(relevantCalls).toHaveLength(1);
      expect(relevantCalls[0][1]).toBe("readwrite");
      transactionSpy.mockRestore();
    });

    it("commits each domain at most once across two concurrent calls", async () => {
      const databaseName = freshDatabaseName("concurrent");
      const target = createIndexedDbMigrationTarget({ databaseName });
      const values = SOURCE_KEYS.map((key) => ({ key, value: `${key}-concurrent` }));

      const [first, second] = await Promise.all([
        target.commitDomainSnapshot(snapshot(values)),
        target.commitDomainSnapshot(snapshot(values)),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual(["already_complete", "committed"]);

      for (const { key, value } of values) {
        expect(await readRawRecord(databaseName, key)).toBe(value);
      }
    });

    it("handles a partial (subset-present) domain atomically under one marker", async () => {
      const databaseName = freshDatabaseName("partial-domain");
      const preferenceKeys = [
        "curling-release-tracker-assessment-show-introduction",
        "curling-release-tracker-assessment-last-threshold-preset",
        "curling-release-tracker-assessment-last-custom-threshold",
      ];
      const target = createIndexedDbMigrationTarget({ databaseName });
      const result = await target.commitDomainSnapshot({
        domain: "assessmentPreferences",
        sourceKeys: preferenceKeys,
        records: [
          { key: preferenceKeys[0], value: null },
          { key: preferenceKeys[1], value: "tight" },
          { key: preferenceKeys[2], value: null },
        ],
      });
      expect(result).toEqual({ status: "committed" });

      expect(await readRawRecord(databaseName, preferenceKeys[0])).toBeUndefined();
      expect(await readRawRecord(databaseName, preferenceKeys[1])).toBe("tight");
      expect(await readRawRecord(databaseName, preferenceKeys[2])).toBeUndefined();

      const marker = await readRawMetadata(
        databaseName,
        buildMigrationMarkerKey("assessmentPreferences")
      );
      expect(marker).toEqual({
        protocolVersion: 1,
        domain: "assessmentPreferences",
        status: "complete",
        sourceKeys: preferenceKeys,
      });
    });
  });

  it("keeps markers unreachable through the generic StorageAdapter get/set path", async () => {
    const databaseName = freshDatabaseName("adapter-isolation");
    const target = createIndexedDbMigrationTarget({ databaseName });
    await target.commitDomainSnapshot(
      snapshot(SOURCE_KEYS.map((key) => ({ key, value: `${key}-value` })))
    );

    const adapter = createIndexedDbAdapter({ databaseName });
    const result = await adapter.get(buildMigrationMarkerKey(DOMAIN));
    expect(result).toEqual({ status: "value", value: null });
  });

  describe("fails closed on structurally hostile marker values, without ever throwing", () => {
    // Every value below is genuinely structured-clone-compatible — IndexedDB (and
    // fake-indexeddb, confirmed directly) will store and return each of these exactly
    // as constructed, with no serialization error of its own. That's precisely what
    // makes them worth testing: validateMarker must reject every one of them as
    // "invalid" without throwing, since JSON.stringify (the previous implementation's
    // way of building a reason message) throws on both a BigInt and a cyclic
    // structure — exactly two of the cases below.
    const hostileMarkers: Array<[string, () => unknown]> = [
      [
        "an otherwise-valid marker with one additional field",
        () => ({
          protocolVersion: 1,
          domain: DOMAIN,
          status: "complete",
          sourceKeys: SOURCE_KEYS,
          extra: "field",
        }),
      ],
      [
        "a non-plain object (Map) carrying marker-like properties",
        () => {
          const map = new Map<string, unknown>();
          map.set("protocolVersion", 1);
          map.set("domain", DOMAIN);
          map.set("status", "complete");
          map.set("sourceKeys", SOURCE_KEYS);
          return map;
        },
      ],
      [
        "an array carrying marker-like properties",
        () => {
          const arr = [] as unknown as Record<string, unknown>;
          arr.protocolVersion = 1;
          arr.domain = DOMAIN;
          arr.status = "complete";
          arr.sourceKeys = SOURCE_KEYS;
          return arr;
        },
      ],
      [
        "a BigInt protocolVersion",
        () => ({
          protocolVersion: BigInt(1),
          domain: DOMAIN,
          status: "complete",
          sourceKeys: SOURCE_KEYS,
        }),
      ],
      [
        "a cyclic sourceKeys array (self-referential element)",
        () => {
          const cyclicArray: unknown[] = [...SOURCE_KEYS];
          cyclicArray.push(cyclicArray);
          return { protocolVersion: 1, domain: DOMAIN, status: "complete", sourceKeys: cyclicArray };
        },
      ],
      [
        "a cyclic marker object (self-referential extra field)",
        () => {
          const marker: Record<string, unknown> = {
            protocolVersion: 1,
            domain: DOMAIN,
            status: "complete",
            sourceKeys: SOURCE_KEYS,
          };
          marker.self = marker;
          return marker;
        },
      ],
    ];

    it.each(hostileMarkers)(
      "readDomainMarker fails closed on: %s",
      async (_label, makeMarker) => {
        const databaseName = freshDatabaseName("hostile-read");
        await ensureDatabaseExists(databaseName);
        const db = await openDB(databaseName, INDEXED_DB_VERSION);
        await db.put(METADATA_STORE_NAME, makeMarker(), buildMigrationMarkerKey(DOMAIN));
        db.close();

        const target = createIndexedDbMigrationTarget({ databaseName });
        const result = await target.readDomainMarker(DOMAIN, SOURCE_KEYS);
        expect(result.status).toBe("invalid");
        if (result.status === "invalid") {
          expect(typeof result.reason).toBe("string");
        }
      }
    );

    it.each(hostileMarkers)(
      "commitDomainSnapshot's transactional re-check fails closed on: %s, leaving records unchanged",
      async (_label, makeMarker) => {
        const databaseName = freshDatabaseName("hostile-commit");
        await ensureDatabaseExists(databaseName);
        const db = await openDB(databaseName, INDEXED_DB_VERSION);
        await db.put(METADATA_STORE_NAME, makeMarker(), buildMigrationMarkerKey(DOMAIN));
        db.close();

        const target = createIndexedDbMigrationTarget({ databaseName });
        const result = await target.commitDomainSnapshot(
          snapshot(SOURCE_KEYS.map((key) => ({ key, value: "should-not-be-written" })))
        );
        expect(result.status).toBe("invalid_marker");

        for (const key of SOURCE_KEYS) {
          expect(await readRawRecord(databaseName, key)).toBeUndefined();
        }
      }
    );
  });

  describe("concurrency across separate connections", () => {
    it("commits a domain at most once across two independently constructed targets for the same database, without the loser overwriting the winner", async () => {
      const databaseName = freshDatabaseName("concurrent-separate-connections");
      const targetA = createIndexedDbMigrationTarget({ databaseName });
      const targetB = createIndexedDbMigrationTarget({ databaseName });
      const valuesA = SOURCE_KEYS.map((key) => ({ key, value: `${key}-from-connection-A` }));
      const valuesB = SOURCE_KEYS.map((key) => ({ key, value: `${key}-from-connection-B` }));

      const [resultA, resultB] = await Promise.all([
        targetA.commitDomainSnapshot(snapshot(valuesA)),
        targetB.commitDomainSnapshot(snapshot(valuesB)),
      ]);

      const statuses = [resultA.status, resultB.status].sort();
      expect(statuses).toEqual(["already_complete", "committed"]);
      // Not both commit, and not both find it already complete — this is not merely
      // "at most one committed," it's "exactly one committed, exactly one didn't."
      expect(resultA.status === "committed").not.toBe(resultB.status === "committed");

      // Whichever snapshot actually won, every record must come from that one
      // snapshot only — never a mix of connection A's and connection B's values, and
      // never any trace of the losing connection's values.
      const winningValues = resultA.status === "committed" ? valuesA : valuesB;
      const losingValues = resultA.status === "committed" ? valuesB : valuesA;
      for (const { key, value } of winningValues) {
        expect(await readRawRecord(databaseName, key)).toBe(value);
      }
      for (const { key, value } of losingValues) {
        expect(await readRawRecord(databaseName, key)).not.toBe(value);
      }

      // The marker itself is still exactly valid — this protocol does not claim
      // general multi-tab synchronization beyond "at most one commit per domain";
      // it only guarantees the marker/records this one domain ends up with are
      // internally consistent with each other.
      const marker = await readRawMetadata(databaseName, buildMigrationMarkerKey(DOMAIN));
      expect(marker).toEqual({
        protocolVersion: 1,
        domain: DOMAIN,
        status: "complete",
        sourceKeys: SOURCE_KEYS,
      });
    });
  });
});
