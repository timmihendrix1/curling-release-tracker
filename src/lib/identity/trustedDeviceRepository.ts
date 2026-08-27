// Persistence for the `TrustedDeviceRecord` (ADR-0025 §15, §19; Stage B0.2c).
//
// Unlike the attempt and resolution repositories, **nothing here is best-effort.**
// docs/PERSISTENCE_BOUNDARY_DESIGN.md §9 is explicit that "best effort" describes
// only the two non-current cleanup rows, never trusted state. All three operations
// are required, and each failure has its own consequence:
//
//  - **Establishment or correlated replacement.** The provider and server
//    operations may already have succeeded — authentication, Profile, onboarding
//    and entitlement can all be done. A write failure is therefore not "the
//    transition stopped before a provider call"; it is
//    `trusted_state_not_established`, and the consequence is that **no ready state
//    is entered**.
//  - **Removal during explicit sign-out or invitation recovery.** The barrier was
//    written first, so a removal failure **blocks provider sign-out** and the
//    already-written unresolved barrier remains authoritative.
//  - **Cleanup during server-driven invalidation.** This runs after immediate
//    in-memory denial and an ATTEMPTED invalidation barrier. If the barrier write
//    failed, removal is the **fallback** durable denial rather than a follow-up to
//    it; if both fail, the honest result is page-lifetime denial only, and no
//    durable offline revocation may be claimed.
//
// The repository itself does not know which case it is in — it reports the
// normalized result and the coordinator applies the consequence.
//
// `malformed` fails closed by DISCARDING (this record only ever grants), which is
// the opposite direction from a barrier. The caller removes it and proceeds as if
// no device trust existed; it is never repaired.

import { localStorageAdapter } from "../persistence/localStorageAdapter";
import type {
  PersistenceRemoveResult,
  PersistenceWriteResult,
  RemovableStorageAdapter,
} from "../persistence/types";
import type { IdentityRecordLoad } from "./errors";
import {
  TRUSTED_DEVICE_STORAGE_KEY,
  validateTrustedDeviceRecord,
  type TrustedDeviceRecord,
} from "./trustedDevice";
import { readIdentityRecord, removeIdentityRecord, writeIdentityRecord } from "./untrustedValue";

export interface TrustedDeviceRepository {
  load(): Promise<IdentityRecordLoad<TrustedDeviceRecord>>;
  /** Required write — establishment, correlated replacement, or a same-scope
   * metadata refresh. The caller distinguishes those three consequences. */
  save(record: TrustedDeviceRecord): Promise<PersistenceWriteResult>;
  /** Required removal. Never best-effort: a failure changes what the caller may
   * do next. */
  remove(): Promise<PersistenceRemoveResult>;
}

export function createTrustedDeviceRepository(
  adapter: RemovableStorageAdapter = localStorageAdapter
): TrustedDeviceRepository {
  return {
    async load(): Promise<IdentityRecordLoad<TrustedDeviceRecord>> {
      return readIdentityRecord(adapter, TRUSTED_DEVICE_STORAGE_KEY, validateTrustedDeviceRecord);
    },

    async save(record: TrustedDeviceRecord): Promise<PersistenceWriteResult> {
      const snapshot = validateTrustedDeviceRecord(record);
      if (snapshot === null) {
        return { ok: false, error: { kind: "unknown", message: "The record could not be stored." } };
      }
      return writeIdentityRecord(
        adapter,
        TRUSTED_DEVICE_STORAGE_KEY,
        snapshot,
        validateTrustedDeviceRecord
      );
    },

    async remove(): Promise<PersistenceRemoveResult> {
      return removeIdentityRecord(adapter, TRUSTED_DEVICE_STORAGE_KEY);
    },
  };
}

export const trustedDeviceRepository: TrustedDeviceRepository = createTrustedDeviceRepository();
