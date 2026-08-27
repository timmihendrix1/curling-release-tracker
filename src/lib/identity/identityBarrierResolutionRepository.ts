// Persistence for the `IdentityBarrierResolution` (ADR-0025 §6, §19; Stage B0.2c).
//
// Every resolution lives under a key DERIVED FROM the exact `barrierId` it
// resolves, which is what gives ADR-0025 §6 its central guarantee: **writing
// resolution B cannot alter, overwrite, remove or resolve a newer barrier C.**
// They are different keys by construction. If C was installed while B's write was
// in flight, resolution B is harmless on disk and C remains unresolved.
//
// `loadForBarrier` additionally re-checks that the record it read actually names
// the barrier it was asked about. That is not redundant with the key derivation:
// the key says where the record was found, the field says what the record claims,
// and only agreeing on both makes it evidence.
//
// Ordinary removal here is **best-effort cleanup of already non-current
// resolutions** — enforced by `cleanUpNonCurrentResolution`, which refuses the
// current barrier. The sole separate removal is REQUIRED compensation:
// `retractUnconfirmedResolution` removes the exact resolution the coordinator just
// wrote when its post-write proof failed and the replacement denial fence could
// not be stored. It cannot remove a barrier or a differently keyed resolution.

import { localStorageAdapter } from "../persistence/localStorageAdapter";
import type {
  PersistenceRemoveResult,
  PersistenceWriteResult,
  RemovableStorageAdapter,
} from "../persistence/types";
import { recordMalformed, type IdentityRecordLoad } from "./errors";
import {
  resolutionStorageKeyFor,
  validateIdentityBarrierResolution,
  type IdentityBarrierResolution,
} from "./identityBarrierResolution";
import { readIdentityRecord, removeIdentityRecord, writeIdentityRecord } from "./untrustedValue";

/** Informational only — **no authorization decision reads any of these.** */
export type ResolutionCleanupOutcome =
  | { kind: "removed" }
  /** The barrier asked about IS the current one. Refused. */
  | { kind: "retained_current" }
  /** The supplied barrier id is not a usable id, so no key could be derived. */
  | { kind: "not_addressable" }
  | { kind: "cleanup_failed" };

export interface IdentityBarrierResolutionRepository {
  /** Reads the resolution for exactly this barrier. A record stored under this
   * barrier's key that names a DIFFERENT barrier resolves `malformed`. */
  loadForBarrier(barrierId: string): Promise<IdentityRecordLoad<IdentityBarrierResolution>>;
  /** Writes the resolution under the key derived from `resolution.barrierId`.
   * Failure leaves the application locked (`barrier_resolution_failed`). */
  saveForBarrier(resolution: IdentityBarrierResolution): Promise<PersistenceWriteResult>;
  /**
   * Compensation used only when the coordinator itself has just written a
   * resolution and then cannot complete its post-write proof — including
   * supersession. It removes exactly the derived key and never touches the barrier.
   */
  retractUnconfirmedResolution(barrierId: string): Promise<PersistenceRemoveResult>;
  /**
   * Best-effort removal of a resolution for a barrier that is no longer current.
   *
   * @param barrierId the barrier whose resolution should be cleaned up.
   * @param currentBarrierId the barrier that is current right now; if the two are
   * equal the removal is refused.
   */
  cleanUpNonCurrentResolution(
    barrierId: string,
    currentBarrierId: string
  ): Promise<ResolutionCleanupOutcome>;
}

export function createIdentityBarrierResolutionRepository(
  adapter: RemovableStorageAdapter = localStorageAdapter
): IdentityBarrierResolutionRepository {
  return {
    async loadForBarrier(
      barrierId: string
    ): Promise<IdentityRecordLoad<IdentityBarrierResolution>> {
      const key = resolutionStorageKeyFor(barrierId);
      // An unusable barrier id is not "no resolution exists" — it means the
      // question cannot be asked. Reporting `malformed` keeps the caller failing
      // closed instead of concluding the barrier is simply unresolved for a
      // benign reason.
      if (key === null) return recordMalformed<IdentityBarrierResolution>();

      const stored = await readIdentityRecord(adapter, key, validateIdentityBarrierResolution);
      if (stored.status === "value" && stored.value.barrierId !== barrierId) {
        return recordMalformed<IdentityBarrierResolution>();
      }
      return stored;
    },

    async saveForBarrier(resolution: IdentityBarrierResolution): Promise<PersistenceWriteResult> {
      const rejected: PersistenceWriteResult = {
        ok: false,
        error: { kind: "unknown", message: "The record could not be stored." },
      };

      // SNAPSHOT FIRST. The argument is untrusted at runtime whatever its declared
      // type says: it may be a Proxy, may carry throwing or changing getters, and
      // may define a hostile `toJSON`. `validateIdentityBarrierResolution` reads
      // every property exactly once through the contained readers and returns inert
      // plain data, so nothing below can observe a different value on a second read
      // — and the id used for the KEY is the same id that is stored and compared.
      const snapshot = validateIdentityBarrierResolution(resolution);
      if (snapshot === null) return rejected;

      const key = resolutionStorageKeyFor(snapshot.barrierId);
      if (key === null) return rejected;

      // Validated again against the same rules `loadForBarrier` applies, INCLUDING
      // that the stored record names the barrier whose key it lives under.
      return writeIdentityRecord(adapter, key, snapshot, (raw) => {
        const validated = validateIdentityBarrierResolution(raw);
        if (validated === null) return null;
        return validated.barrierId === snapshot.barrierId ? validated : null;
      });
    },

    async retractUnconfirmedResolution(barrierId: string): Promise<PersistenceRemoveResult> {
      const key = resolutionStorageKeyFor(barrierId);
      if (key === null) {
        return {
          ok: false,
          error: { kind: "removal_failed", message: "The record could not be removed." },
        };
      }
      return removeIdentityRecord(adapter, key);
    },

    async cleanUpNonCurrentResolution(
      barrierId: string,
      currentBarrierId: string
    ): Promise<ResolutionCleanupOutcome> {
      if (barrierId === currentBarrierId) return { kind: "retained_current" };
      const key = resolutionStorageKeyFor(barrierId);
      if (key === null) return { kind: "not_addressable" };
      const removal = await removeIdentityRecord(adapter, key);
      return removal.ok ? { kind: "removed" } : { kind: "cleanup_failed" };
    },
  };
}

export const identityBarrierResolutionRepository: IdentityBarrierResolutionRepository =
  createIdentityBarrierResolutionRepository();
