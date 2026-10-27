import type { StorageAdapter } from "../persistence/types";
import { isCanonicalUuid } from "../uuid";

export const DELETION_GUARD_PREFIX = "curling.identity.accountDeletionGuard.";
export const DELETION_GUARD_RESOLUTION_PREFIX = "curling.identity.accountDeletionGuardResolution.";
function isControlKey(key: unknown, prefix: string): boolean {
  if (typeof key !== "string" || key.length !== prefix.length + 36 + 3 || !key.startsWith(prefix) || !key.endsWith(".v1")) return false;
  return isCanonicalUuid(key.slice(prefix.length, -3));
}
/** Key membership alone grants no identity or resolution authority. */
export const isAccountDeletionGuardStorageKey = (key: unknown): boolean => isControlKey(key, DELETION_GUARD_PREFIX);
export const isAccountDeletionGuardResolutionStorageKey = (key: unknown): boolean => isControlKey(key, DELETION_GUARD_RESOLUTION_PREFIX);
export type AccountDeletionGuard = { schemaVersion: 1; profileId: string; nonce: string; revision: number };
type GuardLoad = { status: "absent" } | { status: "unavailable" }
  | { status: "guard"; guard: AccountDeletionGuard; resolved: boolean };
export interface AccountDeletionGuardRepository {
  load(profileId: string): Promise<GuardLoad>;
  begin(profileId: string, revision: number, nonce: string): Promise<AccountDeletionGuard | null>;
  resolve(guard: AccountDeletionGuard, fencedRevision: number): Promise<boolean>;
  canAdmit(profileId: string): Promise<boolean>;
}
export const validDeletionRevision = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < 2147483647;
const guardKey = (profile: string) => `${DELETION_GUARD_PREFIX}${profile}.v1`;
const resolutionKey = (nonce: string) => `${DELETION_GUARD_RESOLUTION_PREFIX}${nonce}.v1`;

/** Authentication never writes or removes these records. A resolution is bound
 * to one operation, so a delayed recovery cannot erase another tab's newer hold.
 * No compare-and-swap or instantaneous cross-tab revocation is claimed. */
export function createAccountDeletionGuardRepository(adapter: StorageAdapter): AccountDeletionGuardRepository {
  async function load(profileId: string): Promise<GuardLoad> {
    try {
      if (!isCanonicalUuid(profileId)) return { status: "unavailable" };
      const first = await adapter.get(guardKey(profileId));
      if (first.status !== "value") return { status: "unavailable" };
      if (first.value === null) return { status: "absent" };
      const value = JSON.parse(first.value);
      if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).sort().join() !== "nonce,profileId,revision,schemaVersion"
        || value.schemaVersion !== 1 || value.profileId !== profileId
        || !isCanonicalUuid(value.nonce) || !validDeletionRevision(value.revision)) return { status: "unavailable" };
      const guard: AccountDeletionGuard = value;
      const resolution = await adapter.get(resolutionKey(guard.nonce));
      if (resolution.status !== "value") return { status: "unavailable" };
      let resolved = false;
      if (resolution.value !== null) {
        const receipt = JSON.parse(resolution.value);
        if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
          || Object.keys(receipt).sort().join() !== "fencedRevision,nonce,profileId,schemaVersion"
          || receipt.schemaVersion !== 1 || receipt.profileId !== profileId || receipt.nonce !== guard.nonce
          || !validDeletionRevision(receipt.fencedRevision) || receipt.fencedRevision <= guard.revision) return { status: "unavailable" };
        resolved = true;
      }
      const after = await adapter.get(guardKey(profileId));
      if (after.status !== "value" || after.value !== first.value) return { status: "unavailable" };
      return { status: "guard", guard, resolved };
    } catch { return { status: "unavailable" }; }
  }
  return {
    load,
    async begin(profileId, revision, nonce) {
      try {
        if (!isCanonicalUuid(profileId) || !isCanonicalUuid(nonce) || !validDeletionRevision(revision)) return null;
        // Never overwrite unreadable evidence. Concurrent valid starts remain
        // fenced by the same server revision, even if their slot writes overlap.
        if ((await load(profileId)).status === "unavailable") return null;
        const guard: AccountDeletionGuard = { schemaVersion: 1, profileId, nonce, revision };
        if (!(await adapter.set(guardKey(profileId), JSON.stringify(guard))).ok) return null;
        const written = await load(profileId);
        return written.status === "guard" && written.guard.nonce === nonce && !written.resolved ? guard : null;
      } catch { return null; }
    },
    async resolve(guard, fencedRevision) {
      try {
        if (!validDeletionRevision(fencedRevision) || fencedRevision <= guard.revision) return false;
        const raw = JSON.stringify({ schemaVersion: 1, profileId: guard.profileId, nonce: guard.nonce, fencedRevision });
        if (!(await adapter.set(resolutionKey(guard.nonce), raw)).ok) return false;
        const read = await adapter.get(resolutionKey(guard.nonce));
        return read.status === "value" && read.value === raw;
      } catch { return false; }
    },
    async canAdmit(profileId) {
      const result = await load(profileId);
      return result.status === "absent" || (result.status === "guard" && result.resolved);
    },
  };
}
