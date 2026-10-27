// Dormant actual destination pairing. No SDK, ordinary adapter or identity grant.
import { admitTransferPreparation, admitSourceAwareTransferPreparation } from "./installationTransferAdmission";
import { createTransferPair, readTransferPair } from "./installationTransferPairProtocol";
import { credentialManifestSlot, parseCredentialPhysicalSlot } from "./credentialPhysicalSlots";
import { createTransferCredentialMigrationPort, createPublicationTransferCredentialMigrationPort, publicationTransferCredentialCapability, prepareNativeCredentialMigrationCleanup, type NativeCredentialMigrationPort, type NativeCredentialMigrationCleanup, prepareTransferIdentityCredentialRuntime } from "./nativeCredentialMigrationPort";
import { publicationAnchorSlot } from "./installationTransferPublicationProtocol";
import type { CredentialNamespaceLease } from "./nativeCredentialNamespace";
import type { NativeSqliteStoreOptions, NativeTransferQuarantineCode } from "./nativeSqliteAdapter";
import type { NativeTransferPairingContext, NativeTransferIdentityContext, NativeTransferSourceIdentityContext, TransferPublicationSqlResult } from "./installationTransferQuarantineSql";

import { parseI, type Q } from "./credentialProtocol";
import { createNativeRuntimeSession, abandonNativeRuntimeSession, publishTransferIdentityRuntime, type NativeCombinedRuntimePair, type NativeRuntimeDomainDraft, type NativeRuntimeCredentialDraft } from "./nativeCombinedRuntime";
import { createTransferSourceGuardOwner, type TransferSourceGuardRepository } from "./installationTransferSourceGuards";
import type { StorageAdapter } from "./types";
import type { AccountDeletionService } from "../identity/accountDeletion";

type Code = NativeTransferQuarantineCode | "busy" | "invalid_input" | "invalid_configuration" | "archive_refused" | "domain_refused" | "history_refused" | "runtime_owned" | "source_denial_refused" | "publication_intent" | "publication_refused";
type Report = Readonly<{ code: Code; mayIssue: false; mayPublish: false; mayMount: false }>;
type PublicationReport = TransferPublicationSqlResult & Readonly<{ mayIssue: false; mayPublish: false; mayMount: false }>;
const publicationReport = (result: TransferPublicationSqlResult): PublicationReport => Object.freeze(Object.assign(Object.create(null), result, { mayIssue: false, mayPublish: false, mayMount: false }));
const report = (code: Code): Report => Object.freeze(Object.assign(Object.create(null), { code, mayIssue: false, mayPublish: false, mayMount: false }));
export interface TransferPairingOptions {
  sqlite: NativeSqliteStoreOptions;
  providerConfigIdentity: string;
  sessionStorageKey: string;
  protectedBinding?: unknown;
  detectPlatform?: () => unknown;
}
export function createInstallationTransferPairing(input: TransferPairingOptions) {
  const owner = buildPairing(input, false);
  return Object.freeze({ inspect: owner.inspect, pair: owner.pair, close: owner.close });
}
/** Internal identity-only transfer owner; no ordinary host caller or supplied pair. */
export function createInstallationTransferIdentityOwner(input: TransferPairingOptions) {
  return buildPairing(input, true);
}
/** Closed-graph host seam: completion ownership only, never readiness or supplied pairs. */
export function createInstallationTransferHostOwner(input: TransferPairingOptions, ownsCompletion: (value: unknown) => boolean, retainApplicationCompletion?: (work: Promise<unknown>) => void) {
  return buildPairing(input, true, ownsCompletion, true, retainApplicationCompletion) as ReturnType<typeof buildPairing> & FreshEmailOtpOwner;
}
type FreshEmailOtpOwner = Readonly<{
  ownFreshEmailOtpSource(source: object): void; ownFreshEmailOtp(event: object): void;
  ownServerControl(observation: object): void;
  preparePublication(): Promise<Report>;
  publishPrepared(): Promise<PublicationReport>;
  wrapSourceDeletionGuards(adapter: StorageAdapter, current: () => boolean): TransferSourceGuardRepository;
  ownAccountRecovery(service: Pick<AccountDeletionService, "getState" | "cancel">): void;
  recoverDeletionState(): ReturnType<AccountDeletionService["getState"]>;
  cancelDeletion(requestId: string): ReturnType<AccountDeletionService["cancel"]>;
}>;
function buildPairing(input: TransferPairingOptions, identityMode: boolean, ownsCompletion?: (value: unknown) => boolean, sourceAwareMode = false, retainApplicationCompletion?: (work: Promise<unknown>) => void) {
  const options = Object.freeze({ sqlite: Object.freeze({ ...input.sqlite }), providerConfigIdentity: input.providerConfigIdentity,
    sessionStorageKey: input.sessionStorageKey, protectedBinding: input.protectedBinding, detectPlatform: input.detectPlatform ?? input.sqlite.detectPlatform });
  const address = credentialManifestSlot(options.providerConfigIdentity);
  const valid = address.ok && parseCredentialPhysicalSlot(options.providerConfigIdentity, options.sessionStorageKey, address.value).ok;
  const slot = address.ok ? address.value : "";
  let sql: NativeTransferPairingContext | null = null, port: NativeCredentialMigrationPort | null = null;
  let lease: CredentialNamespaceLease | null = null, protectedCleanup: NativeCredentialMigrationCleanup | null = null;
  let revoked = false, fault = false, verified = false;
  let pending: Promise<unknown> | null = null, closing: Promise<Report> | null = null;
  let runtimePair: NativeCombinedRuntimePair | null = null;
  let runtimeDomain: NativeRuntimeDomainDraft | null = null, runtimeCredentials: NativeRuntimeCredentialDraft | null = null;
  let sourceDenial: object | null = null;
  let sourceGuards: ReturnType<typeof createTransferSourceGuardOwner> = null;
  let accountRecovery: Pick<AccountDeletionService, "getState" | "cancel"> | null = null;
  let freshSource: object | null = null, freshEvent: object | null = null, freshStamp: object | null = null;
  let controlStamp: object | null = null, publicationFlight: Promise<Report> | null = null;
  let sqlPublicationFlight: Promise<PublicationReport> | null = null;
  let runtimeManifest: string | null = null;
  let identityLayout = false, pairedState: ReturnType<typeof readTransferPair> = null;
  const knownItems = new Map<string, string>();
  let knownKeys: readonly string[] | null = null, knownManifest: string | null | undefined;
  let expectedManifest: string | null = null, insertionIssued = false, insertionVerified = false;
  const owns = (value: unknown) => value === pending || value === closing || value === publicationFlight || value === sqlPublicationFlight || sourceGuards?.ownsCompletion(value) === true || ownsCompletion?.(value) === true;
  const current = () => !revoked && !fault;
  const control = Object.freeze({ proceed: current });
  const fail = () => { fault = true; verified = false; };
  const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key, i) => key === b[i]);
  async function target() {
    if (!sql) {
      const implementation = await import("./installationTransferQuarantineSql");
      if (!current()) throw null;
      sql = sourceAwareMode ? implementation.createInstallationTransferSourceIdentitySql(options.sqlite, owns) : identityMode ? implementation.createInstallationTransferIdentitySql(options.sqlite, owns) : implementation.createInstallationTransferPairingSql(options.sqlite, owns);
    }
    return sql;
  }
  async function protectedPort(): Promise<NativeCredentialMigrationPort | null> {
    if (!port) {
      const created = await (sourceAwareMode ? createPublicationTransferCredentialMigrationPort : createTransferCredentialMigrationPort)({ providerConfigIdentity: options.providerConfigIdentity,
        sessionStorageKey: options.sessionStorageKey, binding: options.protectedBinding, detectPlatform: options.detectPlatform }, {
        inventory(keys) {
          for (const key of keys) {
            if (sourceAwareMode && identityLayout && pairedState?.bound && key === publicationAnchorSlot(options.providerConfigIdentity)) continue;
            const parsed = parseCredentialPhysicalSlot(options.providerConfigIdentity, options.sessionStorageKey, key);
            if (!parsed.ok || parsed.value.kind === "item" && (!identityLayout || !pairedState?.bound || parsed.value.epoch !== pairedState.bound.credentialEpochId)) { fail(); return; }
          }
          if (knownKeys && !sameKeys(knownKeys, keys) && !(knownKeys.length === 0 && keys.length === 1 && keys[0] === slot && insertionIssued && insertionVerified)) fail();
          knownKeys = keys;
        },
        slot(observedSlot, value) {
          if (observedSlot !== slot) {
            const address = parseCredentialPhysicalSlot(options.providerConfigIdentity, options.sessionStorageKey, observedSlot);
            if (!identityLayout || !pairedState?.bound || !address.ok || address.value.kind !== "item" || address.value.epoch !== pairedState.bound.credentialEpochId || value.status !== "value") { fail(); return; }
            const parsed = parseI(value.value, options.sessionStorageKey, pairedState.bound);
            if (!parsed.ok || parsed.value.key !== address.value.key || knownItems.has(observedSlot) && knownItems.get(observedSlot) !== value.value) fail();
            else knownItems.set(observedSlot, value.value);
            return;
          }
          const raw = value.status === "absent" ? null : value.value;
          if (raw !== null && expectedManifest !== null && raw !== expectedManifest) fail();
          if (knownManifest !== undefined && raw !== knownManifest && !(knownManifest === null && raw === expectedManifest && insertionIssued)) fail();
          knownManifest = raw;
        },
        insertIssued(observedSlot, raw) {
          if (observedSlot !== slot || raw !== expectedManifest || knownManifest !== null || insertionIssued) fail();
          else insertionIssued = true;
        },
      }, { owns, current, failed: fail });
      if (!created.ok) return null;
      port = created.value;
    }
    return port;
  }
  async function observeManifest(expected: string | null, required: boolean): Promise<"absent" | "present" | "unavailable"> {
    const inventory = await port!.inspectNamespace(lease!, control);
    if (inventory.status !== "complete" || !current()) return "unavailable";
    // A source-aware t1 is only an inert candidate here. Its actual protected
    // read and source verification occur after archive/source initialization.
    const items = inventory.keys.filter(key => key !== slot && !(sourceAwareMode && identityLayout && pairedState?.bound && key === publicationAnchorSlot(options.providerConfigIdentity)));
    if (items.length && (!identityLayout || !pairedState?.bound)) { fail(); return "unavailable"; }
    for (const item of items) {
      if (!current()) return "unavailable";
      const observed = await port!.readSlot(lease!, item, control);
      if (observed.status !== "value" || !current()) return "unavailable";
    }
    const value = await port!.readSlot(lease!, slot, control);
    if (!current()) return "unavailable";
    if (value.status === "absent" && inventory.keys.length === 0 && !required) return "absent";
    if (value.status === "value" && inventory.keys.includes(slot) && expected !== null && value.value === expected) return "present";
    if (value.status === "absent" || value.status === "value") fail();
    return "unavailable";
  }
  function command(pair: boolean, wire?: unknown, code?: unknown): Promise<Report> {
    if (revoked) return Promise.resolve(report("closed"));
    if (runtimePair) return Promise.resolve(report("runtime_owned"));
    if (pending || closing) return Promise.resolve(report("busy"));
    if (fault) return Promise.resolve(report("fault_held"));
    if (!valid) return Promise.resolve(report("invalid_configuration"));
    let finish!: (value: Report) => void;
    const whole = new Promise<Report>(resolve => { finish = resolve; }); pending = whole;
    void (async () => {
      let result: Code = "unavailable";
      try {
        if (!pair) {
          const context = await target();
          if (current()) result = await context.inspect(current);
          if (verified && result === "paired_unverified") result = "paired";
        } else {
          const admitted = await (sourceAwareMode ? admitSourceAwareTransferPreparation(wire, code, current) : admitTransferPreparation(wire, code, current));
          if (!admitted.ok) result = admitted.code;
          else if (current()) {
            const context = await target();
            if (current()) {
              const staged = await context.stage(admitted.wire, admitted.digest, current);
              if (staged !== "quarantined" && staged !== "already_quarantined") result = staged;
              else if (current()) {
                const prepared = await context.prepare(admitted.wire, admitted.digest, admitted.rows, current);
                if (prepared !== "prepared" && prepared !== "already_prepared") result = prepared;
                else if (current()) {
                  const observed = await context.pairing(current);
                  result = observed.code;
                  identityLayout = identityMode && observed.identity;
                  const previous = observed.pair;
                  const parsed = previous ? readTransferPair(previous.intentQ, previous.manifest, previous.boundQ) : null;
                  pairedState = parsed;
                  if (previous && (!parsed || parsed.q.providerConfigIdentity !== options.providerConfigIdentity || parsed.q.sessionStorageKey !== options.sessionStorageKey)) result = "target_conflict";
                  else if (["prepared_unverified", "pair_intent_unverified", "paired_unverified"].includes(observed.code) && current()) {
                    result = "unavailable";
                    const actualPort = await protectedPort();
                    if (actualPort && current()) {
                      if (!lease) { const acquired = await actualPort.acquire(); if (acquired.ok) lease = acquired.lease; }
                      if (lease && current()) {
                        expectedManifest = previous?.manifest ?? null;
                        const initial = await observeManifest(expectedManifest, previous?.boundQ !== null && previous !== null);
                        if (initial !== "unavailable" && current()) {
                          let anchor = previous;
                          if (!anchor) {
                            anchor = await createTransferPair(options.providerConfigIdentity, options.sessionStorageKey, current, owns);
                            if (anchor && current()) {
                              expectedManifest = anchor.manifest;
                              result = await context.intent(anchor, current);
                              if (result !== "pair_intent") anchor = null;
                            }
                          }
                          if (anchor && current()) {
                            expectedManifest = anchor.manifest;
                            const manifest = await observeManifest(anchor.manifest, anchor.boundQ !== null);
                            if (manifest === "absent" && current()) {
                              const inserted = await actualPort.insert(lease, slot, anchor.manifest, control);
                              insertionVerified = inserted.status === "verified";
                              if (!insertionVerified) { if (inserted.status !== "refused" || insertionIssued) fail(); }
                            }
                            if (current() && (manifest === "present" || insertionVerified)) {
                              const proof = await observeManifest(anchor.manifest, true);
                              if (proof === "present" && current()) {
                                result = anchor.boundQ !== null ? "paired" : await context.bind(current);
                                if (result === "paired" && current() && await observeManifest(anchor.manifest, true) === "present" && current()) { verified = true; if (sourceAwareMode && "sourceDenial" in admitted) sourceDenial = admitted.sourceDenial; pairedState = readTransferPair(anchor.intentQ, anchor.manifest, anchor.boundQ); }
                                else if (result === "paired") result = "unavailable";
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch { /* Private/native failures remain bounded and preserve ownership. */ }
      if (port?.leaseState() === "faulted") fail();
      pending = null;
      finish(report(revoked ? "closed" : fault ? "fault_held" : result));
    })();
    return whole;
  }
  function handoff(): Promise<NativeCombinedRuntimePair | null> {
    if (runtimePair) return Promise.resolve(current() ? runtimePair : null);
    if (!identityMode || !current() || !verified || pending || closing || !sql || !port || !lease) return Promise.resolve(null);
    let finish!: (pair: NativeCombinedRuntimePair | null) => void;
    const whole = new Promise<NativeCombinedRuntimePair | null>(resolve => { finish = resolve; }); pending = whole;
    void (async () => {
      const session = createNativeRuntimeSession(fail, () => { revoked = true; });
      try {
        const context = sql! as NativeTransferIdentityContext;
        const observed = await context.pairing(current);
        const anchor = observed.pair;
        pairedState = anchor ? readTransferPair(anchor.intentQ, anchor.manifest, anchor.boundQ) : null;
        identityLayout = observed.identity;
        if (!current() || observed.code !== "paired_unverified" || !pairedState?.bound) throw null;
        if (await observeManifest(anchor!.manifest, true) !== "present" || !current()) throw null;
        if (await context.initializeIdentity(current) !== "paired" || !current()) throw null;
        identityLayout = true;
        if (sourceAwareMode) {
          const source = context as NativeTransferSourceIdentityContext;
          if (sourceDenial === null || await source.initializeSourceDenial(sourceDenial, current) !== "paired" || !current()) throw null;
          // No held SQL queue awaits the protected namespace. Only then does the
          // same SQL core verify this genuine observation before either draft.
          const capability = publicationTransferCredentialCapability(port!);
          const observation = await capability?.read(lease!, pairedState.bound as Q, anchor!.manifest, control);
          if (!observation || observation.status !== "observed" || !current() || !await source.verifyPublicationIntent(observation.observation, current) || !current()) throw null;
        }
        if (await observeManifest(anchor!.manifest, true) !== "present" || !current()) throw null;
        runtimeDomain = await context.prepareIdentityRuntime(session, current);
        if (!runtimeDomain || !current()) throw null;
        runtimeCredentials = await prepareTransferIdentityCredentialRuntime(port!, owns, lease!, pairedState.bound as Q, anchor!.manifest, session, runtimeDomain, current);
        if (!runtimeCredentials || !current()) throw null;
        runtimePair = publishTransferIdentityRuntime(session, runtimeDomain, runtimeCredentials);
        if (runtimePair) runtimeManifest = anchor!.manifest;
        if (!runtimePair) throw null;
      } catch {
        if (!runtimePair) { runtimeCredentials?.abandon(); runtimeDomain?.abandon(); runtimeCredentials = null; runtimeDomain = null; abandonNativeRuntimeSession(session); }
      }
      pending = null; finish(current() ? runtimePair : null);
    })();
    return whole;
  }
  function preparePublication(): Promise<Report> {
    if (publicationFlight) return publicationFlight;
    if (!sourceAwareMode || !current() || !runtimePair || !sql || !port || !lease || !pairedState?.bound || !runtimeManifest || !controlStamp) return Promise.resolve(report("publication_refused"));
    if (pending || closing) return Promise.resolve(report("busy"));
    const context = sql as NativeTransferSourceIdentityContext, original = controlStamp;
    const capability = publicationTransferCredentialCapability(port);
    if (!capability || !context.accountControlCurrent(original)) return Promise.resolve(report("publication_refused"));
    let finish!: (value: Report) => void;
    const whole = new Promise<Report>(resolve => { finish = resolve; }); publicationFlight = whole; pending = whole;
    try { retainApplicationCompletion?.(whole); } catch { pending = null; publicationFlight = null; finish(report("publication_refused")); return whole; }
    const allowed = () => current() && controlStamp === original && context.accountControlCurrent(original);
    const permission = Object.freeze({ proceed: allowed });
    void (async () => {
      let result: Code = "publication_refused";
      try {
        const read = await capability.read(lease!, pairedState!.bound as Q, runtimeManifest!, permission);
        if (read.status === "observed" && allowed()) {
          const draft = await context.preparePublication(original, read.observation);
          const payload = draft && context.publicationDraftPayload(draft);
          if (draft && payload && allowed()) {
            const inserted = await capability.insert(lease!, pairedState!.bound as Q, runtimeManifest!, payload.raw, permission);
            if (inserted.status === "observed" && allowed() && await context.acceptPublicationAnchor(draft, inserted.observation) && allowed()) result = "publication_intent";
          }
        }
      } catch { /* Preserve the original private proof and actual native faults. */ }
      if (port!.leaseState() === "faulted") fail();
      pending = null; publicationFlight = null; finish(report(revoked ? "closed" : fault ? "fault_held" : result));
    })();
    return whole;
  }
  function publishPrepared(): Promise<PublicationReport> {
    if (sqlPublicationFlight) return sqlPublicationFlight;
    const refused: TransferPublicationSqlResult = Object.freeze({ code: "publication_refused", observedLayout: "unknown" });
    if (!sourceAwareMode || !current() || !runtimePair || !sql || !port || !lease || !pairedState?.bound || !runtimeManifest || !controlStamp || pending || closing) return Promise.resolve(publicationReport(refused));
    const context = sql as NativeTransferSourceIdentityContext, original = controlStamp;
    const capability = publicationTransferCredentialCapability(port), namespace = lease, bound = pairedState.bound as Q, manifest = runtimeManifest;
    if (!capability || !context.accountControlCurrent(original)) return Promise.resolve(publicationReport(refused));
    let finish!: (value: PublicationReport) => void;
    const whole = new Promise<PublicationReport>(resolve => { finish = resolve; }); sqlPublicationFlight = whole; pending = whole;
    try { retainApplicationCompletion?.(whole); } catch { pending = null; sqlPublicationFlight = null; finish(publicationReport(refused)); return whole; }
    const allowed = () => current() && controlStamp === original && context.accountControlCurrent(original);
    const permission = Object.freeze({ proceed: allowed });
    void (async () => {
      let result = refused;
      try {
        // This actual protected read is outside the SQL queue. The SQL claim
        // consumes the original stamps itself; its factual result survives that.
        const read = await capability.read(namespace, bound, manifest, permission);
        if (read.status === "observed" && allowed()) result = await context.publishPrepared(read.observation);
      } catch { fail(); result = Object.freeze({ code: "fault_held", observedLayout: "unknown" }); }
      if (port!.leaseState() === "faulted") fail();
      if (result === refused) {
        // The protected read first acquires a real SQL anchor. Its lane can fail
        // while the protected namespace itself remains healthy. Closed alone is
        // not failed, and a factual SQL publication result is never rewritten.
        const health = runtimePair!.health();
        if (fault || health.domain !== "healthy" || health.credential !== "healthy" || health.protocol !== "healthy") {
          fail(); result = Object.freeze({ code: "fault_held", observedLayout: "unknown" });
        }
      }
      pending = null; sqlPublicationFlight = null;
      finish(publicationReport(result));
    })();
    return whole;
  }
  function close(): Promise<Report> {
    revoked = true;
    accountRecovery = null;
    controlStamp = null;
    if (closing) return closing;
    const work = pending;
    let finish!: (value: Report) => void;
    const whole = new Promise<Report>(resolve => { finish = resolve; }); closing = whole;
    // Pair disposal revokes active lanes synchronously before joining work.
    const existingDisposal = runtimePair?.dispose();
    void (async () => {
      if (work) await work;
      let result: Code = "closed";
      try {
        if (runtimePair) {
          const disposed = await (existingDisposal ?? runtimePair.dispose());
          if (!disposed.ok) result = disposed.reason === "evidence_held" ? "fault_held" : "cleanup_held";
        } else if (lease && port && sql) {
          protectedCleanup ??= prepareNativeCredentialMigrationCleanup(port, lease);
          const [sqlReceipt, protectedReceipt] = await Promise.all([sql.cleanup(), protectedCleanup?.close() ?? Promise.resolve(null)]);
          if (!sqlReceipt || !protectedReceipt || !protectedCleanup) result = "cleanup_held";
          else if (fault || !sql.releaseReady(sqlReceipt) || !protectedCleanup.releaseReady(protectedReceipt)) result = "fault_held";
          else { sql.retire(sqlReceipt); protectedCleanup.retire(protectedReceipt); lease = null; }
        } else if (sql) result = await sql.close();
      } catch { result = "cleanup_held"; }
      closing = null; finish(report(result));
    })();
    return whole;
  }
  const freshObservers: FreshEmailOtpOwner = {
    preparePublication, publishPrepared,
    ownServerControl(observation) {
      controlStamp = null;
      if (!current() || !runtimePair || !sql || !freshStamp) return;
      const context = sql as NativeTransferSourceIdentityContext;
      controlStamp = context.pinAccountControl(freshStamp, observation);
      if (controlStamp && !context.accountControlCurrent(controlStamp)) controlStamp = null;
    },
    wrapSourceDeletionGuards(adapter, hostCurrent) {
      if (!current() || !runtimePair || !sourceDenial) throw null;
      sourceGuards ??= createTransferSourceGuardOwner(sourceDenial);
      if (!sourceGuards) throw null;
      return sourceGuards.repository(adapter, () => current() && hostCurrent());
    },
    ownAccountRecovery(service) {
      if (!current() || !runtimePair || !sourceGuards || accountRecovery !== null) throw null;
      accountRecovery = service;
    },
    recoverDeletionState() {
      return current() && accountRecovery ? accountRecovery.getState() : Promise.resolve({ ok: false, error: "unavailable" });
    },
    cancelDeletion(requestId) {
      return current() && accountRecovery ? accountRecovery.cancel(requestId) : Promise.resolve({ ok: false, error: "unavailable" });
    },
    ownFreshEmailOtpSource(source) {
      if (!current() || !runtimePair || !sql || freshSource !== null && freshSource !== source || !(sql as NativeTransferSourceIdentityContext).bindFreshEmailOtpSource(source)) throw null;
      freshSource = source;
    },
    ownFreshEmailOtp(event) {
      if (!current() || !runtimePair || !sql || freshSource === null) throw null;
      const context = sql as NativeTransferSourceIdentityContext;
      if (freshEvent === event) { if (!freshStamp || !context.freshEmailOtpCurrent(freshStamp)) throw null; return; }
      controlStamp = null; freshEvent = event; freshStamp = context.pinFreshEmailOtp(event);
      if (!freshStamp) throw null;
    },
  };
  return Object.freeze(Object.assign(Object.create(null), sourceAwareMode ? freshObservers : {}, { inspect: () => command(false), pair: (wire: unknown, code: unknown) => command(true, wire, code), close, handoff })) as Readonly<{ inspect(): Promise<Report>; pair(wire: unknown, code: unknown): Promise<Report>; close(): Promise<Report>; handoff(): Promise<NativeCombinedRuntimePair | null> }>;
}
