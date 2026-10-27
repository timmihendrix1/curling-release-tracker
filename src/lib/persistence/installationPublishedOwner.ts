// Dormant source-free store owner. No SDK, Profile, Tracker or application admission.
import { createPublishedInstallationSql, type NativePublishedInstallationContext } from "./installationTransferQuarantineSql";
import { createQuarantineWork } from "./installationTransferQuarantineWork";
import { createPublicationTransferCredentialMigrationPort, publicationTransferCredentialCapability, prepareNativeCredentialMigrationCleanup, type NativeCredentialMigrationPort, type NativeCredentialMigrationCleanup } from "./nativeCredentialMigrationPort";
import { createPublishedSourceGuardOwner, type TransferSourceGuardRepository } from "./installationTransferSourceGuards";
import { createNativeRuntimeSession, abandonNativeRuntimeSession, publishPublishedInstallationRuntime, nativeRuntimeCurrent, nativeRuntimeStorageHealthy, ownsTransferRuntimeCompletion, type NativeRuntimeSession, type NativeRuntimeDomainDraft, type NativeRuntimeCredentialDraft, type NativeCombinedRuntimePair } from "./nativeCombinedRuntime";
import { credentialManifestSlot, parseCredentialPhysicalSlot } from "./credentialPhysicalSlots";
import type { CredentialNamespaceLease } from "./nativeCredentialNamespace";
import type { NativeSqliteStoreOptions } from "./nativeSqliteAdapter";

type Options = Readonly<{ sqlite: NativeSqliteStoreOptions; providerConfigIdentity: string; sessionStorageKey: string; protectedBinding?: unknown; detectPlatform?: () => unknown }>;
type Code = "binding_confirmed" | "binding_refused" | "fault_held" | "cleanup_held" | "closed";
type Report = Readonly<{ code: Code; mayIssue: false; mayPublish: false; mayMount: false }>;
const report = (code: Code): Report => Object.freeze(Object.assign(Object.create(null), { code, mayIssue: false, mayPublish: false, mayMount: false }));
export function createPublishedInstallationOwner(input: unknown, hostOwns?: (value: unknown) => boolean) {
  let supplied = input; input = undefined;
  let options: Options | null = null, sql: NativePublishedInstallationContext | null = null;
  let port: NativeCredentialMigrationPort | null = null, lease: CredentialNamespaceLease | null = null;
  let cleanup: NativeCredentialMigrationCleanup | null = null, binding: object | null = null;
  let observation: object | null = null;
  let session: NativeRuntimeSession | null = null, domain: NativeRuntimeDomainDraft | null = null, credential: NativeRuntimeCredentialDraft | null = null;
  let pair: NativeCombinedRuntimePair | null = null;
  let guards: ReturnType<typeof createPublishedSourceGuardOwner> = null;
  let handoffFlight: Promise<NativeCombinedRuntimePair | null> | null = null;
  let revoked = false, fault = false, cleanupOnly = false;
  let pending: Promise<Report> | null = null, closing: Promise<Report> | null = null;
  const completions = new WeakSet<object>();
  const pendingEffects = new Set<Promise<unknown>>();
  let effectsDrain: Promise<void> | null = null;
  const local = (value: unknown) => value !== null && (typeof value === "object" || typeof value === "function") && completions.has(value);
  const owns = (value: unknown): boolean => value === pending || value === closing || value === handoffFlight || hostOwns?.(value) === true || local(value) || guards?.ownsCompletion(value) === true || (session !== null && ownsTransferRuntimeCompletion(session, value)) || sql?.ownsCompletion(value) === true || (port !== null && publicationTransferCredentialCapability(port)?.ownsCompletion(value) === true);
  const current = () => !revoked && !fault && !cleanupOnly && sql?.health() !== "failed";
  const failed = () => { fault = true; binding = null; };
  function track<T>(value: Promise<T>): Promise<T> { completions.add(value); return value; }
  function drainEffects(): Promise<void> {
    if (effectsDrain) return effectsDrain;
    const whole = track(Promise.resolve().then(async () => {
      while (pendingEffects.size) await Promise.all([...pendingEffects]);
    }));
    effectsDrain = whole;
    void whole.then(() => { if (effectsDrain === whole) effectsDrain = null; }, () => { if (effectsDrain === whole) effectsDrain = null; });
    return whole;
  }
  const unhealthy = () => fault || sql?.health() === "failed" || port?.leaseState() === "faulted" || (session !== null && !nativeRuntimeStorageHealthy(session));
  async function capture(): Promise<Options | null> {
    if (options) return options;
    const work = createQuarantineWork(owns);
    const field = (receiver: object, name: string): unknown => {
      if (!current()) throw null;
      const value = work.field(receiver, name);
      if (!current()) throw null;
      return value;
    };
    try {
      // Retain the acquired root even if it is not an admissible record. The
      // private box records it without assimilating it as configuration.
      const root = field({ supplied }, "supplied");
      if (!root || typeof root !== "object" || Array.isArray(root)) return null;
      const names = Reflect.ownKeys(root);
      if (!current() || names.some(key => typeof key !== "string" || !["sqlite", "providerConfigIdentity", "sessionStorageKey", "protectedBinding", "detectPlatform"].includes(key))) return null;
      const config = field(root, "providerConfigIdentity");
      if (typeof config !== "string") return null;
      const address = credentialManifestSlot(config); if (!address.ok) return null;
      const sessionRoot = field(root, "sessionStorageKey");
      if (typeof sessionRoot !== "string" || !parseCredentialPhysicalSlot(config, sessionRoot, address.value).ok) return null;
      const native = field(root, "sqlite");
      if (!native || typeof native !== "object" || Array.isArray(native)) return null;
      const keys = Reflect.ownKeys(native);
      if (!current() || keys.some(key => typeof key !== "string" || !["databaseName", "engine", "detectPlatform"].includes(key))) return null;
      const databaseName = field(native, "databaseName");
      if (typeof databaseName !== "string" || databaseName.length === 0) return null;
      const engine = keys.includes("engine") ? field(native, "engine") : undefined;
      if (engine !== undefined && (engine === null || typeof engine !== "object" || Array.isArray(engine))) return null;
      const nativeDetect = keys.includes("detectPlatform") ? field(native, "detectPlatform") : undefined;
      if (nativeDetect !== undefined && typeof nativeDetect !== "function") return null;
      const detect = names.includes("detectPlatform") ? field(root, "detectPlatform") : nativeDetect;
      if (detect !== undefined && typeof detect !== "function") return null;
      const protectedBinding = names.includes("protectedBinding") ? field(root, "protectedBinding") : undefined;
      if (protectedBinding !== undefined && (protectedBinding === null || typeof protectedBinding !== "object" || Array.isArray(protectedBinding))) return null;
      const captured = Object.freeze({ sqlite: Object.freeze({ databaseName, engine, detectPlatform: nativeDetect }) as NativeSqliteStoreOptions,
        providerConfigIdentity: config, sessionStorageKey: sessionRoot, protectedBinding, detectPlatform: detect as Options["detectPlatform"] });
      await work.finish();
      if (!current()) return null;
      options = captured; return options;
    } catch { return null; }
    finally { supplied = undefined; await work.finish(); }
  }
  async function verifyWork(): Promise<Code> {
    binding = null; observation = null;
    const captured = await capture(); if (!captured || !current()) return "binding_refused";
    sql ??= createPublishedInstallationSql(captured.sqlite, owns);
    const candidate = await track(sql.candidate(current));
    if (!candidate || !current()) return "binding_refused";
    const payload = sql.candidatePayload(candidate); if (!payload) return "binding_refused";
    if (!port) {
      const created = await track(createPublicationTransferCredentialMigrationPort({ providerConfigIdentity: captured.providerConfigIdentity,
        sessionStorageKey: captured.sessionStorageKey, binding: captured.protectedBinding, detectPlatform: captured.detectPlatform },
      { inventory() {}, slot() {} }, { owns, current, failed }));
      if (!created.ok) return "binding_refused";
      port = created.value;
    }
    if (!current()) return "binding_refused";
    if (!lease) {
      const acquired = await track(port.acquire());
      if (!acquired.ok) return "binding_refused";
      lease = acquired.lease; // Retain a late positive acquisition before cancellation.
    }
    if (!current()) return "binding_refused";
    const capability = publicationTransferCredentialCapability(port); if (!capability) return "binding_refused";
    const observed = await track(capability.read(lease, payload.q, payload.manifest, Object.freeze({ proceed: current })));
    if (observed.status !== "observed" || !current()) return "binding_refused";
    const actual = await track(sql.verifyBinding(candidate, observed.observation));
    if (!actual || !current() || !sql.bindingCurrent(actual)) return "binding_refused";
    binding = actual; observation = observed.observation; return "binding_confirmed";
  }
  function verify(): Promise<Report> {
    if (pending) return pending;
    if (revoked) return Promise.resolve(report("closed"));
    if (!current() || closing || handoffFlight || pair || domain) return Promise.resolve(report(unhealthy() ? "fault_held" : "binding_refused"));
    let finish!: (value: Report) => void;
    const whole = new Promise<Report>(resolve => { finish = resolve; }); pending = whole; track(whole);
    void (async () => {
      let code: Code;
      try { code = await verifyWork(); } catch { failed(); code = "fault_held"; }
      if (unhealthy()) { failed(); code = "fault_held"; }
      else if (revoked) code = "closed";
      else if (code === "binding_confirmed" && (!binding || !sql?.bindingCurrent(binding))) code = "binding_refused";
      pending = null; finish(report(code));
    })();
    return whole;
  }
  function handoff(): Promise<NativeCombinedRuntimePair | null> {
    if (handoffFlight) return handoffFlight;
    if (pair) return Promise.resolve(current() && session && nativeRuntimeCurrent(session, "credential") ? pair : null);
    if (!current() || closing) return Promise.resolve(null);
    const verification = pending;
    const whole = Promise.resolve().then(async () => {
      try {
        if (verification) await verification;
        // A first handoff always renews both actual stores, even after verify().
        if (!current() || await verifyWork() !== "binding_confirmed" || !current() || !binding || !observation || !sql || !port || !lease) return null;
        const original = binding;
        guards = createPublishedSourceGuardOwner(original);
        if (!guards) return null;
        session = createNativeRuntimeSession(failed, () => { revoked = true; });
        domain = await track(sql.preparePublishedRuntime(original, session, current));
        // A late real draft is retained before cancellation. A consumed proof
        // can never be revived by another attempt on this owner/context.
        if (!domain || !current()) {
          if (domain || !sql.bindingCurrent(original)) cleanupOnly = true;
          domain?.abandon(); abandonNativeRuntimeSession(session); return null;
        }
        const capability = publicationTransferCredentialCapability(port);
        const prepared = capability ? await track(capability.prepareRuntime(lease, observation, session, domain, current)) : null;
        if (prepared) credential = prepared.draft;
        if (!prepared || prepared.kind !== "prepared" || !current() || !domain.ready() || !credential?.ready()) {
          cleanupOnly = true; domain.abandon(); credential?.abandon(); abandonNativeRuntimeSession(session); return null;
        }
        pair = publishPublishedInstallationRuntime(session, domain, credential, drainEffects);
        if (!pair) { cleanupOnly = true; domain.abandon(); credential.abandon(); abandonNativeRuntimeSession(session); }
        return pair;
      } catch {
        failed(); cleanupOnly = true; domain?.abandon(); credential?.abandon();
        if (session) abandonNativeRuntimeSession(session);
        return null;
      } finally { handoffFlight = null; }
    });
    handoffFlight = whole; track(whole); return whole;
  }
  function sourceGuardRepository(hostCurrent: () => boolean, beforeIO?: () => Promise<boolean>): TransferSourceGuardRepository | null {
    if (!pair || !session || !guards || !current() || !nativeRuntimeCurrent(session, "domain")) return null;
    const actualSession = session, actualDomain = pair.domain;
    const live = () => { try { return current() && nativeRuntimeCurrent(actualSession, "domain") && hostCurrent() === true; } catch { return false; } };
    if (!beforeIO) return guards.repository(actualDomain, live);
    // Only the actual host supplies this negative effects restriction. Keep it
    // outside SQL, and own the exact outward operation before any policy work.
    const permitted = async () => live() && await beforeIO() === true && live();
    function operation<T>(run: () => Promise<T>, refused: () => T): Promise<T> {
      const whole = track(Promise.resolve().then(async () => {
        try {
          if (!await permitted()) return refused();
          const result = await run(); return await permitted() ? result : refused();
        } catch { return refused(); }
      }));
      pendingEffects.add(whole);
      void whole.then(() => { pendingEffects.delete(whole); }, () => { pendingEffects.delete(whole); });
      return whole;
    }
    return guards.repository(Object.freeze({
      get: (key: string) => operation(() => actualDomain.get(key), () => ({ status: "read_failed" as const, fallback: null, error: { kind: "storage_unavailable" as const } })),
      set: (key: string, value: string) => operation(() => actualDomain.set(key, value), () => ({ ok: false as const, error: { kind: "storage_unavailable" as const } })),
    }), live);
  }
  function close(): Promise<Report> {
    revoked = true; supplied = undefined; binding = null; observation = null;
    if (closing) return closing;
    const verification = pending, handoff = handoffFlight;
    let finish!: (value: Report) => void;
    const whole = new Promise<Report>(resolve => { finish = resolve; }); closing = whole; track(whole);
    void (async () => {
      let code: Code = "cleanup_held";
      try {
        // Select cleanup only after late drafts/leases have been retained. The
        // call-time revocation above already denies all pending acquisitions.
        if (verification) await verification;
        if (handoff) await handoff;
        if (pair) {
          const result = await track(pair.dispose());
          if (result.ok) { lease = null; code = "closed"; }
          else code = result.reason === "evidence_held" || unhealthy() ? "fault_held" : "cleanup_held";
        } else {
          if (port && lease && !credential) cleanup ??= prepareNativeCredentialMigrationCleanup(port, lease);
          const sqlClose = domain ? track(domain.close()) : sql ? track(sql.cleanup()) : null;
          const protectedClose = credential ? track(credential.close()) : cleanup ? track(cleanup.close()) : null;
          const [sqlReceipt, protectedReceipt] = await Promise.all([sqlClose, protectedClose]);
          const sqlReady = domain ? sqlReceipt !== null && domain.releaseReady(sqlReceipt) : sql === null || sqlReceipt !== null && sql.releaseReady(sqlReceipt);
          const protectedReady = credential ? protectedReceipt !== null && credential.releaseReady(protectedReceipt) : lease === null || cleanup !== null && protectedReceipt !== null && cleanup.releaseReady(protectedReceipt);
          if (unhealthy()) code = "fault_held";
          else if (sqlReady && protectedReady) {
            if (domain && sqlReceipt) domain.retire(sqlReceipt); else if (sql && sqlReceipt) sql.retire(sqlReceipt);
            if (credential && protectedReceipt) credential.retire(protectedReceipt);
            else if (cleanup && protectedReceipt) cleanup.retire(protectedReceipt);
            lease = null; code = "closed";
          }
        }
      } catch { code = unhealthy() ? "fault_held" : "cleanup_held"; }
      if (code === "cleanup_held" && !unhealthy()) closing = null;
      finish(report(code));
    })();
    return whole;
  }
  return Object.freeze(Object.assign(Object.create(null), { verify, handoff, sourceGuardRepository, close }));
}
