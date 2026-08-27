import type { StorageAdapter, DomainLoadResult, PersistenceWriteResult } from "../persistence/types";
import { loadedAbsent, loadedValue, loadFailed } from "../persistence/types";
import type { CloudSportingRecord, CloudSportingRecordKind } from "./types";
import { isCanonicalUuid } from "../uuid";

export const CLOUD_SPORTING_SYNC_STORAGE_KEY = "curling-release-tracker-cloud-sporting-sync";
export const CLOUD_SPORTING_SYNC_SCHEMA_VERSION = 1;

export type SportingSyncEntry = CloudSportingRecord & {
  desired: "present" | "deleted";
  status: "pending" | "synced" | "issue";
};

export type SportingSyncState = {
  schemaVersion: 1;
  entries: SportingSyncEntry[];
};

export interface SportingSyncStateRepository {
  load(): Promise<DomainLoadResult<SportingSyncState>>;
  save(state: SportingSyncState): Promise<PersistenceWriteResult>;
}

export function emptySportingSyncState(): SportingSyncState {
  return { schemaVersion: CLOUD_SPORTING_SYNC_SCHEMA_VERSION, entries: [] };
}

function isKind(value: unknown): value is CloudSportingRecordKind {
  return value === "training_session" || value === "assessment_run";
}

function parseState(raw: unknown): SportingSyncState | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const root = raw as Record<string, unknown>;
  if (root.schemaVersion !== 1 || !Array.isArray(root.entries)) return null;
  const entries: SportingSyncEntry[] = [];
  const keys = new Set<string>();
  for (const candidate of root.entries) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (!isKind(item.recordKind) || !isCanonicalUuid(item.recordId) || !Number.isInteger(item.schemaVersion) || (item.schemaVersion as number) < 1 ||
        typeof item.payload !== "string" ||
        (item.desired === "present" && item.payload.length === 0) ||
        (item.desired === "deleted" && item.payload !== "") ||
        !/^[0-9a-f]{64}$/.test(String(item.contentSha256)) ||
        typeof item.recordedAt !== "string" || !Number.isFinite(Date.parse(item.recordedAt)) ||
        (item.desired !== "present" && item.desired !== "deleted") ||
        (item.status !== "pending" && item.status !== "synced" && item.status !== "issue")) return null;
    const key = `${item.recordKind}:${item.recordId}`;
    if (keys.has(key)) return null;
    keys.add(key);
    entries.push({
      recordKind: item.recordKind,
      recordId: item.recordId,
      schemaVersion: item.schemaVersion as number,
      payload: item.payload,
      contentSha256: item.contentSha256 as string,
      recordedAt: item.recordedAt,
      desired: item.desired,
      status: item.status,
    });
  }
  return { schemaVersion: 1, entries };
}

export function createSportingSyncStateRepository(adapter: StorageAdapter): SportingSyncStateRepository {
  return {
    async load() {
      const result = await adapter.get(CLOUD_SPORTING_SYNC_STORAGE_KEY);
      if (result.status === "read_failed") return loadFailed(emptySportingSyncState(), result.error);
      if (result.value === null) return loadedAbsent<SportingSyncState>();
      try {
        const parsed = parseState(JSON.parse(result.value));
        return parsed ? loadedValue(parsed) : loadFailed(emptySportingSyncState(), { kind: "unknown", message: "Cloud sync state is invalid." });
      } catch {
        return loadFailed(emptySportingSyncState(), { kind: "unknown", message: "Cloud sync state is invalid." });
      }
    },
    save(state) {
      return adapter.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, JSON.stringify(state));
    },
  };
}
