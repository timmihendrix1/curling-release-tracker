// Private source constraints; no archived receipt or identity becomes admission.
import { readPublishedInstallationBinding } from "./installationPublishedBinding";
import type { SourceDenialFacts } from "./installationTransferSourceDenial";
import { resolveTransferSourceDenial } from "./installationTransferSourceDenial";
import { createAccountDeletionGuardRepository, DELETION_GUARD_PREFIX, DELETION_GUARD_RESOLUTION_PREFIX, validDeletionRevision, type AccountDeletionGuard, type AccountDeletionGuardRepository } from "../identity/accountDeletionGuard";
import { isCanonicalUuid } from "../uuid";
import type { StorageAdapter, StorageGetResult } from "./types";

type Load = Awaited<ReturnType<AccountDeletionGuardRepository["load"]>>;
export type TransferSourceGuardRepository = AccountDeletionGuardRepository & Readonly<{ acceptControl(profileId: string, revision: number): boolean }>;
const unavailable = (): Load => ({ status: "unavailable" });
const failedRead = (): StorageGetResult => ({ status: "read_failed", fallback: null, error: { kind: "storage_unavailable" } });
const sameGuard = (a: AccountDeletionGuard, b: AccountDeletionGuard): boolean => a.schemaVersion === 1 && b.schemaVersion === 1
  && a.profileId === b.profileId && a.nonce === b.nonce && a.revision === b.revision;
const guardKey = (profile: string) => DELETION_GUARD_PREFIX + profile + ".v1";
const receiptKey = (nonce: string) => DELETION_GUARD_RESOLUTION_PREFIX + nonce + ".v1";

/** One genuine owner per actual pair. Its inspector identifies completions only. */
export function createTransferSourceGuardOwner(handle: unknown) {
  const projection = resolveTransferSourceDenial(handle);
  if (!projection) return null;
  return createGuardOwner(projection.facts);
}
/** Distinct genuine cold publication consumer; never fabricates a source handle. */
export function createPublishedSourceGuardOwner(binding: unknown) {
  const original = readPublishedInstallationBinding(binding);
  return original ? createGuardOwner(original.source) : null;
}
function createGuardOwner(facts: SourceDenialFacts) {
  const originals = new Map(facts.guards.map(guard => [guard.profileId, guard]));
  const floors = new Map(facts.guards.map(guard => [guard.profileId, Math.max(guard.revision, guard.fencedRevision ?? guard.revision)]));
  const completions = new WeakSet<object>();
  let mutation: object | null = null;
  let sequence: object = {};
  return Object.freeze({
    ownsCompletion(value: unknown): boolean {
      return value !== null && (typeof value === "object" || typeof value === "function") && completions.has(value);
    },
    repository(adapter: StorageAdapter, current: () => boolean): TransferSourceGuardRepository {
      const live = () => { try { return current() === true; } catch { return false; } };
      const controls = new Map<string, number>();
      const currentControl = (profileId: string) => !controls.has(profileId) || controls.get(profileId)! >= floors.get(profileId)!;
      const currentControls = () => [...controls.keys()].every(currentControl);
      const rememberReceipt = (profileId: string, raw: string | null | undefined) => {
        if (originals.has(profileId) && raw !== null && raw !== undefined) floors.set(profileId, Math.max(floors.get(profileId)!, JSON.parse(raw).fencedRevision));
      };
      const guarded: StorageAdapter = Object.freeze({
        async get(key: string) {
          if (!live() || !currentControls()) return failedRead();
          const result = await adapter.get(key);
          return live() && currentControls() ? result : failedRead();
        },
        async set(key: string, value: string) {
          const refused = () => ({ ok: false as const, error: { kind: "storage_unavailable" as const } });
          if (!live() || !currentControls()) return refused();
          const result = await adapter.set(key, value);
          return live() && currentControls() ? result : refused();
        },
      });
      function operation<T>(work: () => Promise<T>, failure: () => T, claim?: object): Promise<T> {
        // The exact outward promise is registered before any adapter work starts.
        const whole = Promise.resolve().then(async () => {
          try { return live() ? await work() : failure(); }
          catch { return failure(); }
          finally { if (claim && mutation === claim) mutation = null; }
        });
        completions.add(whole);
        return whole;
      }
      type Observed = Readonly<{ result: Load; receipts: ReadonlyMap<string, string | null> }>;
      async function observe(profileId: string): Promise<Observed> {
        const receipts = new Map<string, string | null>();
        const tracked: StorageAdapter = Object.freeze({
          async get(key: string) {
            const result = await guarded.get(key);
            if (result.status === "value" && key.startsWith(DELETION_GUARD_RESOLUTION_PREFIX)) receipts.set(key, result.value);
            return result;
          },
          set: guarded.set,
        });
        const destination = await createAccountDeletionGuardRepository(tracked).load(profileId);
        const refused = (): Observed => ({ result: unavailable(), receipts });
        if (!live() || destination.status === "unavailable") return refused();
        const source = originals.get(profileId);
        if (!source) return { result: destination, receipts };
        if (destination.status === "guard" && destination.guard.nonce === source.nonce && destination.guard.revision !== source.revision) return refused();
        if (destination.status === "guard" && destination.resolved) rememberReceipt(profileId, receipts.get(receiptKey(destination.guard.nonce)));
        const original: AccountDeletionGuard = { schemaVersion: 1, profileId, nonce: source.nonce, revision: source.revision };
        const raw = JSON.stringify(original);
        // Actual reads still prove availability/currentness. Only the negative
        // original guard is projected; its archived resolution is never supplied.
        const sourceAdapter: StorageAdapter = Object.freeze({
          async get(key: string) {
            const value = await tracked.get(key);
            return key === guardKey(profileId) && value.status === "value" ? { status: "value" as const, value: raw } : value;
          },
          async set() { return { ok: false as const, error: { kind: "storage_unavailable" as const } }; },
        });
        const loaded = await createAccountDeletionGuardRepository(sourceAdapter).load(profileId);
        if (!live() || loaded.status !== "guard") return refused();
        const receipt = receipts.get(receiptKey(source.nonce));
        if (loaded.resolved) rememberReceipt(profileId, receipt);
        if (!currentControl(profileId)) return refused();
        const resolved = loaded.resolved && receipt !== undefined && receipt !== null
          && JSON.parse(receipt).fencedRevision > Math.max(source.revision, source.fencedRevision ?? source.revision);
        if (!resolved) return { result: { status: "guard", guard: original, resolved: false }, receipts };
        // A once-observed newer destination fence cannot be undone by an older
        // matching receipt. For a newer destination guard, its own resolution is
        // the effective fence; the original receipt need not exceed that guard.
        const effective = destination.status === "guard" && destination.resolved
          ? receipts.get(receiptKey(destination.guard.nonce)) : receipt;
        if ((destination.status === "absent" || destination.status === "guard" && destination.resolved)
          && (effective === null || effective === undefined || JSON.parse(effective).fencedRevision < floors.get(profileId)!)) {
          return { result: { status: "guard", guard: destination.status === "guard" ? destination.guard : original, resolved: false }, receipts };
        }
        return { result: destination.status === "absent" ? { status: "guard", guard: original, resolved: true } : destination, receipts };
      }
      function claimMutation<T>(failure: () => T, work: () => Promise<T>): Promise<T> {
        if (mutation) return operation(async () => failure(), failure);
        const claim = {}; mutation = claim; sequence = {};
        return operation(work, failure, claim);
      }
      const repository: TransferSourceGuardRepository = {
        acceptControl(profileId, revision) {
          if (!live() || mutation || !isCanonicalUuid(profileId) || !validDeletionRevision(revision)) return false;
          const source = originals.get(profileId);
          if (source) controls.set(profileId, revision);
          return !source || currentControl(profileId);
        },
        load(profileId) {
          const blocked = mutation !== null, originalSequence = sequence;
          return operation(async () => {
            if (blocked || mutation) return unavailable();
            const observed = await observe(profileId);
            return live() && !mutation && sequence === originalSequence && currentControl(profileId) ? observed.result : unavailable();
          }, unavailable);
        },
        canAdmit(profileId) {
          const blocked = mutation !== null, originalSequence = sequence;
          return operation(async () => {
            if (blocked || mutation) return false;
            const loaded = (await observe(profileId)).result;
            return live() && !mutation && sequence === originalSequence && currentControl(profileId) && (loaded.status === "absent" || loaded.status === "guard" && loaded.resolved);
          }, () => false);
        },
        begin(profileId, revision, nonce) {
          return claimMutation(() => null, async () => {
            if (!isCanonicalUuid(profileId) || !isCanonicalUuid(nonce) || !validDeletionRevision(revision)) return null;
            const source = originals.get(profileId);
            if (source && revision < Math.max(source.revision, source.fencedRevision ?? source.revision)) return null;
            const before = (await observe(profileId)).result;
            if (!live() || !currentControl(profileId) || source && revision < floors.get(profileId)! || before.status === "unavailable" || before.status === "guard" && !before.resolved) return null;
            // Reusing an existing nonce with another revision is contradictory.
            if (source?.nonce === nonce && source.revision !== revision) return null;
            return await createAccountDeletionGuardRepository(guarded).begin(profileId, revision, nonce);
          });
        },
        resolve(guard, fencedRevision) {
          return claimMutation(() => false, async () => {
            if (!validDeletionRevision(fencedRevision)) return false;
            const { result: before, receipts } = await observe(guard.profileId);
            if (!live() || !currentControl(guard.profileId) || before.status !== "guard" || !sameGuard(before.guard, guard) || fencedRevision <= before.guard.revision) return false;
            const source = originals.get(guard.profileId);
            if (source?.nonce === guard.nonce && fencedRevision <= Math.max(source.revision, source.fencedRevision ?? source.revision)) return false;
            const receipt = receipts.get(receiptKey(guard.nonce));
            // Both repositories validated this exact primitive during this load.
            // No other owned mutation can interleave the read/check/write.
            if (receipt !== null && receipt !== undefined) {
              const previous = JSON.parse(receipt).fencedRevision;
              if (previous > fencedRevision) return false;
              if (previous === fencedRevision) return live();
            }
            if (source && fencedRevision <= floors.get(guard.profileId)!) return false;
            const resolved = await createAccountDeletionGuardRepository(guarded).resolve(before.guard, fencedRevision);
            if (resolved && source) floors.set(guard.profileId, Math.max(floors.get(guard.profileId)!, fencedRevision));
            return resolved;
          });
        },
      };
      return Object.freeze(repository);
    },
  });
}
