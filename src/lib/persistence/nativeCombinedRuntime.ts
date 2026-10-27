// Dormant S3g: private paired role transition. No application or SDK admission.
import type { RemovableStorageAdapter } from "./types";
import type { SecureCredentialStore } from "./secureCredentialStore";

export type NativeRuntimeOperation = "read" | "write" | "remove";
export type NativeRuntimeTransactionEvidence = Readonly<{
  beginIssued: boolean; beginAcknowledged: boolean;
  statementIssued: boolean; statementAcknowledged: boolean;
  commitIssued: boolean; commitAcknowledged: boolean;
  rollbackIssued: boolean; rollbackAcknowledged: boolean;
}>;
export type NativeRuntimeEvidence = Readonly<{
  operation: NativeRuntimeOperation; issued: boolean; acknowledged: boolean;
  verified: boolean; previousValueMayBeLost?: boolean; controlReadIssued?: boolean; transaction?: NativeRuntimeTransactionEvidence; outcome: "success" | "unverified" | "refused";
}>;
export type NativeRuntimeCleanupEvidence = Readonly<{ sqlCloseIssued: boolean; sqlCloseAcknowledged: boolean; engineReleaseIssued: boolean; engineReleaseAcknowledged: boolean; namespaceDrainIssued: boolean; namespaceDrainAcknowledged: boolean }>;
export type NativeRuntimeHealth = Readonly<{
  domain: "healthy" | "failed"; credential: "healthy" | "failed";
  protocol: "healthy" | "faulted"; lifecycle: "prepared" | "active" | "closed";
  lastDomain: NativeRuntimeEvidence | null; lastCredential: NativeRuntimeEvidence | null;
  firstDomainFailure: NativeRuntimeEvidence | null; firstCredentialFailure: NativeRuntimeEvidence | null;
  cleanup: NativeRuntimeCleanupEvidence;
}>;
export interface NativeCombinedRuntimePair {
  readonly domain: RemovableStorageAdapter;
  readonly credentials: SecureCredentialStore;
  health(): NativeRuntimeHealth;
  dispose(): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: "evidence_held" | "cleanup_unconfirmed" }>;
}
// Membership, not a supplied callback or matching shape, authenticates the cells.
export type NativeRuntimeSession = Readonly<{ readonly identity: object }>;
type State = { active: boolean; closed: boolean; domain: boolean; credential: boolean; protocol: boolean;
  lastDomain: NativeRuntimeEvidence | null; lastCredential: NativeRuntimeEvidence | null; firstDomainFailure: NativeRuntimeEvidence | null; firstCredentialFailure: NativeRuntimeEvidence | null; fault: () => void; closeFault: () => void; cleanup: NativeRuntimeCleanupEvidence };
const sessions = new WeakMap<object, State>();
// Private source facts, authenticated by the genuine published pair. This is
// deliberately separate from the public pair and never grants storage access.
const revocations = new WeakMap<NativeCombinedRuntimePair, Set<() => void>>();
// Completion ownership only, never evidence or access authority. Legacy publishers
// do not register here; their established disposal behavior stays unchanged.
const transferCompletions = new WeakMap<NativeRuntimeSession, WeakSet<object>>();
// Only the closed transfer SQL/credential producers call this. Membership is
// solely a cycle exclusion: it never provides a value, ACK or admission.
export function registerTransferRuntimeCompletion(session: NativeRuntimeSession, completion: Promise<unknown>): void {
  transferCompletions.get(session)?.add(completion);
}
export function ownsTransferRuntimeCompletion(session: NativeRuntimeSession, value: unknown): boolean {
  return value !== null && (typeof value === "object" || typeof value === "function") && transferCompletions.get(session)?.has(value) === true;
}
const sourceListeners = new WeakMap<NativeRuntimeSession, Set<() => void>>();
function notifyRevocation(session: NativeRuntimeSession): void {
  const listeners = sourceListeners.get(session);
  if (listeners) for (const listener of [...listeners]) {
    if (!listeners.has(listener)) continue;
    try { listener(); } catch { /* private observation cannot alter source failure */ }
  }
}
export function subscribeNativeRuntimeRevocation(pair: NativeCombinedRuntimePair, listener: () => void): () => void {
  const listeners = revocations.get(pair);
  if (!listeners) return () => {};
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function createNativeRuntimeSession(fault: () => void, closeFault: () => void): NativeRuntimeSession {
  const session = Object.freeze({ identity: Object.freeze({}) });
  sessions.set(session, { active: false, closed: false, domain: true, credential: true, protocol: true, lastDomain: null, lastCredential: null, firstDomainFailure: null, firstCredentialFailure: null, fault, closeFault, cleanup: Object.freeze({ sqlCloseIssued: false, sqlCloseAcknowledged: false, engineReleaseIssued: false, engineReleaseAcknowledged: false, namespaceDrainIssued: false, namespaceDrainAcknowledged: false }) });
  return session;
}
export function nativeRuntimeCurrent(session: NativeRuntimeSession, lane: "domain" | "credential", prepared = false): boolean {
  const s = sessions.get(session);
  return !!s && (s.active || prepared) && !s.closed && s.protocol && s.domain && (lane !== "credential" || s.credential);
}
// Storage fact only: healthy lifecycle closure is not a storage failure. This
// supplies no active operation, cleanup receipt or publication authority.
export function nativeRuntimeStorageHealthy(session: NativeRuntimeSession): boolean {
  const s = sessions.get(session);
  return !!s && s.domain && s.credential && s.protocol;
}
export function abandonNativeRuntimeSession(session: NativeRuntimeSession): void { const s = sessions.get(session); if (s && !s.active) s.closed = true; }
export function nativeRuntimeFailed(session: NativeRuntimeSession, lane: "domain" | "credential"): void {
  const s = sessions.get(session); if (!s || !s[lane]) return;
  s[lane] = false;
  // Credential admission is handled by the later first-failure evidence. A
  // generic credential pulse here would precede that evidence and destroy Q1.
  if (lane === "domain") notifyRevocation(session);
}
export function nativeRuntimeProtocolFault(session: NativeRuntimeSession): void {
  const s = sessions.get(session); if (!s || !s.protocol) return;
  s.protocol = false; // Revoke all existing anchor rights synchronously.
  if (!s.closed) s.fault();
  notifyRevocation(session);
}
export function nativeRuntimeEvidence(session: NativeRuntimeSession, lane: "domain" | "credential", value: NativeRuntimeEvidence, failedAtSource = false): void {
  const s = sessions.get(session); if (!s) return;
  const evidence = Object.freeze({ ...value, ...(value.transaction ? { transaction: Object.freeze({ ...value.transaction }) } : {}) });
  s[lane === "domain" ? "lastDomain" : "lastCredential"] = evidence;
  const first = lane === "domain" ? "firstDomainFailure" : "firstCredentialFailure";
  if (!s[lane] && s[first] === null && (value.outcome === "unverified" || failedAtSource)) s[first] = evidence;
}
export function nativeRuntimeCleanup(session: NativeRuntimeSession, values: Partial<NativeRuntimeCleanupEvidence>): void {
  const s = sessions.get(session); if (s) s.cleanup = Object.freeze({ ...s.cleanup, ...values });
}
export interface NativeRuntimeDraft {
  ready(): boolean;
  activate(): void;
  abandon(): void;
  close(): Promise<object | null>;
  releaseReady(receipt: object): boolean;
  retire(receipt: object): void;
}
export interface NativeRuntimeDomainDraft extends NativeRuntimeDraft {
  readonly adapter: RemovableStorageAdapter;
  anchor(): Promise<object | null>;
  anchorCurrent(token: object): boolean;
}
export interface NativeRuntimeCredentialDraft extends NativeRuntimeDraft { readonly store: SecureCredentialStore }
export function publishNativeCombinedRuntime(
  session: NativeRuntimeSession, domain: NativeRuntimeDomainDraft, credential: NativeRuntimeCredentialDraft,
): NativeCombinedRuntimePair | null {
  return buildRuntimePair(session, domain, credential, false);
}
/** Closed transfer graph only; caller supplies no drafts to its owner API. */
export function publishTransferIdentityRuntime(
  session: NativeRuntimeSession, domain: NativeRuntimeDomainDraft, credential: NativeRuntimeCredentialDraft,
): NativeCombinedRuntimePair | null {
  return buildRuntimePair(session, domain, credential, true);
}
/** Closed published owner only; shares the actual paired lifecycle. */
export function publishPublishedInstallationRuntime(
  session: NativeRuntimeSession, domain: NativeRuntimeDomainDraft, credential: NativeRuntimeCredentialDraft, beforeClose?: () => Promise<void>,
): NativeCombinedRuntimePair | null {
  return buildRuntimePair(session, domain, credential, true, beforeClose);
}
function buildRuntimePair(session: NativeRuntimeSession, domain: NativeRuntimeDomainDraft, credential: NativeRuntimeCredentialDraft, retryCleanup: boolean, beforeClose?: () => Promise<void>): NativeCombinedRuntimePair | null {
  const s = sessions.get(session);
  if (!s || s.active || s.closed || !s.protocol || !s.domain || !s.credential || !domain.ready() || !credential.ready()) return null;
  // All functions here are privately minted module closures. No awaits or caller
  // callbacks occur between role commits and the single pair publication.
  domain.activate(); credential.activate(); s.active = true;
  if (retryCleanup) transferCompletions.set(session, new WeakSet());
  let disposal: ReturnType<NativeCombinedRuntimePair["dispose"]> | null = null;
  const listeners = new Set<() => void>(); sourceListeners.set(session, listeners);
  const pair: NativeCombinedRuntimePair = Object.freeze({ domain: domain.adapter, credentials: credential.store,
    health: (): NativeRuntimeHealth => Object.freeze({ domain: s.domain ? "healthy" : "failed", credential: s.credential ? "healthy" : "failed",
      protocol: s.protocol ? "healthy" : "faulted", lifecycle: s.closed ? "closed" : s.active ? "active" : "prepared", lastDomain: s.lastDomain, lastCredential: s.lastCredential, firstDomainFailure: s.firstDomainFailure, firstCredentialFailure: s.firstCredentialFailure, cleanup: s.cleanup }),
    dispose() {
      if (disposal) return disposal;
      let finish!: (value: Awaited<ReturnType<NativeCombinedRuntimePair["dispose"]>>) => void;
      disposal = new Promise(done => { finish = done; });
      transferCompletions.get(session)?.add(disposal);
      s.closed = true; // At call time, revoke both lanes including issued anchors.
      notifyRevocation(session); listeners.clear();
      s.closeFault(); // Private owner cell: queued F work loses authority too.
      void (async () => {
        // Only the published owner supplies this actual outstanding-effects
        // drain. Revocation/completion publication above always precede it.
        if (beforeClose) await beforeClose();
        const [sqlReceipt, protectedReceipt] = await Promise.all([domain.close(), credential.close()]);
        if (!sqlReceipt || !protectedReceipt) return { ok: false as const, reason: "cleanup_unconfirmed" as const };
        if (!s.protocol || !s.domain || !s.credential) return { ok: false as const, reason: "evidence_held" as const };
        if (!domain.releaseReady(sqlReceipt) || !credential.releaseReady(protectedReceipt)) return { ok: false as const, reason: "cleanup_unconfirmed" as const };
        domain.retire(sqlReceipt); credential.retire(protectedReceipt);
        return { ok: true as const };
      })().then(result => {
        if (retryCleanup && !result.ok && result.reason === "cleanup_unconfirmed" && s.protocol && s.domain && s.credential) disposal = null;
        finish(result);
      }, () => {
        if (retryCleanup && s.protocol && s.domain && s.credential) disposal = null;
        finish({ ok: false, reason: "cleanup_unconfirmed" });
      });
      return disposal;
    },
  });
  revocations.set(pair, listeners);
  return pair;
}

// Only directly observed malformed dependency/settlement values, never a search
// through arbitrary payloads. Callers revoke permission BEFORE this observation.
const intrinsicThen = Promise.prototype.then;
export function observeNativeRuntimeMalformed(value: unknown): void {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
  try { void Reflect.apply(intrinsicThen, value, [() => {}, () => {}]); }
  catch { void new Promise<unknown>(resolve => resolve(value)).then(() => {}, () => {}); }
}
