// Internal S3c coordination for ONE fixed protected namespace in this JS context.
// No storage, native lock, pairing/freshness grant or reset/force-unlock API.
export type CredentialNamespaceLease = Readonly<{ id: string }>;
export type CredentialNamespaceRefusal = "lease_held" | "wrong_lease" | "no_lease" | "faulted" | "releasing" | "ownership_unavailable" | "operation_failed";
export type CredentialNamespaceResult<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly reason: CredentialNamespaceRefusal };
type Holder = { identity: object; lease: CredentialNamespaceLease; faulted: boolean; releasing: boolean; release: Promise<CredentialNamespaceResult<void>> | null };
let holder: Holder | null = null;
let ordinal = 0;
let tail: Promise<void> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = tail.then(task, task);
  tail = result.then(() => undefined, () => undefined);
  return result;
}
export const ordinaryCredentialNamespaceAvailable = (): boolean => holder === null;
export function runOrdinaryCredentialOperation<T>(task: () => Promise<T>, refused: () => T): Promise<T> {
  // Call-time refusal matters: an operation arriving behind queued release must
  // not be postponed and executed after the lease disappears.
  if (holder !== null) return Promise.resolve(refused());
  return enqueue(() => holder === null ? task() : Promise.resolve(refused()));
}
export function createCredentialNamespaceOwner() {
  const identity = Object.freeze({});
  const refusal = (lease: CredentialNamespaceLease, active: boolean): CredentialNamespaceRefusal | null => {
    if (holder === null) return "no_lease";
    if (holder.identity !== identity || holder.lease !== lease) return "wrong_lease";
    if (active && holder.releasing) return "releasing";
    if (active && holder.faulted) return "faulted";
    return null;
  };
  return Object.freeze({
    acquire(): Promise<CredentialNamespaceResult<CredentialNamespaceLease>> {
      if (holder !== null) return Promise.resolve({ ok: false, reason: "lease_held" });
      return enqueue(async () => {
        if (holder !== null) return { ok: false, reason: "lease_held" };
        if (ordinal === Number.MAX_SAFE_INTEGER) return { ok: false, reason: "ownership_unavailable" };
        const lease = Object.freeze({ id: `credential-namespace#${++ordinal}` });
        holder = { identity, lease, faulted: false, releasing: false, release: null };
        return { ok: true, value: lease };
      });
    },
    run<T>(lease: CredentialNamespaceLease, task: (current: () => boolean) => Promise<T>): Promise<CredentialNamespaceResult<T>> {
      const stopped = refusal(lease, true);
      if (stopped) return Promise.resolve({ ok: false, reason: stopped });
      return enqueue(async () => {
        const stopped = refusal(lease, true);
        if (stopped) return { ok: false, reason: stopped };
        try { return { ok: true, value: await task(() => refusal(lease, true) === null) }; }
        catch {
          if (holder?.identity === identity && holder.lease === lease) holder.faulted = true;
          return { ok: false, reason: "operation_failed" };
        }
      });
    },
    fault(lease: CredentialNamespaceLease): void {
      if (holder?.identity === identity && holder.lease === lease) holder.faulted = true;
    },
    release(lease: CredentialNamespaceLease): Promise<CredentialNamespaceResult<void>> {
      const stopped = refusal(lease, false);
      if (stopped) return Promise.resolve({ ok: false, reason: stopped });
      const owned = holder as Holder;
      if (owned.release !== null) return owned.release;
      owned.releasing = true; // Synchronous, before queuing/awaiting issued work.
      owned.release = enqueue(async () => {
        if (holder !== owned) return { ok: false, reason: "wrong_lease" };
        holder = null;
        return { ok: true, value: undefined };
      });
      return owned.release;
    },
    // Internal paired cleanup: drain while retaining the logical reservation.
    prepareRelease(lease: CredentialNamespaceLease): Promise<CredentialNamespaceResult<object>> {
      const stopped = refusal(lease, false);
      if (stopped) return Promise.resolve({ ok: false, reason: stopped });
      const owned = holder as Holder;
      owned.releasing = true;
      return enqueue(async () => holder === owned ? { ok: true, value: owned } : { ok: false, reason: "wrong_lease" });
    },
    releaseReady(lease: CredentialNamespaceLease, receipt: object): boolean {
      return holder === receipt && holder.identity === identity && holder.lease === lease && holder.releasing;
    },
    healthyReleaseReady(lease: CredentialNamespaceLease, receipt: object): boolean {
      return holder === receipt && holder.identity === identity && holder.lease === lease && holder.releasing && !holder.faulted;
    },
    retire(lease: CredentialNamespaceLease, receipt: object): void {
      if (holder === receipt && holder.identity === identity && holder.lease === lease && holder.releasing) holder = null;
    },
    state(): "unowned" | "owned" | "faulted" | "releasing" {
      if (holder?.identity !== identity) return "unowned";
      return holder.releasing ? "releasing" : holder.faulted ? "faulted" : "owned";
    },
  });
}
