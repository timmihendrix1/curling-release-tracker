import { describe, expect, it } from "vitest";
import { readProfileSportingExport } from "../profileScopedSportingPersistence";
import { CLOUD_SPORTING_SYNC_STORAGE_KEY, emptySportingSyncState } from "../../cloudSporting/syncStateRepository";
const PROFILE = "10000000-0000-4000-8000-000000000001";
describe("personal current-device export", () => {
  it("reads the explicit sporting inventory without touching credentials or identity", async () => {
    const keys: string[] = [];
    const adapter = {
      async get(key: string) {
        keys.push(key);
        return { status: "value" as const, value: key === CLOUD_SPORTING_SYNC_STORAGE_KEY ? JSON.stringify(emptySportingSyncState()) : null };
      },
      async set() { throw new Error("Export must not mutate source storage"); },
    };
    const result = await readProfileSportingExport(PROFILE, adapter);
    expect(result.ok).toBe(true);
    expect(new Set(keys).size).toBe(13);
    expect(keys).toHaveLength(26);
    expect(keys.every(key => !key.startsWith("sb-") && !key.startsWith("curling.identity."))).toBe(true);
    if (result.ok) {
      const sync = JSON.parse(result.records[CLOUD_SPORTING_SYNC_STORAGE_KEY]!);
      expect(sync.format).toBe("personal-data-not-an-installation-backup");
      expect(sync).not.toHaveProperty("teamEligibilitySnapshots");
    }
  });
  it("fails rather than returning a partial export on read failure or changed source", async () => {
    let count = 0;
    for (const mode of ["failed", "changed"]) {
      count = 0;
      const result = await readProfileSportingExport(PROFILE, {
        async get() {
          count += 1;
          if (mode === "failed") return { status: "read_failed" as const, fallback: null, error: { kind: "storage_unavailable" as const } };
          return { status: "value" as const, value: count > 13 ? "changed" : null };
        }, async set() { return { ok: true }; },
      });
      expect(result.ok).toBe(false);
    }
  });
});
