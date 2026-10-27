// Internal S3d provenance. Only the adapter registers issuers; only the dormant
// runner borrows. No I/O, public-counter authority, reset or force-unpin.
import type { NativeMigrationLease, NativeSqliteMigrationTarget, NativeCombinedHeldSqliteHost, NativeMigrationTransaction, NativeMigrationControl } from "./nativeSqliteAdapter";
import { evaluateActivationRecord, type FingerprintFormatPredicate } from "./nativeMigrationRecord";
import type { NativeMigrationEvidence, IssuedTransactionKind } from "./nativeMigrationDecision";

// Only the dormant common owner mints these callback-free cancellation cells.
// Reading currentness never invokes a caller's proceed/getter after the final fence.
const commonControls = new WeakMap<object, { current: boolean }>();
export function createNativeCommonMigrationControl(): { readonly control: NativeMigrationControl; readonly cancel: () => void } {
  const state = { current: true };
  const control = Object.freeze({ proceed: () => state.current });
  commonControls.set(control, state);
  return Object.freeze({ control, cancel: () => { state.current = false; } });
}
export function nativeCommonMigrationControlCurrent(control: unknown): boolean {
  return control !== null && (typeof control === "object" || typeof control === "function") && commonControls.get(control)?.current === true;
}

export interface NativeBorrowSnapshot {
  readonly lifecycle: object;
  readonly evidence: object;
  readonly ready: boolean;
  readonly reopened: object | null;
  readonly initialized?: boolean;
  readonly progress?: boolean;
}
export interface NativeBorrowCapability {
  readonly target: Readonly<NativeSqliteMigrationTarget>;
  readonly lease: NativeMigrationLease;
  snapshot(): NativeBorrowSnapshot | null;
  /** Only this child's clean disposal may remove its pin. The tombstone stays. */
  finishClean(): void;
  readonly combined?: boolean;
  readonly common?: boolean;
  expectedIdentity?(): string | null;
  preparationOnly?(): boolean;
  registerHold?(token: object, identity: string, preparation: "fresh" | "verified", recordBefore: string | null, targetRows: readonly { readonly key: string; readonly value: string }[]): void;
  setCompletionObserver?(observer: () => void): void;
  beginRun?(): boolean;
  endRun?(): void;
  setWarmObserver?(observer: WarmObserver): void;
  retainFault?(): void;
  holdAllowed?(): boolean;
  seal?(tx: NativeMigrationTransaction, operation: IssuedTransactionKind | "write_fault_latch", format: FingerprintFormatPredicate): NativeMigrationTransaction | null;
}
interface Issuer {
  readonly target: Readonly<NativeSqliteMigrationTarget>;
  readonly observe: (lease: NativeMigrationLease) => NativeBorrowSnapshot | null;
  readonly children: WeakMap<NativeMigrationLease, { pinned: boolean }>;
}
const issuers = new WeakMap<object, Issuer>();
const intrinsicThen = Promise.prototype.then;
/** A synchronous format contract never treats async output as truth. Own its
 * rejection without awaiting it or inspecting reasons (including masked then). */
export function observeUnexpectedBorrowedAsync(result: unknown): void {
  if (result !== null && (typeof result === "object" || typeof result === "function")) {
    try { void intrinsicThen.call(result, () => {}, () => {}); }
    catch { void new Promise<unknown>(resolve => resolve(result)).then(() => {}, () => {}); }
  }
}
export function observeBorrowedFingerprintFormat(predicate: FingerprintFormatPredicate, value: string): "valid" | "invalid" | "unavailable" {
  try {
    const result: unknown = predicate(value);
    if (result === true) return "valid";
    if (result === false) return "invalid";
    observeUnexpectedBorrowedAsync(result);
  } catch { /* Closed dependency failure; never inspect the thrown value. */ }
  return "unavailable";
}
export function evaluateBorrowedFingerprintFormat(predicate: FingerprintFormatPredicate, value: string): boolean {
  return observeBorrowedFingerprintFormat(predicate, value) === "valid";
}


/** Called once by the real adapter BEFORE returning its mutable public target. */
export function registerNativeMigrationBorrowIssuer(
  target: NativeSqliteMigrationTarget,
  observe: Issuer["observe"]
): (lease: NativeMigrationLease) => boolean {
  if (issuers.has(target)) throw new TypeError("Duplicate native migration issuer");
  const issuer: Issuer = { target: Object.freeze({ ...target }), observe, children: new WeakMap() };
  issuers.set(target, issuer);
  return lease => issuer.children.get(lease)?.pinned === true;
}

export function borrowNativeMigrationTarget(target: NativeSqliteMigrationTarget, lease: NativeMigrationLease):
  | { readonly ok: false; readonly reason: "unregistered_target" | "wrong_lease" | "requires_reopen" | "borrowed_evidence_held" }
  | { readonly ok: true; readonly capability: NativeBorrowCapability } {
  // WeakMap lookup does not inspect a Proxy or structurally equivalent target.
  const issuer = issuers.get(target);
  if (!issuer) return { ok: false, reason: "unregistered_target" };
  const snapshot = issuer.observe(lease);
  if (!snapshot) return { ok: false, reason: "wrong_lease" };
  if (issuer.children.has(lease)) return { ok: false, reason: "borrowed_evidence_held" };
  if (!snapshot.ready) return { ok: false, reason: "requires_reopen" };
  const child = { pinned: true };
  issuer.children.set(lease, child);
  return { ok: true, capability: Object.freeze({
    target: issuer.target, lease,
    snapshot: () => issuer.observe(lease),
    finishClean: () => { child.pinned = false; },
  }) };
}

// S3e: a separate host identity. Its public object has no domain target methods.
// The pure validator checks owned after-bytes BEFORE a private permission exists.

type WarmObserver = (evidence: NativeMigrationEvidence) => boolean;
interface CombinedChild { pinned: boolean; active: boolean; faulted: boolean; observer: WarmObserver | null; lifecycle: object | null; retire: (() => void) | null; completed: boolean }
export interface NativeCommonBorrowPolicy { expectedIdentity(): string | null; hasQ(): boolean }
export interface NativeCommonHoldEvidence {
  readonly identity: string; readonly preparation: "fresh" | "verified"; readonly recordBefore: string | null;
  readonly targetRows: readonly { readonly key: string; readonly value: string }[];
}
type OwnedHold = NativeCommonHoldEvidence & { child: CombinedChild; lease: NativeMigrationLease; lifecycle: object; evidence: object };
interface CombinedIssuer {
  readonly target: Readonly<NativeSqliteMigrationTarget>;
  readonly observe: Issuer["observe"];
  readonly children: WeakMap<NativeMigrationLease, CombinedChild>;
  readonly observations: WeakMap<NativeMigrationLease, number>;
  readonly permissions: WeakMap<object, { lease: NativeMigrationLease; lifecycle: object; kind: "normal" | "latch" }>;
  readonly common: NativeCommonBorrowPolicy | null;
  readonly holds: WeakMap<object, OwnedHold>;
  readonly finalizations: WeakMap<object, OwnedHold>;
  readonly completed: WeakSet<NativeMigrationLease>;
}
export interface NativeCombinedHostController {
  pinned(lease: NativeMigrationLease): boolean;
  faulted(lease: NativeMigrationLease): boolean;
  beginObservation(lease: NativeMigrationLease): boolean;
  endObservation(lease: NativeMigrationLease): void;
  publishDomain(lease: NativeMigrationLease, evidence: NativeMigrationEvidence): void;
  consume(lease: NativeMigrationLease, tx: NativeMigrationTransaction): "normal" | "latch" | null;
}
export interface NativeCommonHostController extends NativeCombinedHostController {
  resolveHold(lease: NativeMigrationLease, token: unknown): NativeCommonHoldEvidence | null;
  beginCompletion(lease: NativeMigrationLease, token: unknown): { readonly ticket: object; readonly evidence: NativeCommonHoldEvidence } | null;
  endCompletion(lease: NativeMigrationLease): void;
  confirmCompletion(lease: NativeMigrationLease, ticket: object): boolean;
  pinBound(lease: NativeMigrationLease): boolean;
  retireCompletion(lease: NativeMigrationLease): void;
}
const combinedHosts = new WeakMap<object, CombinedIssuer>();

export function registerNativeCombinedHeldHost(
  host: NativeCombinedHeldSqliteHost, target: NativeSqliteMigrationTarget, observe: Issuer["observe"]
): NativeCombinedHostController {
  return registerCombinedHost(host, target, observe, null);
}
export function registerNativeCommonMigrationHost(
  host: NativeCombinedHeldSqliteHost, target: NativeSqliteMigrationTarget, observe: Issuer["observe"], policy: NativeCommonBorrowPolicy
): NativeCommonHostController {
  return registerCombinedHost(host, target, observe, Object.freeze({ expectedIdentity: policy.expectedIdentity, hasQ: policy.hasQ }));
}
function registerCombinedHost(
  host: NativeCombinedHeldSqliteHost, target: NativeSqliteMigrationTarget, observe: Issuer["observe"], common: NativeCommonBorrowPolicy | null
): NativeCommonHostController {
  if (combinedHosts.has(host)) throw new TypeError("Duplicate combined native host");
  const issuer: CombinedIssuer = { target: Object.freeze({ ...target }), observe, children: new WeakMap(), observations: new WeakMap(), permissions: new WeakMap(),
    common, holds: new WeakMap(), finalizations: new WeakMap(), completed: new WeakSet() };
  combinedHosts.set(host, issuer);
  function held(lease: NativeMigrationLease, token: unknown): OwnedHold | null {
    if (!common || token === null || (typeof token !== "object" && typeof token !== "function")) return null;
    const hold = issuer.holds.get(token), child = issuer.children.get(lease), state = observe(lease);
    return hold && hold.lease === lease && hold.child === child && child.pinned && !child.active && !child.faulted && !child.completed && state?.ready && state.progress &&
      state.lifecycle === hold.lifecycle && state.evidence === hold.evidence && !issuer.observations.get(lease) ? hold : null;
  }
  const project = (hold: OwnedHold): NativeCommonHoldEvidence => Object.freeze({ identity: hold.identity, preparation: hold.preparation, recordBefore: hold.recordBefore, targetRows: hold.targetRows });
  return Object.freeze({
    pinned: (lease: NativeMigrationLease) => issuer.children.get(lease)?.pinned === true || issuer.completed.has(lease),
    faulted: (lease: NativeMigrationLease) => issuer.children.get(lease)?.faulted === true,
    beginObservation(lease: NativeMigrationLease) {
      if (!observe(lease) || issuer.children.get(lease)?.active) return false;
      issuer.observations.set(lease, (issuer.observations.get(lease) ?? 0) + 1);
      return true;
    },
    endObservation(lease: NativeMigrationLease) {
      const count = issuer.observations.get(lease) ?? 0;
      if (count > 0) issuer.observations.set(lease, count - 1);
    },
    publishDomain(lease: NativeMigrationLease, evidence: NativeMigrationEvidence) {
      const child = issuer.children.get(lease);
      if (!observe(lease) || !child?.pinned || child.active || !child.observer) return;
      // Only the actual settled child receives these closed observations. No
      // parent observation can run in COMMIT-ack -> child-memory continuation.
      if (child.observer(evidence)) child.faulted = true;
    },
    consume(lease: NativeMigrationLease, tx: NativeMigrationTransaction) {
      const permission = issuer.permissions.get(tx), child = issuer.children.get(lease), state = observe(lease);
      if (!permission || permission.lease !== lease || !state || state.lifecycle !== permission.lifecycle || child?.lifecycle !== permission.lifecycle || !child?.pinned || !child.active) return null;
      issuer.permissions.delete(tx);
      return permission.kind;
    },
    resolveHold: (lease: NativeMigrationLease, token: unknown) => { const hold = held(lease, token); return hold ? project(hold) : null; },
    beginCompletion(lease: NativeMigrationLease, token: unknown) {
      const hold = held(lease, token); if (!hold) return null;
      const ticket = Object.freeze({}); issuer.finalizations.set(ticket, hold); hold.child.active = true;
      return Object.freeze({ ticket, evidence: project(hold) });
    },
    endCompletion(lease: NativeMigrationLease) { const child = issuer.children.get(lease); if (common && child) child.active = false; },
    confirmCompletion(lease: NativeMigrationLease, ticket: object) {
      const hold = issuer.finalizations.get(ticket), child = issuer.children.get(lease);
      if (!common || !hold || hold.lease !== lease || child !== hold.child || child.faulted || !observe(lease)) return false;
      if (!child.completed) { child.retire?.(); child.completed = true; child.pinned = false; issuer.completed.add(lease); }
      return true;
    },
    retireCompletion(lease: NativeMigrationLease) { if (common) issuer.completed.delete(lease); },
    pinBound(lease: NativeMigrationLease) {
      if (!common || !observe(lease) || issuer.children.get(lease)?.active) return false;
      issuer.completed.add(lease); return true;
    },
  });
}

/** Copy only own data; never invoke a transaction getter or retain mutable rows. */
function ownTransaction(tx: NativeMigrationTransaction, current: () => boolean): NativeMigrationTransaction | null {
  if (!current()) return null;
  const descriptors = Object.getOwnPropertyDescriptors(tx);
  if (!current()) return null;
  const values: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor)) return null;
    values[key] = descriptor.value;
  }
  if (values.kind === "checkpoint") {
    const rows = values.rows;
    if (!Array.isArray(rows)) return null;
    const length = Object.getOwnPropertyDescriptor(rows, "length");
    if (!current() || !length || !("value" in length) || !Number.isSafeInteger(length.value) || length.value < 0) return null;
    const owned: { key: string; value: string }[] = [];
    for (let index = 0; index < length.value; index++) {
      if (!current()) return null;
      const descriptor = Object.getOwnPropertyDescriptor(rows, String(index));
      if (!current()) return null;
      if (!descriptor || !("value" in descriptor)) return null;
      const row = Object.getOwnPropertyDescriptors(descriptor.value);
      if (!current()) return null;
      if (Object.keys(row).sort().join(",") !== "key,value" || !("value" in row.key) || !("value" in row.value) ||
          typeof row.key.value !== "string" || typeof row.value.value !== "string") return null;
      owned.push(Object.freeze({ key: row.key.value, value: row.value.value }));
    }
    values.rows = Object.freeze(owned);
  }
  return Object.freeze(values) as unknown as NativeMigrationTransaction;
}

export function borrowNativeCombinedHeldHost(host: NativeCombinedHeldSqliteHost, lease: NativeMigrationLease):
  | { readonly ok: false; readonly reason: "unregistered_host" | "wrong_lease" | "requires_reopen" | "borrowed_evidence_held" | "schema_unproven" | "parent_busy" }
  | { readonly ok: true; readonly capability: NativeBorrowCapability } {
  return borrowCombinedHost(host, lease, false);
}
export function borrowNativeCommonMigrationHost(host: NativeCombinedHeldSqliteHost, lease: NativeMigrationLease) {
  return borrowCombinedHost(host, lease, true);
}
function borrowCombinedHost(host: NativeCombinedHeldSqliteHost, lease: NativeMigrationLease, common: boolean):
  | { readonly ok: false; readonly reason: "unregistered_host" | "wrong_lease" | "requires_reopen" | "borrowed_evidence_held" | "schema_unproven" | "parent_busy" }
  | { readonly ok: true; readonly capability: NativeBorrowCapability } {
  const issuer = combinedHosts.get(host);
  if (!issuer || (issuer.common !== null) !== common) return { ok: false, reason: "unregistered_host" };
  const state = issuer.observe(lease);
  if (!state) return { ok: false, reason: "wrong_lease" };
  if (issuer.children.has(lease)) return { ok: false, reason: "borrowed_evidence_held" };
  if (issuer.observations.get(lease)) return { ok: false, reason: "parent_busy" };
  if (!state.ready) return { ok: false, reason: "requires_reopen" };
  if (!state.initialized) return { ok: false, reason: "schema_unproven" };
  const child: CombinedChild = { pinned: true, active: false, faulted: false, observer: null, lifecycle: null, retire: null, completed: false };
  issuer.children.set(lease, child);
  return { ok: true, capability: Object.freeze({
    target: issuer.target, lease, combined: true,
    ...(common ? { common: true, expectedIdentity: () => issuer.common!.expectedIdentity(), preparationOnly: () => issuer.common!.hasQ(),
      registerHold(token: object, identity: string, preparation: "fresh" | "verified", recordBefore: string | null, targetRows: readonly { readonly key: string; readonly value: string }[]) {
        const state = issuer.observe(lease);
        if (state?.ready && state.progress && child.active && child.pinned && !child.faulted && !child.completed && state.lifecycle === child.lifecycle) {
          const rows = Object.freeze(targetRows.map(row => Object.freeze({ key: row.key, value: row.value })));
          issuer.holds.set(token, { identity, preparation, recordBefore, targetRows: rows, child, lease, lifecycle: state.lifecycle, evidence: state.evidence });
        }
      },
      setCompletionObserver: (observer: () => void) => { if (!child.retire) child.retire = observer; },
    } : {}),
    snapshot: () => issuer.observe(lease),
    finishClean: () => { if (!child.active && !child.faulted) child.pinned = false; },
    beginRun: () => {
      if (!child.pinned || child.completed || child.active || issuer.observations.get(lease)) return false;
      child.lifecycle = issuer.observe(lease)?.lifecycle ?? null;
      child.active = true; return true;
    },
    endRun: () => { child.active = false; child.lifecycle = null; },
    setWarmObserver: (observer: WarmObserver) => { if (!child.observer) child.observer = observer; },
    retainFault: () => { child.faulted = true; },
    holdAllowed: () => issuer.observe(lease)?.progress === true && !issuer.observations.get(lease),
    seal: (tx: NativeMigrationTransaction, operation: IssuedTransactionKind | "write_fault_latch", format: FingerprintFormatPredicate) => {
      const before = issuer.observe(lease);
      if (!before?.ready || before.lifecycle !== child.lifecycle || !child.active || !child.pinned) return null;
      try {
        const current = () => { const state = issuer.observe(lease); return state?.ready === true && state.lifecycle === before.lifecycle && child.active && child.pinned; };
        const owned = ownTransaction(tx, current);
        if (!owned) return null;
        let kind: "normal" | "latch";
        if (operation === "write_fault_latch") {
          if (!child.faulted || owned.kind !== "insert_latch" || typeof owned.content !== "string" || !owned.content) return null;
          kind = "latch";
        } else {
          if (issuer.common?.hasQ()) return null;
          const expected = operation === "create_enumerating" ? "create_record" : operation === "checkpoint" ? "checkpoint" :
            ["replace_enumerating", "begin_copying", "complete_copying"].includes(operation) ? "replace_record" : null;
          if (!expected || owned.kind !== expected || !("recordAfter" in owned) || typeof owned.recordAfter !== "string") return null;
          const guardedFormat: FingerprintFormatPredicate = value => {
            if (!current()) return false;
            const accepted = evaluateBorrowedFingerprintFormat(format, value);
            return current() && accepted;
          };
          const parsed = evaluateActivationRecord(owned.recordAfter, guardedFormat);
          if (!parsed.ok || parsed.record.phase === "active") return null;
          kind = "normal";
        }
        const after = issuer.observe(lease);
        if (!after?.ready || after.lifecycle !== before.lifecycle || !child.active || !child.pinned) return null;
        issuer.permissions.set(owned, { lease, lifecycle: before.lifecycle, kind });
        return owned;
      } catch { return null; }
    },
  }) };
}
