// Persistence for the `IdentityAccessBarrier` (ADR-0025 §5, §6, §19; Stage B0.2c).
//
// **This repository has no removal path, by construction.** Its adapter parameter
// is annotated with the BASE `StorageAdapter` — not `RemovableStorageAdapter` —
// so `remove` is erased at this boundary even when the real production adapter
// (which does implement it) is passed in. There is nothing to review, spy on or
// remember: a code path that removes the current barrier as a security transition
// cannot be written here without first widening this type, which a type-level
// test and an import scan both catch.
//
// That is the whole point of ADR-0025 §6: a barrier is **superseded** by writing a
// newer one (always the deny-ward direction) and **completed** by an
// `IdentityBarrierResolution` written under a key derived from its own
// `barrierId`. It is never deleted, because `StorageAdapter` offers no
// compare-and-delete and claims no multi-key atomicity, so a read-then-delete
// finalization could remove a barrier another tab installed in between.
//
// Last-writer-wins on the single shared key is safe here precisely because every
// write denies at least as much as the write it replaces.
//
// `malformed` is deliberately NOT folded into `absent` (errors.ts): a barrier only
// ever denies, so failing closed means an unreadable or unrecognized barrier stays
// in force and the caller quarantines. Treating it as absent would turn corruption
// into access.

import { localStorageAdapter } from "../persistence/localStorageAdapter";
import type { PersistenceWriteResult, StorageAdapter } from "../persistence/types";
import type { IdentityRecordLoad } from "./errors";
import {
  IDENTITY_BARRIER_STORAGE_KEY,
  validateIdentityAccessBarrier,
  type IdentityAccessBarrier,
} from "./identityBarrier";
import { readIdentityRecord, writeIdentityRecord } from "./untrustedValue";

export interface IdentityBarrierRepository {
  /** Reads the current barrier. Never throws, for any adapter behaviour. */
  load(): Promise<IdentityRecordLoad<IdentityAccessBarrier>>;
  /** Durably installs a barrier. Every deliberate identity transition calls this
   * FIRST and refuses to start when it fails. */
  save(barrier: IdentityAccessBarrier): Promise<PersistenceWriteResult>;
}

/**
 * @param adapter deliberately typed as the base `StorageAdapter`. Passing the
 * real `RemovableStorageAdapter` is fine and normal — the narrower parameter type
 * is what makes its `remove` unreachable from inside this module.
 */
export function createIdentityBarrierRepository(
  adapter: StorageAdapter = localStorageAdapter
): IdentityBarrierRepository {
  return {
    async load(): Promise<IdentityRecordLoad<IdentityAccessBarrier>> {
      return readIdentityRecord(adapter, IDENTITY_BARRIER_STORAGE_KEY, validateIdentityAccessBarrier);
    },

    async save(barrier: IdentityAccessBarrier): Promise<PersistenceWriteResult> {
      // Snapshot the untrusted argument into inert plain data first, then write it
      // and validate the stored representation with the SAME validator `load` uses.
      // A reported success therefore implies the next load will accept what is
      // stored — which is what makes "the barrier is durably established, so a
      // provider call may now begin" a true statement.
      const snapshot = validateIdentityAccessBarrier(barrier);
      if (snapshot === null) {
        return { ok: false, error: { kind: "unknown", message: "The record could not be stored." } };
      }
      return writeIdentityRecord(
        adapter,
        IDENTITY_BARRIER_STORAGE_KEY,
        snapshot,
        validateIdentityAccessBarrier
      );
    },
  };
}

export const identityBarrierRepository: IdentityBarrierRepository =
  createIdentityBarrierRepository();
