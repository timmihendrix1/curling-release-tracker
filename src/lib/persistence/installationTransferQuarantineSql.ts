import { encodePublishedLiveCodeUnits, decodePublishedLiveCodeUnits, isPublishedLiveCodeUnits } from "./installationPublishedLiveCodeUnits";
import { recordPublishedInstallationBinding, readPublishedInstallationBinding } from "./installationPublishedBinding";
import { createNativeTransferQuarantineContext, type NativeSqliteStoreOptions, type NativeSqliteConnection, type NativeTransferQuarantineContext, type NativeTransferQuarantineCode, type NativeMigrationLease } from "./nativeSqliteAdapter";
import { createQuarantineWork, isQuarantineProtectedWire, type QuarantineWork } from "./installationTransferQuarantineWork";

import { isTransferCodeUnits, encodeTransferCodeUnits, decodeTransferCodeUnits } from "./installationTransferCodeUnits";
import { readTransferPair, transferIntentQ, transferBoundQ, type TransferPairState } from "./installationTransferPairProtocol";
import { resolveTransferSourceDenial, parseTransferSourceDenial } from "./installationTransferSourceDenial";
import { readPublicationAnchorObservation, serializePublicationAnchor, parsePublicationAnchor, MAX_PUBLICATION_ASCII, hashPublicationValue, type PublicationAnchor } from "./installationTransferPublicationProtocol";
import { serializePlatformStringTuple } from "./platformSha256";
import { isCanonicalUuid } from "../uuid";
import { readTransferAccountControlObservation } from "./installationTransferAccountControl";
import { transferSlot } from "./installationTransferInventory";
import { classifyMigrationSourceKey } from "./nativeMigrationEligibility";
import { registerTransferRuntimeCompletion, ownsTransferRuntimeCompletion, nativeRuntimeStorageHealthy, nativeRuntimeCurrent, nativeRuntimeFailed, nativeRuntimeProtocolFault, nativeRuntimeEvidence, nativeRuntimeCleanup, type NativeRuntimeSession, type NativeRuntimeDomainDraft } from "./nativeCombinedRuntime";
import { isNativeFreshEmailOtpSource, readNativeFreshEmailOtp } from "../identity/identityTransitionCoordinator";
import type { StorageGetResult, PersistenceWriteResult, PersistenceRemoveResult } from "./types";

type PublishedQ = NonNullable<NonNullable<ReturnType<typeof readTransferPair>>["bound"]>;

const identityKey = (key: unknown): key is string => {
  const classified = classifyMigrationSourceKey(key);
  return classified.eligible && ["identity_fixed", "identity_barrier_resolution", "identity_deletion_guard", "identity_deletion_resolution"].includes(classified.family);
};
type IdentityRow = Readonly<{ key: string; ascii: string }>;


export type PreparedSportingRow = Readonly<{ key: string; ascii: string; digest: string }>;
export interface NativeTransferPreparationContext extends NativeTransferQuarantineContext {
  prepare(wire: string, digest: string, rows: readonly PreparedSportingRow[], proceed: () => boolean): Promise<NativeTransferQuarantineCode>;
}

export interface NativeTransferPairingContext extends NativeTransferPreparationContext {
  pairing(proceed: () => boolean): Promise<Readonly<{ code: NativeTransferQuarantineCode; pair: TransferPairState | null; identity: boolean }>>;
  intent(pair: TransferPairState, proceed: () => boolean): Promise<NativeTransferQuarantineCode>;
  bind(proceed: () => boolean): Promise<NativeTransferQuarantineCode>;
  cleanup(): Promise<object | null>;
  releaseReady(receipt: object): boolean;
  retire(receipt: object): void;
}
export function createInstallationTransferPairingSql(options: NativeSqliteStoreOptions, owns: (value: unknown) => boolean): NativeTransferPairingContext {
  return buildQuarantineSql(options, owns, true, true) as NativeTransferPairingContext;
}

export interface NativeTransferIdentityContext extends NativeTransferPairingContext {
  initializeIdentity(proceed: () => boolean): Promise<NativeTransferQuarantineCode>;
  prepareIdentityRuntime(session: NativeRuntimeSession, current: () => boolean): Promise<NativeRuntimeDomainDraft | null>;
}
export function createInstallationTransferIdentitySql(options: NativeSqliteStoreOptions, owns: (value: unknown) => boolean): NativeTransferIdentityContext {
  return buildQuarantineSql(options, owns, true, true, true) as NativeTransferIdentityContext;
}

export type TransferPublicationSqlResult = Readonly<{
  code: "publication_confirmed" | "publication_unpublished" | "outcome_unresolved" | "fault_held" | "publication_refused";
  observedLayout: "before8" | "desired11" | "unknown";
}>;
export interface NativeTransferSourceIdentityContext extends NativeTransferIdentityContext {
  initializeSourceDenial(handle: unknown, proceed: () => boolean): Promise<NativeTransferQuarantineCode>;
  bindFreshEmailOtpSource(source: unknown): boolean;
  pinFreshEmailOtp(event: unknown): object | null;
  freshEmailOtpCurrent(stamp: unknown): boolean;
  pinAccountControl(freshStamp: unknown, observation: unknown): object | null;
  accountControlCurrent(stamp: unknown): boolean;
  verifyPublicationIntent(observation: unknown, proceed: () => boolean): Promise<boolean>;
  preparePublication(stamp: unknown, observation: unknown): Promise<object | null>;
  publicationDraftPayload(draft: unknown): Readonly<{ raw: string; anchorDigest: string }> | null;
  acceptPublicationAnchor(draft: unknown, observation: unknown): Promise<boolean>;
  publishPrepared(observation: unknown): Promise<TransferPublicationSqlResult>;
}
/** Only the actual host owner selects this closed graph; old factories stay exact. */
export function createInstallationTransferSourceIdentitySql(options: NativeSqliteStoreOptions, owns: (value: unknown) => boolean): NativeTransferSourceIdentityContext {
  return buildQuarantineSql(options, owns, true, true, true, true) as NativeTransferSourceIdentityContext;
}

/** Closed cold artifact binding only. No SourceVerified, runtime or SDK grant. */
export interface NativePublishedInstallationContext {
  candidate(proceed: () => boolean): Promise<object | null>;
  candidatePayload(candidate: unknown): Readonly<{ q: PublishedQ; manifest: string }> | null;
  verifyBinding(candidate: unknown, observation: unknown): Promise<object | null>;
  bindingCurrent(binding: unknown): boolean;
  preparePublishedRuntime(binding: unknown, session: NativeRuntimeSession, current: () => boolean): Promise<NativeRuntimeDomainDraft | null>;
  ownsCompletion(value: unknown): boolean;
  health(): "healthy" | "failed";
  cleanup(): Promise<object | null>;
  releaseReady(receipt: object): boolean;
  retire(receipt: object): void;
}
export function createPublishedInstallationSql(options: NativeSqliteStoreOptions, owns: (value: unknown) => boolean): NativePublishedInstallationContext {
  const context = buildQuarantineSql(options, owns, true, true, true, true, true) as unknown as NativePublishedInstallationContext;
  return Object.freeze(Object.assign(Object.create(null), { candidate: context.candidate, candidatePayload: context.candidatePayload,
    verifyBinding: context.verifyBinding, bindingCurrent: context.bindingCurrent, preparePublishedRuntime: context.preparePublishedRuntime, ownsCompletion: context.ownsCompletion,
    health: context.health, cleanup: context.cleanup, releaseReady: context.releaseReady, retire: context.retire }));
}

/** S6g internal construction only. No app caller, ordinary rows or publication. */
export function createInstallationTransferQuarantineSql(options: NativeSqliteStoreOptions, owns: (value: unknown) => boolean): NativeTransferQuarantineContext {
  return buildQuarantineSql(options, owns, false);
}
/** S6h private construction on the same core, never a second owner/engine. */
export function createInstallationTransferPreparationSql(options: NativeSqliteStoreOptions, owns: (value: unknown) => boolean): NativeTransferPreparationContext {
  return buildQuarantineSql(options, owns, true) as NativeTransferPreparationContext;
}
function buildQuarantineSql(options: NativeSqliteStoreOptions, owns: (value: unknown) => boolean, preparationMode: boolean, pairingMode = false, identityMode = false, sourceAwareMode = false, publishedMode = false): NativeTransferQuarantineContext {
  const install: Parameters<typeof createNativeTransferQuarantineContext>[1] = core => {
    const ddl = "CREATE TABLE installation_transfer_quarantine_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), protected_wire TEXT NOT NULL, package_digest TEXT NOT NULL)";
    const preparedDdl = "CREATE TABLE installation_transfer_prepared_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), package_digest TEXT NOT NULL, row_count INTEGER NOT NULL CHECK(row_count>=0))";
    const sportingDdl = "CREATE TABLE installation_transfer_sporting_v1 (slot INTEGER PRIMARY KEY CHECK(slot>=0), key TEXT NOT NULL, value_ascii TEXT NOT NULL, value_digest TEXT NOT NULL)";
    const pairDdl = "CREATE TABLE installation_transfer_pair_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), package_digest TEXT NOT NULL, intent_q TEXT NOT NULL, manifest TEXT NOT NULL)";
    const bindingDdl = "CREATE TABLE installation_transfer_binding_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), package_digest TEXT NOT NULL, bound_q TEXT NOT NULL)";
    const identityDdl = "CREATE TABLE installation_transfer_identity_v1 (key TEXT PRIMARY KEY NOT NULL, value_ascii TEXT NOT NULL)";
    const sourceDenialDdl = "CREATE TABLE installation_transfer_source_denial_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), package_digest TEXT NOT NULL, projection_ascii TEXT NOT NULL, projection_digest TEXT NOT NULL)";
    const publicationDdl = "CREATE TABLE installation_transfer_publication_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), anchor_ascii TEXT NOT NULL, anchor_digest TEXT NOT NULL)";
    const liveDdl = "CREATE TABLE installation_transfer_live_v1 (key TEXT PRIMARY KEY NOT NULL, value_ascii TEXT NOT NULL)";
    const liveIndex = "sqlite_autoindex_installation_transfer_live_v1_1";
    type PublicationState = Readonly<{ raw: string; digest: string; rows: readonly IdentityRow[] }>;

    type SourceDenialRow = Readonly<{ packageDigest: string; ascii: string; digest: string }>;
    let sourceVerified = false;
    let publishedVersion: number | null = null, publishedClosing = false, publishedConsumed = false;
    const publishedContextIdentity = Object.freeze({});
    const identityIndex = "sqlite_autoindex_installation_transfer_identity_v1_1";
    type RecordState = Readonly<{ wire: string; digest: string; rows: readonly PreparedSportingRow[] | null; pair: TransferPairState | null; identity: readonly IdentityRow[] | null; sourceDenial: SourceDenialRow | null; publication: PublicationState | null }>;
    type PublicationPlan = { before: RecordState; desired: RecordState; beforeVersion: number; stagedVersion: number | null; commitIssued: boolean; confirmed: boolean; classifying: boolean; pin: Readonly<{ record: RecordState; version: number }> | null; observedLayout: TransferPublicationSqlResult["observedLayout"] };
    let publicationPlan: PublicationPlan | null = null, publishedPublication: PublicationState | null = null;
    let publicationQueueHeld = false, publicationFlight: Promise<TransferPublicationSqlResult> | null = null;
    let sourceQueueCurrent: (() => boolean) | null = null;
    let runtimeReads = 0;
    let observedSchemaVersion: number | null = null, runtimeSchemaVersion: number | null = null;
    let runtimeSession: NativeRuntimeSession | null = null;
    let runtimeRole: "migration" | "prepared" | "runtime" | "closed" | "retired" = "migration";
    let identityRevision = 0;
    let mutationSequence: object = {}, pendingMutations = 0;
    let sourceLive: (() => boolean) | null = null, freshSource: object | null = null;
    type FreshStamp = Readonly<{ event: object; accountScopeId: string; profileId: string; revision: number; sequence: object; session: NativeRuntimeSession; schema: number; source: SourceDenialRow; packageDigest: string }>;
    const freshStamps = new WeakMap<object, FreshStamp>(), eventStamps = new WeakMap<object, object | null>();
    const controlStamps = new WeakMap<object, Readonly<{ freshStamp: object; observation: object }>>(), observationStamps = new WeakMap<object, object | null>();
    const sourceReady = () => sourceAwareMode && sourceVerified && !!sourceLive?.() && runtimeRole === "runtime" && !fault && !unresolved && !outcome && !!runtimeSession && runtimeSchemaVersion !== null && !!known?.sourceDenial && pendingMutations === 0;
    function freshEmailOtpCurrent(value: unknown): boolean {
      if (value === null || typeof value !== "object") return false;
      const stamp = freshStamps.get(value);
      if (!stamp || !sourceReady() || stamp.revision !== identityRevision || stamp.sequence !== mutationSequence || stamp.session !== runtimeSession || stamp.schema !== runtimeSchemaVersion || stamp.packageDigest !== known?.digest || !sameSource(stamp.source, known.sourceDenial)) return false;
      const facts = readNativeFreshEmailOtp(stamp.event);
      return !!facts && facts.source === freshSource && facts.accountScopeId === stamp.accountScopeId && facts.profileId === stamp.profileId && facts.current();
    }
    function pinFreshEmailOtp(value: unknown): object | null {
      const facts = readNativeFreshEmailOtp(value);
      if (!facts || facts.source !== freshSource) return null;
      const event = value as object;
      if (eventStamps.has(event)) { const old = eventStamps.get(event); return old && freshEmailOtpCurrent(old) ? old : null; }
      // First attempt consumes the event even when pending work refuses capture.
      eventStamps.set(event, null);
      if (!sourceReady() || !facts.current()) return null;
      const stamp = Object.freeze(Object.create(null)) as object;
      freshStamps.set(stamp, Object.freeze({ event, accountScopeId: facts.accountScopeId, profileId: facts.profileId, revision: identityRevision, sequence: mutationSequence, session: runtimeSession!, schema: runtimeSchemaVersion!, source: known!.sourceDenial!, packageDigest: known!.digest }));
      eventStamps.set(event, stamp);
      return freshEmailOtpCurrent(stamp) ? stamp : null;
    }
    function accountControlCurrent(value: unknown): boolean {
      const stamp = value !== null && typeof value === "object" ? controlStamps.get(value) : null;
      if (!stamp || !freshEmailOtpCurrent(stamp.freshStamp)) return false;
      const fresh = freshStamps.get(stamp.freshStamp)!, control = readTransferAccountControlObservation(stamp.observation);
      return !!control && control.source === freshSource && control.event === fresh.event && control.accountScopeId === fresh.accountScopeId && control.profileId === fresh.profileId;
    }
    function pinAccountControl(freshStamp: unknown, observation: unknown): object | null {
      const control = readTransferAccountControlObservation(observation);
      if (!control || control.source !== freshSource) return null;
      const handle = observation as object;
      if (observationStamps.has(handle)) { const old = observationStamps.get(handle); return old && accountControlCurrent(old) ? old : null; }
      observationStamps.set(handle, null);
      if (freshStamp === null || typeof freshStamp !== "object" || !freshEmailOtpCurrent(freshStamp)) return null;
      const fresh = freshStamps.get(freshStamp)!;
      if (control.event !== fresh.event || control.accountScopeId !== fresh.accountScopeId || control.profileId !== fresh.profileId) return null;
      const stamp = Object.freeze(Object.create(null)) as object;
      controlStamps.set(stamp, Object.freeze({ freshStamp, observation: handle })); observationStamps.set(handle, stamp);
      return accountControlCurrent(stamp) ? stamp : null;
    }
    let cleanupReceipt: object | null = null;
    let work: QuarantineWork;
    let lease: NativeMigrationLease | null = null;
    let known: RecordState | null = null;
    let fault = false;
    let conflict = false;
    let authenticated = false, preparedAuthenticated = false;
    let unresolved = false;
    let outcome: { desired: RecordState; before: RecordState | null; commitIssued: boolean; confirmed: boolean; success: NativeTransferQuarantineCode; observed: boolean; readback: RecordState | null } | null = null;
    const publicationCompletions = new WeakSet<object>();
    function sourceCompletion<T>(completion: Promise<T>): Promise<T> {
      if (sourceAwareMode) {
        publicationCompletions.add(completion);
        if (runtimeSession) registerTransferRuntimeCompletion(runtimeSession, completion);
      }
      return completion;
    }
    const owned = (value: unknown) => value !== null && (typeof value === "object" || typeof value === "function") && publicationCompletions.has(value) || owns(value) || runtimeSession !== null && ownsTransferRuntimeCompletion(runtimeSession, value);
    const sameRows = (a: readonly PreparedSportingRow[] | null, b: readonly PreparedSportingRow[] | null) => a === null ? b === null : b !== null && a.length === b.length && a.every((r, i) => r.key === b[i].key && r.ascii === b[i].ascii && r.digest === b[i].digest);
    const samePair = (a: TransferPairState | null, b: TransferPairState | null) => a === null ? b === null : b !== null && a.intentQ === b.intentQ && a.manifest === b.manifest && a.boundQ === b.boundQ;
    const sameIdentity = (a: readonly IdentityRow[] | null, b: readonly IdentityRow[] | null) => a === null ? b === null : b !== null && a.length === b.length && a.every((r, i) => r.key === b[i].key && r.ascii === b[i].ascii);
    const sameSource = (a: SourceDenialRow | null, b: SourceDenialRow | null) => a === null ? b === null : b !== null && a.packageDigest === b.packageDigest && a.ascii === b.ascii && a.digest === b.digest;
    const same = (a: RecordState | null, b: RecordState | null) => a === null ? b === null : b !== null && a.wire === b.wire && a.digest === b.digest && sameRows(a.rows, b.rows) && samePair(a.pair, b.pair) && sameIdentity(a.identity, b.identity) && sameSource(a.sourceDenial, b.sourceDenial) && (a.publication === null ? b.publication === null : b.publication !== null && a.publication.raw === b.publication.raw && a.publication.digest === b.publication.digest && sameIdentity(a.publication.rows, b.publication.rows));
    const sameArchive = (a: RecordState, wire: string, digest: string) => a.wire === wire && a.digest === digest;
    const stop = (): never => { if (runtimeSession) nativeRuntimeProtocolFault(runtimeSession); conflict = true; if (known || sourceAwareMode) fault = true; throw null; };
    const cancelled = Object.freeze({});
    const check = (proceed: () => boolean) => { if (!proceed()) throw cancelled; };
    // Strict source-aware dependency capture. Own data descriptors retain their
    // acquired values/get/set before any cancellation or later method lookup.
    function sourceMethod(receiver: object, name: string, proceed: () => boolean): (...args: never[]) => unknown {
      check(proceed);
      let method: unknown;
      try { method = work.field(receiver, name); }
      catch { fault = true; throw null; }
      if (typeof method !== "function") stop();
      check(proceed);
      return method as (...args: never[]) => unknown;
    }
    async function read(open: NativeSqliteConnection, proceed: () => boolean, ownPreparation = false, publicationStaged = false): Promise<RecordState | null> {
      const query = async (sql: string, fields: readonly string[], limit: number, validate: (name: string, value: unknown, index: number) => void) => {
        check(proceed);
        const method = sourceAwareMode ? sourceMethod(open, "query", proceed) : open.query;
        if (typeof method !== "function") { if (runtimeSession) nativeRuntimeFailed(runtimeSession, "domain"); await work.value(method); throw null; }
        check(proceed);
        if (runtimeSession) runtimeReads += 1;
        const raw = await work.value(Reflect.apply(method, open, [sql, []])); check(proceed);
        try { return work.rows(raw.value, fields, limit, validate); } catch { return stop(); }
      };
      try {
        const integerVersion = (_name: string, value: unknown) => { if (!Number.isSafeInteger(value) || (value as number) < 0) stop(); };
        const version = await query("PRAGMA schema_version;", ["schema_version"], 1, integerVersion);
        if (version.length !== 1 || !Number.isSafeInteger(version[0].schema_version) || (version[0].schema_version as number) < 0) stop();
        const publicationReading = sourceAwareMode && publicationPlan !== null;
        // Preserve immediate schema fencing in every established runtime path.
        // Only this private publication plan may observe its own changed DDL.
        if (runtimeSchemaVersion !== null && version[0].schema_version !== runtimeSchemaVersion && !publicationReading) stop();
        if (publicationReading && publicationPlan!.pin && version[0].schema_version !== publicationPlan!.pin.version) stop();
        if (publishedMode && publishedVersion !== null && version[0].schema_version !== publishedVersion) stop();
        const publicationAllowed = sourceAwareMode && (publishedMode || publicationReading || publishedPublication !== null);
        const definitions: Record<string, string> = { installation_transfer_quarantine_v1: ddl,
          ...(preparationMode ? { installation_transfer_prepared_v1: preparedDdl, installation_transfer_sporting_v1: sportingDdl } : {}),
          ...(pairingMode ? { installation_transfer_pair_v1: pairDdl, installation_transfer_binding_v1: bindingDdl } : {}),
          ...(identityMode ? { installation_transfer_identity_v1: identityDdl } : {}),
          ...(sourceAwareMode ? { installation_transfer_source_denial_v1: sourceDenialDdl } : {}),
          ...(publicationAllowed ? { installation_transfer_publication_v1: publicationDdl, installation_transfer_live_v1: liveDdl } : {}) };
        const seenNames: string[] = [];
        const seenTypes: string[] = [];
        const objects = await query("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name;", ["type", "name", "tbl_name", "sql"], publicationAllowed ? 11 : sourceAwareMode ? 8 : identityMode ? 7 : pairingMode ? 5 : preparationMode ? 3 : 1,
          (name, value, index) => {
            if (name === "type") { if (value !== "table" && !(identityMode && value === "index")) stop(); seenTypes[index] = value as string; }
            else if (name === "name") { if (typeof value !== "string" || !(Object.hasOwn(definitions, value) || identityMode && value === identityIndex || publicationAllowed && value === liveIndex) || seenNames.includes(value)) stop(); seenNames[index] = value as string; }
            else if (seenTypes[index] === "index") {
              const table = seenNames[index] === identityIndex ? "installation_transfer_identity_v1" : publicationAllowed && seenNames[index] === liveIndex ? "installation_transfer_live_v1" : null;
              if (!table || value !== (name === "tbl_name" ? table : null)) stop();
            } else if (seenNames[index] === identityIndex || seenNames[index] === liveIndex || value !== (name === "tbl_name" ? seenNames[index] : definitions[seenNames[index]])) stop();
          });
        if (publishedMode && objects.length !== 11) stop();
        const hasPublication = objects.length === 11;
        const hasSource = objects.length === 8 || hasPublication;
        const extended = objects.length === 7 || hasSource;
        const prepared = objects.length >= 3;
        const expectedNames = objects.length === 0 ? [] : ["installation_transfer_quarantine_v1",
          ...(prepared ? ["installation_transfer_prepared_v1", "installation_transfer_sporting_v1"] : []),
          ...(objects.length >= 4 ? ["installation_transfer_pair_v1"] : []),
          ...(objects.length === 5 || extended ? ["installation_transfer_binding_v1"] : []),
          ...(extended ? ["installation_transfer_identity_v1", identityIndex] : []),
          ...(hasSource ? ["installation_transfer_source_denial_v1"] : []),
          ...(hasPublication ? ["installation_transfer_publication_v1", "installation_transfer_live_v1", liveIndex] : [])];
        if (expectedNames.length !== objects.length || expectedNames.some(name => !seenNames.includes(name))) stop();
        let record: RecordState | null = null;
        if (objects.length) {
          const expected = [[0, "singleton", "INTEGER", 0, null, 1], [1, "protected_wire", "TEXT", 1, null, 0], [2, "package_digest", "TEXT", 1, null, 0]];
          const columnFields = ["cid", "name", "type", "notnull", "dflt_value", "pk"];
          const columns = await query("PRAGMA table_info('installation_transfer_quarantine_v1');", columnFields, 3,
            (name, value, index) => { if (value !== expected[index][columnFields.indexOf(name)]) stop(); });
          if (columns.length !== 3) stop();
          if ((await query("PRAGMA index_list('installation_transfer_quarantine_v1');", ["seq", "name", "unique", "origin", "partial"], 0, () => stop())).length) stop();
          const rows = await query("SELECT singleton,protected_wire,package_digest FROM installation_transfer_quarantine_v1 ORDER BY singleton;", ["singleton", "protected_wire", "package_digest"], 1,
            (name, value) => {
              if (name === "singleton" ? value !== 1 : name === "protected_wire" ? !isQuarantineProtectedWire(value) : typeof value !== "string" || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value)) stop();
            });
          if (rows.length !== 1) stop();
          record = { wire: rows[0].protected_wire as string, digest: rows[0].package_digest as string, rows: null, pair: null, identity: null, sourceDenial: null, publication: null };
          if (prepared) {
            const validateTable = async (name: string, expected: readonly (readonly unknown[])[]) => {
              const fields = ["cid", "name", "type", "notnull", "dflt_value", "pk"];
              const columns = await query(`PRAGMA table_info('${name}');`, fields, expected.length,
                (field, value, i) => { if (value !== expected[i][fields.indexOf(field)]) stop(); });
              if (columns.length !== expected.length) stop();
              await query(`PRAGMA index_list('${name}');`, ["seq", "name", "unique", "origin", "partial"], 0, () => stop());
            };
            await validateTable("installation_transfer_prepared_v1", [[0,"singleton","INTEGER",0,null,1],[1,"package_digest","TEXT",1,null,0],[2,"row_count","INTEGER",1,null,0]]);
            await validateTable("installation_transfer_sporting_v1", [[0,"slot","INTEGER",0,null,1],[1,"key","TEXT",1,null,0],[2,"value_ascii","TEXT",1,null,0],[3,"value_digest","TEXT",1,null,0]]);
            const meta = await query("SELECT singleton,package_digest,row_count FROM installation_transfer_prepared_v1;", ["singleton", "package_digest", "row_count"], 1,
              (name, value) => { if (name === "singleton" ? value !== 1 : name === "package_digest" ? value !== record!.digest : !Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 416) stop(); });
            if (meta.length !== 1) stop();
            const sporting: PreparedSportingRow[] = []; let total = 0, previous = "";
            const staged = await query("SELECT slot,key,value_ascii,value_digest FROM installation_transfer_sporting_v1 ORDER BY slot;", ["slot", "key", "value_ascii", "value_digest"], meta[0].row_count as number,
              (name, value, i) => {
                if (name === "slot") { if (value !== i) stop(); sporting[i] = { key: "", ascii: "", digest: "" }; }
                else if (name === "key") { if (typeof value !== "string" || value.length > 256 || value <= previous || transferSlot(value)?.category !== "sporting") stop(); previous = value as string; sporting[i] = { ...sporting[i], key: previous }; }
                else if (name === "value_ascii") { if (!isTransferCodeUnits(value)) stop(); total += (value as string).length - 4; if (total > 3145728 * 4) stop(); sporting[i] = { ...sporting[i], ascii: value as string }; }
                else { if (typeof value !== "string" || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value)) stop(); sporting[i] = { ...sporting[i], digest: value as string }; }
              });
            if (staged.length !== meta[0].row_count) stop();
            record = { ...record, rows: sporting };
            if (objects.length >= 4) {
              await validateTable("installation_transfer_pair_v1", [[0,"singleton","INTEGER",0,null,1],[1,"package_digest","TEXT",1,null,0],[2,"intent_q","TEXT",1,null,0],[3,"manifest","TEXT",1,null,0]]);
              let intentQ = "", manifest = "", boundQ: string | null = null;
              const intent = await query("SELECT singleton,package_digest,intent_q,manifest FROM installation_transfer_pair_v1;", ["singleton", "package_digest", "intent_q", "manifest"], 1,
                (name, value) => {
                  if (name === "singleton") { if (value !== 1) stop(); }
                  else if (name === "package_digest") { if (value !== record!.digest) stop(); }
                  else if (name === "intent_q") { if (!transferIntentQ(value)) stop(); intentQ = value as string; }
                  else { if (!readTransferPair(intentQ, value)) stop(); manifest = value as string; }
                });
              if (intent.length !== 1) stop();
              if (objects.length === 5 || extended) {
                await validateTable("installation_transfer_binding_v1", [[0,"singleton","INTEGER",0,null,1],[1,"package_digest","TEXT",1,null,0],[2,"bound_q","TEXT",1,null,0]]);
                const binding = await query("SELECT singleton,package_digest,bound_q FROM installation_transfer_binding_v1;", ["singleton", "package_digest", "bound_q"], 1,
                  (name, value) => {
                    if (name === "singleton") { if (value !== 1) stop(); }
                    else if (name === "package_digest") { if (value !== record!.digest) stop(); }
                    else { if (typeof value !== "string" || !readTransferPair(intentQ, manifest, value)) stop(); boundQ = value as string; }
                  });
                if (binding.length !== 1) stop();
              }
              record = { ...record, pair: Object.freeze({ intentQ, manifest, boundQ }) };
            }
          }
        }
        if (extended) {
          if (!record?.pair?.boundQ) stop();
          const fields = ["cid", "name", "type", "notnull", "dflt_value", "pk"];
          const expected = [[0,"key","TEXT",1,null,1],[1,"value_ascii","TEXT",1,null,0]];
          const columns = await query("PRAGMA table_info('installation_transfer_identity_v1');", fields, 2,
            (field, value, i) => { if (value !== expected[i][fields.indexOf(field)]) stop(); });
          if (columns.length !== 2) stop();
          const indexes = await query("PRAGMA index_list('installation_transfer_identity_v1');", ["seq", "name", "unique", "origin", "partial"], 1,
            (field, value) => { if (value !== ({ seq: 0, name: identityIndex, unique: 1, origin: "pk", partial: 0 } as Record<string, unknown>)[field]) stop(); });
          if (indexes.length !== 1) stop();
          const index = await query("PRAGMA index_info('sqlite_autoindex_installation_transfer_identity_v1_1');", ["seqno", "cid", "name"], 1,
            (field, value) => { if (value !== ({ seqno: 0, cid: 0, name: "key" } as Record<string, unknown>)[field]) stop(); });
          if (index.length !== 1) stop();
          const identity: IdentityRow[] = []; let previous = "", total = 0;
          await query("SELECT key,value_ascii FROM installation_transfer_identity_v1 ORDER BY key LIMIT 4097;", ["key", "value_ascii"], 4097,
            (field, value, i) => {
              if (i >= 4096) stop();
              if (field === "key") {
                if (!identityKey(value) || value <= previous) stop();
                previous = value as string; identity[i] = { key: value as string, ascii: "" };
              } else {
                if (!isTransferCodeUnits(value)) stop();
                total += ((value as string).length - 4) / 4; if (total > 4194304) stop();
                identity[i] = { ...identity[i], ascii: value as string };
              }
            });
          record = { ...record!, identity };
        }
        if (hasSource) {
          if (!record || record.identity === null) stop();
          const fields = ["cid", "name", "type", "notnull", "dflt_value", "pk"];
          const expected = [[0,"singleton","INTEGER",0,null,1],[1,"package_digest","TEXT",1,null,0],[2,"projection_ascii","TEXT",1,null,0],[3,"projection_digest","TEXT",1,null,0]];
          const columns = await query("PRAGMA table_info('installation_transfer_source_denial_v1');", fields, 4,
            (field, value, i) => { if (value !== expected[i][fields.indexOf(field)]) stop(); });
          if (columns.length !== 4) stop();
          await query("PRAGMA index_list('installation_transfer_source_denial_v1');", ["seq", "name", "unique", "origin", "partial"], 0, () => stop());
          const rows = await query("SELECT singleton,package_digest,projection_ascii,projection_digest FROM installation_transfer_source_denial_v1 ORDER BY singleton;", ["singleton", "package_digest", "projection_ascii", "projection_digest"], 1,
            (field, value) => {
              if (field === "singleton" ? value !== 1 : field === "package_digest" ? value !== record!.digest : field === "projection_ascii" ? parseTransferSourceDenial(value, record!.digest) === null : typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) stop();
            });
          if (rows.length !== 1) stop();
          record = { ...record!, sourceDenial: Object.freeze({ packageDigest: rows[0].package_digest as string, ascii: rows[0].projection_ascii as string, digest: rows[0].projection_digest as string }) };
        }
        if (hasPublication) {
          const expectedPublication = publicationPlan?.desired.publication ?? publishedPublication;
          if ((!expectedPublication && !publishedMode) || !record?.rows || !record.sourceDenial) stop();
          const sourceRecord = record!;
          const fields = ["cid", "name", "type", "notnull", "dflt_value", "pk"];
          const tables = [
            ["installation_transfer_publication_v1", [[0,"singleton","INTEGER",0,null,1],[1,"anchor_ascii","TEXT",1,null,0],[2,"anchor_digest","TEXT",1,null,0]]],
            ["installation_transfer_live_v1", [[0,"key","TEXT",1,null,1],[1,"value_ascii","TEXT",1,null,0]]],
          ] as const;
          for (const [table, expected] of tables) {
            const columns = await query(`PRAGMA table_info('${table}');`, fields, expected.length, (field, value, i) => { if (value !== expected[i][fields.indexOf(field)]) stop(); });
            if (columns.length !== expected.length) stop();
          }
          await query("PRAGMA index_list('installation_transfer_publication_v1');", ["seq", "name", "unique", "origin", "partial"], 0, () => stop());
          const indexes = await query("PRAGMA index_list('installation_transfer_live_v1');", ["seq", "name", "unique", "origin", "partial"], 1,
            (field, value) => { if (value !== ({ seq: 0, name: liveIndex, unique: 1, origin: "pk", partial: 0 } as Record<string, unknown>)[field]) stop(); });
          if (indexes.length !== 1) stop();
          const index = await query("PRAGMA index_info('sqlite_autoindex_installation_transfer_live_v1_1');", ["seqno", "cid", "name"], 1,
            (field, value) => { if (value !== ({ seqno: 0, cid: 0, name: "key" } as Record<string, unknown>)[field]) stop(); });
          if (index.length !== 1) stop();
          const receipt = await query("SELECT singleton,anchor_ascii,anchor_digest FROM installation_transfer_publication_v1;", ["singleton", "anchor_ascii", "anchor_digest"], 1,
            (field, value) => { if (field === "singleton" ? value !== 1 : field === "anchor_ascii" ? typeof value !== "string" || value.length > MAX_PUBLICATION_ASCII || !parsePublicationAnchor(value) || expectedPublication !== null && expectedPublication !== undefined && value !== expectedPublication.raw : typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value) || expectedPublication !== null && expectedPublication !== undefined && value !== expectedPublication.digest) stop(); });
          if (receipt.length !== 1) stop();
          const rows: IdentityRow[] = [];
          // Published live rows are mutable ordinary data. Cold provenance binds
          // original prepared evidence; it never enumerates or caps future live data.
          if (!publishedMode) {
            const live = await query("SELECT key,value_ascii FROM installation_transfer_live_v1 ORDER BY key;", ["key", "value_ascii"], sourceRecord.rows!.length,
              (field, value, i) => { const expected = sourceRecord.rows![i]; if (value !== (field === "key" ? expected.key : expected.ascii)) stop(); if (field === "key") rows[i] = { key: value as string, ascii: "" }; else rows[i] = { ...rows[i], ascii: value as string }; });
            if (live.length !== sourceRecord.rows!.length) stop();
          }
          record = { ...sourceRecord, publication: { raw: receipt[0].anchor_ascii as string, digest: receipt[0].anchor_digest as string, rows } };
        }
        const after = await query("PRAGMA schema_version;", ["schema_version"], 1, integerVersion);
        if (after.length !== 1 || version[0].schema_version !== after[0].schema_version) stop();
        const schema = version[0].schema_version as number;
        if (publicationReading && publicationPlan!.classifying && !publicationStaged) {
          const plan = publicationPlan!;
          const layout = same(record, plan.before) ? "before8" : same(record, plan.desired) ? "desired11" : "unknown";
          if (layout === "unknown" || !record) stop();
          if (plan.pin && (plan.pin.version !== schema || !same(plan.pin.record, record))) stop();
          if (!plan.pin) { plan.observedLayout = layout; plan.pin = Object.freeze({ record: record!, version: schema }); }
          if (layout === "before8" ? schema !== plan.beforeVersion : plan.stagedVersion !== null && schema !== plan.stagedVersion) stop();
        } else if (runtimeSchemaVersion !== null && schema !== runtimeSchemaVersion && !(publicationReading && publicationStaged && hasPublication)) stop();
        if (!ownPreparation && outcome?.observed && !same(outcome.readback, record)) stop();
        if (known && !ownPreparation && !publicationReading && !same(known, record) && !(outcome && !outcome.observed && same(outcome.desired, record))) stop();
        observedSchemaVersion = version[0].schema_version as number;
        return record;
      } catch (reason) { if (publishedMode && reason !== cancelled) fault = true; if (runtimeSession && reason !== cancelled) nativeRuntimeFailed(runtimeSession, "domain"); await work.finish(); throw reason; }
    }
    async function reserve(): Promise<boolean> {
      if (lease) return true;
      const acquired = await core.acquire();
      if (!acquired.ok) return false;
      lease = acquired.lease; return true;
    }
    function task(operation: () => Promise<NativeTransferQuarantineCode>): Promise<NativeTransferQuarantineCode> {
      const whole: Promise<NativeTransferQuarantineCode> = core.enqueue(async () => {
        work = createQuarantineWork(value => value === whole || owned(value));
        conflict = false;
        try { return await operation(); }
        catch { return fault ? "fault_held" : conflict ? "target_conflict" : "unavailable"; }
        finally { await work.finish(); }
      });
      return sourceCompletion(whole);
    }
    // Same core/queue and actual completion ownership. No SQL task awaits a
    // protected operation; protected facts arrive as genuine opaque observations.
    function publicationTask<T>(operation: () => Promise<T>, refused: T, settled?: () => void, finalize?: (value: T) => T): Promise<T> {
      const whole = core.enqueue(async () => {
        work = createQuarantineWork(value => value === whole || owned(value), () => {
          fault = true;
          if (runtimeSession) nativeRuntimeFailed(runtimeSession, "domain");
        });
        let result = refused;
        try { result = await operation(); }
        catch { /* A refused result still joins all acquired work. */ }
        finally { try { await work.finish(); } finally { settled?.(); } }
        try { return finalize ? finalize(result) : result; }
        catch { return refused; }
      });
      return sourceCompletion(whole);
    }
    type PublicationDraft = Readonly<{ before: RecordState; stamp: object; raw: string; anchorDigest: string }>;
    const publicationDrafts = new WeakMap<object, PublicationDraft>();
    let acceptedPublicationDraft: Readonly<{ token: object; draft: PublicationDraft; observationBoundary: number }> | null = null;
    const quote = (value: string) => serializePlatformStringTuple(value).slice(1, -1);
    function publicationObservation(before: RecordState, value: unknown) {
      const observed = readPublicationAnchorObservation(value), pair = before.pair && readTransferPair(before.pair.intentQ, before.pair.manifest, before.pair.boundQ);
      if (!observed || !pair?.bound || observed.manifest !== before.pair!.manifest) return null;
      for (const key of ["schemaVersion", "protocolId", "credentialEpochId", "manifestId", "providerConfigIdentity", "sdkContractVersion", "sessionStorageKey", "storeIdentity"] as const) if (observed.q[key] !== pair.bound[key]) return null;
      return observed;
    }
    function sourceAllows(before: RecordState, account: string, profile: string): boolean {
      const facts = before.sourceDenial && parseTransferSourceDenial(before.sourceDenial.ascii, before.digest);
      return !!facts && facts.preflight.kind !== "quarantined" && facts.intentCleanup.kind === "absent" && facts.sportingProfiles.length > 0 && facts.sportingProfiles.includes(profile) &&
        (facts.preflight.kind !== "correlated" || facts.preflight.authenticatedAccountScopeId === account);
    }
    function preparedRowsJson(rows: readonly PreparedSportingRow[]): string | null {
      if (rows.length > 416) return null;
      let units = 0, size = 2, escaped = 0, previous = "";
      const keys: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.key.length > 256 || row.key <= previous || transferSlot(row.key)?.category !== "sporting" || !isTransferCodeUnits(row.ascii) || !/^[a-f0-9]{64}$/.test(row.digest)) return null;
        previous = row.key; units += (row.ascii.length - 4) / 4; if (units > 3145728) return null;
        const key = quote(row.key); keys.push(key);
        size += (i ? 1 : 0) + String(i).length + key.length + row.ascii.length + 2 + 66 + 5;
        for (let j = 0; j < key.length; j++) if (key[j] === '"' || key[j] === "\\") escaped++;
        escaped += 4; // ASCII/codeunit and digest quotes; their contents need no escape.
      }
      // Before allocating the complete row frame. Even conservatively escaped
      // keys admit <= 4*3145728 + 416*(12*256+256)+256 = 13967616 < 16777216.
      if (size + escaped + 128 > 16777216) return null;
      return "[" + rows.map((row, i) => "[" + i + "," + keys[i] + "," + quote(row.ascii) + "," + quote(row.digest) + "]").join(",") + "]";
    }
    async function publicationFingerprints(before: RecordState, current: () => boolean) {
      // Actual prepare admission already validated each original row digest by
      // authenticated V3 decode. This same unchanged full snapshot retains it.
      if (!authenticated || !preparedAuthenticated || !sourceVerified || !before.sourceDenial || !before.rows || !current()) return null;
      const rows = preparedRowsJson(before.rows); if (rows === null) return null;
      const wire = await hashPublicationValue("wire", [before.wire], owned, current);
      if (!wire || !current()) return null;
      const prepared = await hashPublicationValue("prepared", [before.digest, rows], owned, current);
      return prepared && current() ? Object.freeze({ wire, prepared }) : null;
    }
    function publicationRaw(before: RecordState, id: string, account: string, profile: string, revision: number, hashes: Readonly<{ wire: string; prepared: string }>): string | null {
      const pair = before.pair && readTransferPair(before.pair.intentQ, before.pair.manifest, before.pair.boundQ);
      const facts = before.sourceDenial && parseTransferSourceDenial(before.sourceDenial.ascii, before.digest);
      if (!pair?.bound || !facts || !sourceAllows(before, account, profile)) return null;
      const q = pair.bound;
      return serializePublicationAnchor({ schemaVersion: 1, protocol: "curling-installation-publication-v1", publicationId: id, providerConfigIdentity: q.providerConfigIdentity, sessionStorageKey: q.sessionStorageKey, sdkContractVersion: q.sdkContractVersion, protocolId: q.protocolId, credentialEpochId: q.credentialEpochId, manifestId: q.manifestId, storeIdentity: q.storeIdentity, packageDigest: before.digest, sourceDenialDigest: before.sourceDenial!.digest, protectedWireDigest: hashes.wire, preparedDigest: hashes.prepared, profiles: facts.sportingProfiles, selectedProfileId: profile, accountScopeId: account, controlRevision: revision, workingLayout: "installation-live-ascii-v1" });
    }
    async function publicationId(before: RecordState, current: () => boolean): Promise<string | null> {
      // Platform UUID capture is pre-write metadata, not a native SQL result.
      // Retain unrelated malformed work without poisoning healthy SQL cleanup.
      const capture = createQuarantineWork(owned);
      try {
        check(current); const crypto = globalThis.crypto;
        const container = await capture.value(crypto); check(current);
        if (container.value !== crypto || !crypto || typeof crypto !== "object") return null;
        const method: unknown = crypto.randomUUID;
        const captured = await capture.value(method); check(current);
        if (captured.value !== method || typeof method !== "function") return null;
        const value: unknown = Reflect.apply(method, crypto, []);
        if (typeof value !== "string") { await capture.value(value); return null; }
        check(current);
        const pair = before.pair && readTransferPair(before.pair.intentQ, before.pair.manifest, before.pair.boundQ);
        return pair?.bound && isCanonicalUuid(value) && ![pair.bound.protocolId, pair.bound.credentialEpochId, pair.bound.manifestId, pair.bound.storeIdentity].includes(value) ? value : null;
      } finally { await capture.finish(); }
    }

    function draftCurrent(draft: PublicationDraft): boolean {
      return accountControlCurrent(draft.stamp) && same(known, draft.before);
    }
    function publicationDraftPayload(value: unknown) {
      const draft = acceptedPublicationDraft !== null && acceptedPublicationDraft.token === value ? acceptedPublicationDraft.draft : value !== null && typeof value === "object" ? publicationDrafts.get(value) : null;
      return draft && draftCurrent(draft) ? Object.freeze({ raw: draft.raw, anchorDigest: draft.anchorDigest }) : null;
    }
    function verifyPublicationIntent(value: unknown, proceed: () => boolean): Promise<boolean> {
      return publicationTask(async () => {
        const current = () => proceed() === true && sourceAwareMode && sourceVerified && authenticated && preparedAuthenticated && runtimeRole === "migration" && !fault && !unresolved && !outcome;
        if (!current()) return false;
        const before = await observe(current); if (!before || !current()) return false;
        const observation = publicationObservation(before, value); if (!observation) return false;
        // No historical intent: identity-only recovery is still allowed. Initial
        // publication eligibility is evaluated later against actual fresh P/S/C.
        if (observation.raw === null) return current();
        const anchor = observation.anchor!;
        if (!sourceAllows(before, anchor.accountScopeId, anchor.selectedProfileId)) return false;
        const hashes = await publicationFingerprints(before, current); if (!hashes || !current()) return false;
        return publicationRaw(before, anchor.publicationId, anchor.accountScopeId, anchor.selectedProfileId, anchor.controlRevision, hashes) === observation.raw && publicationObservation(before, value) !== null && current();
      }, false);
    }
    function preparePublication(stamp: unknown, value: unknown): Promise<object | null> {
      return publicationTask(async () => {
        const current = () => publishedPublication === null && accountControlCurrent(stamp);
        if (!current()) return null;
        const controlStamp = controlStamps.get(stamp as object)!;
        const control = readTransferAccountControlObservation(controlStamp.observation)!;
        const before = await observe(current); if (!before || !current() || !sourceAllows(before, control.accountScopeId, control.profileId)) return null;
        const observation = publicationObservation(before, value); if (!observation) return null;
        const hashes = await publicationFingerprints(before, current); if (!hashes || !current()) return null;
        const candidate: PublicationAnchor | null = observation.anchor;
        if (candidate && control.revision < candidate.controlRevision) return null;
        const id = candidate?.publicationId ?? await publicationId(before, current); if (!id || !current()) return null;
        const raw = publicationRaw(before, id, control.accountScopeId, control.profileId, candidate?.controlRevision ?? control.revision, hashes);
        if (!raw || candidate && raw !== observation.raw || !publicationObservation(before, value) || !current()) return null;
        const anchorDigest = await hashPublicationValue("anchor", [raw], owned, current);
        if (!anchorDigest || !current()) return null;
        const token = Object.freeze(Object.create(null)) as object;
        publicationDrafts.set(token, Object.freeze({ before, stamp: stamp as object, raw, anchorDigest })); return token;
      }, null);
    }
    function acceptPublicationAnchor(token: unknown, value: unknown): Promise<boolean> {
      let candidate: PublicationDraft | null = null;
      return publicationTask(async () => {
        const draft = token !== null && typeof token === "object" ? publicationDrafts.get(token) : null;
        if (publishedPublication !== null || !draft || !draftCurrent(draft)) return false;
        const current = () => draftCurrent(draft);
        const before = await observe(current); if (!before || !same(before, draft.before) || !current()) return false;
        const observation = publicationObservation(before, value);
        if (!observation || observation.raw !== draft.raw || !current()) return false;
        candidate = draft; return true;
      }, false, undefined, accepted => {
        // Finalize after the task's last acquired-work drain, with no later await.
        if (!accepted || !candidate || !draftCurrent(candidate)) return false;
        const observation = publicationObservation(candidate.before, value);
        if (!observation || observation.raw !== candidate.raw) return false;
        acceptedPublicationDraft = Object.freeze({ token: token as object, draft: candidate, observationBoundary: observation.latestOccurrence() });
        return true;
      });
    }
    const publicationResult = (code: TransferPublicationSqlResult["code"], observedLayout: TransferPublicationSqlResult["observedLayout"] = "unknown"): TransferPublicationSqlResult => Object.freeze({ code, observedLayout });
    function holdPublication(plan: PublicationPlan): TransferPublicationSqlResult {
      // Unknown storage facts are not a usable runtime, even after positive close.
      fault = true; unresolved = true;
      if (runtimeSession) nativeRuntimeFailed(runtimeSession, "domain");
      return publicationResult("fault_held", plan.observedLayout);
    }
    async function classifyPublication(plan: PublicationPlan): Promise<TransferPublicationSqlResult> {
      try {
        plan.classifying = true;
        const reopened = await core.reopen(lease!);
        if (!reopened.ok) return holdPublication(plan);
        const after = await observe(() => true);
        if (!plan.pin || !after || !same(plan.pin.record, after) || plan.pin.version !== observedSchemaVersion) return holdPublication(plan);
        const healthy = !fault && !!runtimeSession && nativeRuntimeStorageHealthy(runtimeSession);
        if (same(after, plan.desired)) {
          if (!plan.commitIssued || !healthy || plan.stagedVersion === null || plan.pin.version !== plan.stagedVersion) return holdPublication(plan);
          known = after; runtimeSchemaVersion = plan.pin.version;
          publishedPublication = after.publication; publicationPlan = null;
          acceptedPublicationDraft = null; unresolved = false;
          return publicationResult("publication_confirmed", "desired11");
        }
        if (!same(after, plan.before) || plan.confirmed) return holdPublication(plan);
        if (plan.commitIssued || !healthy) return holdPublication(plan);
        known = after; publicationPlan = null; unresolved = false;
        return publicationResult("publication_unpublished", "before8");
      } catch { return holdPublication(plan); }
    }
    function publishPrepared(value: unknown): Promise<TransferPublicationSqlResult> {
      if (publicationFlight) return publicationFlight;
      const refused = publicationResult("publication_refused");
      const whole = publicationTask(async () => {
        let plan: PublicationPlan | null = null;
        try {
          const accepted = acceptedPublicationDraft, draft = accepted?.draft;
          if (!sourceAwareMode || publishedPublication || publicationPlan || !draft || !draftCurrent(draft) || !lease || !runtimeSession || runtimeSchemaVersion === null || !sourceQueueCurrent?.()) return refused;
          const original = controlStamps.get(draft.stamp), fresh = original && freshStamps.get(original.freshStamp);
          const control = original && readTransferAccountControlObservation(original.observation);
          if (!original || !fresh || !control) return refused;
          const before = await observe(() => draftCurrent(draft));
          if (!before || !same(before, draft.before) || !draftCurrent(draft) || !before.rows || before.identity === null || before.publication) return refused;
          const physical = publicationObservation(before, value);
          if (!physical || physical.occurrence <= accepted!.observationBoundary || physical.raw !== draft.raw || !sourceAllows(before, control.accountScopeId, control.profileId)) return refused;
          const publication: PublicationState = { raw: draft.raw, digest: draft.anchorDigest, rows: before.rows.map(row => ({ key: row.key, ascii: row.ascii })) };
          const desired = { ...before, publication };
          const session = runtimeSession, revision = identityRevision, schema = runtimeSchemaVersion;
          const sequence = {}; mutationSequence = sequence;
          publicationQueueHeld = true;
          plan = { before, desired, beforeVersion: schema, stagedVersion: null, commitIssued: false, confirmed: false, classifying: false, pin: null, observedLayout: "unknown" };
          publicationPlan = plan;
          const current = () => {
            if (!publicationQueueHeld || publicationPlan !== plan || runtimeSession !== session || identityRevision !== revision || runtimeSchemaVersion !== schema || mutationSequence !== sequence || pendingMutations !== 0 || !sourceQueueCurrent?.()) return false;
            const actualFresh = readNativeFreshEmailOtp(fresh.event), actualControl = readTransferAccountControlObservation(original.observation);
            return !!actualFresh && !!actualControl && actualFresh.source === freshSource && actualFresh.source === actualControl.source && actualControl.event === fresh.event && actualFresh.accountScopeId === control.accountScopeId && actualControl.accountScopeId === control.accountScopeId && actualFresh.profileId === control.profileId && actualControl.profileId === control.profileId && actualFresh.current();
          };
          let open: NativeSqliteConnection | null = null, rollback: (() => unknown) | null = null, began = false;
          try {
            check(current); open = (await core.openBoxed(current)).connection; check(current);
            const begin = sourceMethod(open, "beginTransaction", current);
            const execute = sourceMethod(open, "execute", current);
            const run = sourceMethod(open, "run", current);
            const commit = sourceMethod(open, "commitTransaction", current);
            const undo = sourceMethod(open, "rollbackTransaction", current);
            rollback = () => Reflect.apply(undo, open, []);
            check(current); core.phase();
            work.ack((await work.value(Reflect.apply(begin, open, []))).value); began = true; check(current);
            if (!same(await read(open, current, false, true), before)) stop();
            check(current); work.ack((await work.value(Reflect.apply(execute, open, [publicationDdl, false]))).value); check(current);
            work.ack((await work.value(Reflect.apply(execute, open, [liveDdl, false]))).value); check(current);
            for (let i = 0; i < publication.rows.length; i++) {
              const row = publication.rows[i]; check(current);
              work.ack((await work.value(Reflect.apply(run, open, ["INSERT INTO installation_transfer_live_v1 (key,value_ascii) VALUES (?,?)", [row.key, row.ascii], false]))).value, 1, i + 1); check(current);
            }
            work.ack((await work.value(Reflect.apply(run, open, ["INSERT INTO installation_transfer_publication_v1 (singleton,anchor_ascii,anchor_digest) VALUES (1,?,?)", [publication.raw, publication.digest], false]))).value, 1); check(current);
            if (!same(await read(open, current, false, true), desired)) stop();
            plan.stagedVersion = observedSchemaVersion;
            check(current); plan.commitIssued = true;
            work.ack((await work.value(Reflect.apply(commit, open, []))).value); plan.confirmed = true;
          } catch (reason) {
            // Direct native throws need the same immediate revocation as a
            // malformed/rejected native return; healthy cancellation does not.
            if (reason !== cancelled) { fault = true; nativeRuntimeFailed(session, "domain"); }
            await work.finish();
            if (!plan.commitIssued && began && rollback) {
              try { work.ack((await work.value(rollback())).value); }
              catch { fault = true; nativeRuntimeFailed(session, "domain"); }
            }
          }
          await work.finish();
          return await classifyPublication(plan);
        } catch (reason) {
          if (reason !== cancelled) { fault = true; if (runtimeSession) nativeRuntimeFailed(runtimeSession, "domain"); }
          await work.finish();
          return plan ? await classifyPublication(plan) : publicationResult(fault ? "fault_held" : "publication_refused");
        }
      }, refused, () => { publicationQueueHeld = false; publicationFlight = null; });
      publicationFlight = whole;
      return whole;
    }
    async function observe(proceed: () => boolean): Promise<RecordState | null> {
      check(proceed); const open = sourceAwareMode ? (await core.openBoxed(proceed)).connection : await core.open(proceed); check(proceed);
      const observed = await read(open, proceed);
      if (observed && !publicationPlan) known = observed;
      return observed;
    }
    async function settleOutcome(): Promise<NativeTransferQuarantineCode> {
      const plan = outcome!;
      const reopened = await core.reopen(lease!);
      if (!reopened.ok) {
        if (conflict) { fault = true; outcome = null; }
        unresolved = true; return fault ? "fault_held" : "outcome_unresolved";
      }
      let after: RecordState | null;
      try { after = await observe(() => true); }
      catch {
        if (conflict) { fault = true; outcome = null; }
        unresolved = true; return fault ? "fault_held" : "outcome_unresolved";
      }
      outcome = null;
      if (plan.commitIssued && same(after, plan.desired)) { unresolved = false; authenticated = true; if (plan.success === "prepared") preparedAuthenticated = true; return plan.success; }
      if (!same(after, plan.before) || plan.confirmed) { fault = true; return "fault_held"; }
      if (plan.commitIssued) { unresolved = true; return "outcome_unresolved"; }
      unresolved = false; return "unavailable";
    }
    async function transact(before: RecordState | null, desired: RecordState, proceed: () => boolean, success: NativeTransferQuarantineCode, write: (open: Pick<NativeSqliteConnection, "execute" | "run">) => Promise<void>): Promise<NativeTransferQuarantineCode> {
      check(proceed); const open = sourceAwareMode ? (await core.openBoxed(proceed)).connection : await core.open(proceed); check(proceed);
        let began = false, beginIssued = false, commitIssued = false, confirmed = false;
        let rollback: (() => unknown) | null = null;
        try {
          let begin: () => unknown = () => open.beginTransaction(), commit: () => unknown = () => open.commitTransaction();
          let writer: Pick<NativeSqliteConnection, "execute" | "run"> = open;
          if (sourceAwareMode) {
            const beginCall = sourceMethod(open, "beginTransaction", proceed);
            const executeCall = sourceMethod(open, "execute", proceed);
            const runCall = sourceMethod(open, "run", proceed);
            const commitCall = sourceMethod(open, "commitTransaction", proceed);
            const rollbackCall = sourceMethod(open, "rollbackTransaction", proceed);
            begin = () => Reflect.apply(beginCall, open, []);
            commit = () => Reflect.apply(commitCall, open, []);
            rollback = () => Reflect.apply(rollbackCall, open, []);
            writer = { execute: (sql, transaction) => Reflect.apply(executeCall, open, [sql, transaction]), run: (sql, values, transaction) => Reflect.apply(runCall, open, [sql, values, transaction]) };
          }
          check(proceed); beginIssued = true; core.phase();
          work.ack((await work.value(begin())).value); began = true; check(proceed);
          if (!same(await read(open, proceed), before)) stop();
          await write(writer);
          if (!same(await read(open, proceed, true), desired)) stop();
          check(proceed); commitIssued = true;
          work.ack((await work.value(commit())).value); confirmed = true;
        } catch {
          await work.finish();
          if (conflict) fault = true;
          if (!commitIssued && began) {
            try { work.ack((await work.value(sourceAwareMode ? rollback!() : open.rollbackTransaction())).value); } catch { /* Reopen must end uncertain native work. */ }
            await work.finish();
          }
        }
      if (!beginIssued) return "unavailable";
      outcome = { desired, before, commitIssued, confirmed, success, observed: false, readback: null };
      return settleOutcome();
    }
    function prepareRuntime(session: NativeRuntimeSession, ownerCurrent: () => boolean): Promise<NativeRuntimeDomainDraft | null> {
      const whole = core.enqueue(async () => {
        work = createQuarantineWork(value => value === whole || owned(value));
        try {
          if (!identityMode || sourceAwareMode && !sourceVerified || runtimeRole !== "migration" || runtimeSession || fault || unresolved || outcome || !lease || !core.leaseCurrent(lease, true) || !ownerCurrent() || !nativeRuntimeCurrent(session, "domain", true)) return null;
          const observed = await observe(ownerCurrent);
          if (!observed?.pair?.boundQ || observed.identity === null || sourceAwareMode && observed.sourceDenial === null || !ownerCurrent()) return null;
          runtimeSession = session; runtimeSchemaVersion = observedSchemaVersion; runtimeRole = "prepared";
          const ready = () => runtimeRole === "prepared" && !!lease && core.leaseCurrent(lease, true) && !fault && ownerCurrent() && nativeRuntimeCurrent(session, "domain", true);
          const live = () => runtimeRole === "runtime" && !!lease && core.leaseCurrent(lease, true) && !fault && ownerCurrent() && nativeRuntimeCurrent(session, "domain");
          if (sourceAwareMode) {
            sourceLive = live;
            sourceQueueCurrent = () => runtimeRole === "runtime" && !!lease && core.leaseCurrent(lease, false) && !fault && ownerCurrent() && nativeRuntimeCurrent(session, "credential");
          }
          const admitQueued = () => live() || sourceAwareMode && publicationQueueHeld && sourceQueueCurrent?.() === true;
          const anchors = new WeakSet<object>();
          const sourceFailed = () => { nativeRuntimeFailed(session, "domain"); };
          const error = () => ({ kind: "storage_unavailable" as const });
          const readFailed = (): StorageGetResult => ({ status: "read_failed", fallback: null, error: error() });
          const mutationFailed = (): PersistenceWriteResult & PersistenceRemoveResult => ({ ok: false, error: error() });
          function runtimeTask<T>(operation: () => Promise<T>, failure: () => T, settled?: () => void): Promise<T> {
            const queued = core.enqueue(async () => {
              work = createQuarantineWork(value => value === queued || value === returned || owned(value), sourceFailed);
              try { return await operation(); }
              catch { sourceFailed(); return failure(); }
              finally { try { await work.finish(); } finally { settled?.(); } }
            });
            const returned = queued.catch(() => { sourceFailed(); return failure(); });
            if (sourceAwareMode) {
              registerTransferRuntimeCompletion(session, queued);
              registerTransferRuntimeCompletion(session, returned);
            }
            return returned;
          }
          async function controls(): Promise<{ open: NativeSqliteConnection; before: RecordState }> {
            check(live); const open = sourceAwareMode ? (await core.openBoxed(live)).connection : await core.open(live); check(live);
            const before = await read(open, live); check(live);
            if (!before?.pair?.boundQ || before.identity === null) stop();
            return { open, before: before! };
          }
          function get(key: string): Promise<StorageGetResult> {
            if (!identityKey(key) || !admitQueued()) return Promise.resolve(readFailed());
            return runtimeTask(async () => {
              const readsBefore = runtimeReads; let success = false;
              try {
                check(live);
                const { before } = await controls(); check(live);
                const row = before.identity!.find(row => row.key === key);
                success = true;
                return { status: "value" as const, value: row ? decodeTransferCodeUnits(row.ascii) : null };
              } catch (reason) { if (reason !== cancelled) sourceFailed(); return readFailed(); }
              finally { nativeRuntimeEvidence(session, "domain", { operation: "read", issued: runtimeReads !== readsBefore, acknowledged: success, verified: success, outcome: success ? "success" : runtimeReads !== readsBefore ? "unverified" : "refused" }); }
            }, readFailed);
          }
          function mutate(kind: "write" | "remove", key: string, value?: string): Promise<PersistenceWriteResult | PersistenceRemoveResult> {
            if (!identityKey(key) || kind === "write" && (typeof value !== "string" || value.length > 1048576) || !admitQueued()) return Promise.resolve(mutationFailed());
            const encoded = kind === "write" ? encodeTransferCodeUnits(value) : null;
            // No native write or source failure for caller capacity/input refusal.
            const projection = (rows: readonly IdentityRow[]) => {
              const after = rows.filter(row => row.key !== key);
              if (encoded !== null) after.push({ key, ascii: encoded });
              after.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
              return after.length <= 4096 && after.reduce((total, row) => total + (row.ascii.length - 4) / 4, 0) <= 4194304 ? after : null;
            };
            if (!known?.identity || !projection(known.identity)) return Promise.resolve(mutationFailed());
            if (sourceAwareMode) { mutationSequence = {}; pendingMutations++; }
            return runtimeTask(async () => {
              const tx = { beginIssued: false, beginAcknowledged: false, statementIssued: false, statementAcknowledged: false, commitIssued: false, commitAcknowledged: false, rollbackIssued: false, rollbackAcknowledged: false };
              const readsBefore = runtimeReads;
              let open: NativeSqliteConnection | null = null, cleanupRollback: NativeSqliteConnection["rollbackTransaction"] | null = null, success = false;
              try {
                check(live);
                const controlsBefore = await controls(); open = controlsBefore.open;
                const before = controlsBefore.before;
                const rows = projection(before.identity!); if (!rows) return mutationFailed();
                const previous = before.identity!.find(row => row.key === key);
                if (kind === "remove" && !previous) { success = true; return { ok: true as const }; }
                const desired = { ...before, identity: rows };
                // Capture methods once, retain actual receiver, check before issue.
                async function method(name: "beginTransaction" | "run" | "commitTransaction" | "rollbackTransaction") {
                  check(live); const call = open![name];
                  if (typeof call !== "function") { sourceFailed(); await work.value(call); throw null; }
                  check(live); return { call };
                }
                const begin = (await method("beginTransaction")).call;
                const run = (await method("run")).call;
                const commit = (await method("commitTransaction")).call;
                cleanupRollback = (await method("rollbackTransaction")).call as NativeSqliteConnection["rollbackTransaction"];
                check(live); tx.beginIssued = true;
                work.ack((await work.value(Reflect.apply(begin, open, []))).value); tx.beginAcknowledged = true; check(live);
                if (!same(await read(open, live), before)) stop();
                const sql = kind === "remove" ? "DELETE FROM installation_transfer_identity_v1 WHERE key=? AND value_ascii=?" : previous ? "UPDATE installation_transfer_identity_v1 SET value_ascii=? WHERE key=? AND value_ascii=?" : "INSERT INTO installation_transfer_identity_v1 (key,value_ascii) VALUES (?,?)";
                const values = kind === "remove" ? [key, previous!.ascii] : previous ? [encoded, key, previous.ascii] : [key, encoded];
                check(live); tx.statementIssued = true;
                work.mutationAck((await work.value(Reflect.apply(run, open, [sql, values, false]))).value, 1); tx.statementAcknowledged = true; check(live);
                if (!same(await read(open, live, true), desired)) stop();
                check(live); tx.commitIssued = true;
                work.ack((await work.value(Reflect.apply(commit, open, []))).value); tx.commitAcknowledged = true;
                check(live);
                if (!same(await read(open, live, true), desired)) stop();
                known = desired; identityRevision += 1;
                check(live); success = true; return { ok: true as const };
              } catch (reason) {
                // Invalidate before draining malformed work or awaiting rollback.
                if (reason !== cancelled) sourceFailed();
                await work.finish(); // End acquired statement/metadata work before cleanup I/O.
                if (tx.beginAcknowledged && !tx.commitIssued && open && cleanupRollback) {
                  tx.rollbackIssued = true;
                  try { work.ack((await work.value(Reflect.apply(cleanupRollback, open, []))).value); tx.rollbackAcknowledged = true; } catch { sourceFailed(); }
                  await work.finish();
                }
                if (tx.beginIssued && !tx.commitAcknowledged && !tx.rollbackAcknowledged) sourceFailed();
                if (tx.beginIssued && !success && reason !== cancelled) core.phase();
                return mutationFailed();
              } finally {
                nativeRuntimeEvidence(session, "domain", { operation: kind, issued: tx.statementIssued, acknowledged: tx.commitAcknowledged, verified: success, controlReadIssued: runtimeReads !== readsBefore, transaction: tx, outcome: success ? "success" : tx.beginIssued || runtimeReads !== readsBefore ? "unverified" : "refused" });
              }
            }, mutationFailed, sourceAwareMode ? () => { pendingMutations--; } : undefined);
          }
          let closing: Promise<object | null> | null = null;
          const draft: NativeRuntimeDomainDraft = Object.freeze({
            ready, activate: () => { runtimeRole = "runtime"; }, abandon: () => { if (runtimeRole === "prepared") { runtimeRole = "migration"; runtimeSession = null; runtimeSchemaVersion = null; } },
            adapter: Object.freeze({ get, set: (key: string, value: string) => mutate("write", key, value) as Promise<PersistenceWriteResult>, remove: (key: string) => mutate("remove", key) as Promise<PersistenceRemoveResult> }),
            anchor: () => {
              if (!admitQueued()) return Promise.resolve(null);
              return runtimeTask(async () => {
                try { await controls(); check(live); const token = Object.freeze({}); anchors.add(token); return token; }
                catch (reason) { if (reason !== cancelled) sourceFailed(); return null; }
              }, () => null);
            },
            anchorCurrent: (token: object) => anchors.has(token) && live(),
            close: () => {
              runtimeRole = "closed";
              if (closing) return closing;
              const queued = core.enqueue(async () => {
                // Cleanup-only observation cannot poison otherwise healthy data.
                work = createQuarantineWork(value => value === queued || value === returned || owned(value));
                try {
                  if (!lease || !(await core.release(lease, true)).ok) return null;
                  return cleanupReceipt ??= Object.freeze({});
                } catch { return null; }
                finally { await work.finish(); }
              });
              const returned = queued.catch(() => null).finally(() => { closing = null; });
              if (sourceAwareMode) {
                registerTransferRuntimeCompletion(session, queued);
                registerTransferRuntimeCompletion(session, returned);
              }
              closing = returned; return returned;
            },
            releaseReady: (receipt: object) => runtimeRole === "closed" && cleanupReceipt === receipt && !!lease && !fault && !publicationPlan && core.retireReady(lease),
            retire: (receipt: object) => { if (draft.releaseReady(receipt) && lease) { core.retire(lease); lease = null; runtimeRole = "retired"; } },
          });
          return draft;
        } catch { return null; }
        finally { await work.finish(); }
      });
      return sourceCompletion(whole);
    }
    type PublishedCandidate = Readonly<{ before: RecordState; version: number; current(): boolean }>;
    const publishedCandidates = new WeakMap<object, PublishedCandidate>();
    let acceptedPublishedBinding: object | null = null;
    let acceptedPublishedOrigin: PublishedCandidate | null = null;
    const coldCurrent = (proceed: () => boolean) => publishedMode && !publishedConsumed && !publishedClosing && !fault && !unresolved && !outcome && runtimeRole === "migration" && proceed() === true;
    function candidateRecord(value: unknown): PublishedCandidate | null {
      const found = value !== null && typeof value === "object" ? publishedCandidates.get(value) : null;
      try { return found?.current() === true ? found : null; } catch { return null; }
    }
    function publishedCandidate(proceed: () => boolean): Promise<object | null> {
      let token: object | null = null;
      return publicationTask(async () => {
        const current = () => coldCurrent(proceed);
        if (!current() || !await reserve() || !current()) return null;
        const before = await observe(current);
        if (!before?.publication || !before.rows || !before.sourceDenial || before.identity === null || observedSchemaVersion === null || !current()) return null;
        if (publishedVersion !== null && publishedVersion !== observedSchemaVersion) stop();
        publishedVersion = observedSchemaVersion;
        const version = publishedVersion;
        token = Object.freeze(Object.create(null)) as object;
        publishedCandidates.set(token, Object.freeze({ before, version,
          current: () => coldCurrent(proceed) && !!lease && core.leaseCurrent(lease, false) && publishedVersion === version && same(known, before) }));
        return token;
      }, null, undefined, result => result && candidateRecord(result) ? result : null);
    }
    function publishedCandidatePayload(value: unknown): Readonly<{ q: PublishedQ; manifest: string }> | null {
      const candidate = candidateRecord(value), pair = candidate?.before.pair;
      const parsed = pair && readTransferPair(pair.intentQ, pair.manifest, pair.boundQ);
      if (!parsed?.bound || !pair) return null;
      return Object.freeze({ q: Object.freeze({ ...parsed.bound, initialEntryKeys: Object.freeze([...parsed.bound.initialEntryKeys]), verifiedItemIds: Object.freeze([...parsed.bound.verifiedItemIds]) }) as PublishedQ, manifest: pair.manifest });
    }
    function verifyPublishedBinding(token: unknown, value: unknown): Promise<object | null> {
      let verified: Readonly<{ candidate: PublishedCandidate; anchor: PublicationAnchor; source: NonNullable<ReturnType<typeof parseTransferSourceDenial>> }> | null = null;
      return publicationTask(async () => {
        const candidate = candidateRecord(token); if (!candidate) return null;
        const current = () => candidate.current();
        const before = await observe(current);
        if (!before?.publication || !same(before, candidate.before) || !current()) return null;
        const physical = publicationObservation(before, value), anchor = physical?.anchor;
        if (!physical) return null;
        if (!anchor || physical.raw !== before.publication.raw) stop();
        const source = parseTransferSourceDenial(before.sourceDenial!.ascii, before.digest);
        if (!source || !sourceAllows(before, anchor!.accountScopeId, anchor!.selectedProfileId)) stop();
        // This separate path authenticates cold static evidence with an actual
        // protected observation. It never sets original archive/source flags.
        const rows = before.rows && preparedRowsJson(before.rows); if (rows === null || rows === undefined) return null;
        const wire = await hashPublicationValue("wire", [before.wire], owned, current); if (!wire || !current()) return null;
        const prepared = await hashPublicationValue("prepared", [before.digest, rows], owned, current); if (!prepared || !current()) return null;
        const sourceHash = await hashPublicationValue("source", [before.digest, before.sourceDenial!.ascii], owned, current); if (!sourceHash || !current()) return null;
        const anchorHash = await hashPublicationValue("anchor", [before.publication.raw], owned, current); if (!anchorHash || !current()) return null;
        if (sourceHash !== before.sourceDenial!.digest || anchorHash !== before.publication.digest || publicationRaw(before, anchor!.publicationId, anchor!.accountScopeId, anchor!.selectedProfileId, anchor!.controlRevision, { wire, prepared }) !== before.publication.raw) stop();
        // A held hash is not a fresh SQL observation. Re-read the entire static
        // evidence against the first pin, never mutable live training rows.
        const after = await observe(current);
        if (!after || !same(after, candidate.before) || observedSchemaVersion !== candidate.version || !current() || !publicationObservation(after, value)) stop();
        verified = Object.freeze({ candidate, anchor: anchor!, source: source! });
        return token as object;
      }, null, undefined, result => {
        if (!result || !verified || !verified.candidate.current()) return null;
        const before = verified.candidate.before, observed = publicationObservation(before, value);
        if (!observed || observed.raw !== before.publication!.raw) return null;
        const binding = recordPublishedInstallationBinding({ context: publishedContextIdentity, raw: before.publication!.raw,
          anchorDigest: before.publication!.digest, anchor: verified.anchor, source: verified.source,
          schema: verified.candidate.version, current: verified.candidate.current });
        if (binding) { acceptedPublishedBinding = binding; acceptedPublishedOrigin = verified.candidate; }
        return binding;
      });
    }
    // One-way consumption of a genuine cold binding. Old identity/source drafts
    // retain their existing role transition; this closed path never re-enters it.
    function preparePublishedRuntime(binding: unknown, session: NativeRuntimeSession, ownerCurrent: () => boolean): Promise<NativeRuntimeDomainDraft | null> {
      let draft: NativeRuntimeDomainDraft | null = null, origin: PublishedCandidate | null = null;
      const sameStatic = (a: RecordState | null, b: RecordState) => !!a && a.wire === b.wire && a.digest === b.digest && sameRows(a.rows, b.rows) && samePair(a.pair, b.pair) && sameSource(a.sourceDenial, b.sourceDenial) && !!a.publication && !!b.publication && a.publication.raw === b.publication.raw && a.publication.digest === b.publication.digest;
      const failed = () => { fault = true; nativeRuntimeFailed(session, "domain"); };
      const usable = () => publishedMode && publishedConsumed && !publishedClosing && !fault && !unresolved && !outcome && runtimeSession === session && !!lease && core.leaseCurrent(lease, true) && !!origin && sameStatic(known, origin.before) && runtimeSchemaVersion === origin.version && ownerCurrent() === true;
      const ready = () => runtimeRole === "prepared" && usable() && nativeRuntimeCurrent(session, "domain", true);
      const live = () => runtimeRole === "runtime" && usable() && nativeRuntimeCurrent(session, "domain");
      const error = () => ({ kind: "storage_unavailable" as const });
      const readFailed = (): StorageGetResult => ({ status: "read_failed", fallback: null, error: error() });
      const mutationFailed = (): PersistenceWriteResult & PersistenceRemoveResult => ({ ok: false, error: error() });
      const keyFamily = (key: unknown): "identity" | "live" | null => typeof key !== "string" ? null : identityKey(key as unknown) ? "identity" : ["curling.identity.", "curling.nativeMigration.", "curling.credential", "curling.installationTransfer.", "sb-"].some(prefix => key.startsWith(prefix)) ? null : "live";
      function runtimeTask<T>(operation: () => Promise<T>, failure: () => T, note?: (result: T) => void): Promise<T> {
        const queued = core.enqueue(async () => {
          work = createQuarantineWork(value => value === queued || value === returned || owned(value), failed);
          let result: T;
          try { result = await operation(); }
          catch (reason) { if (reason !== cancelled) failed(); result = failure(); }
          finally { await work.finish(); }
          // Acquired method/descriptor work can close this owner during drain.
          // Renew authority before publishing any data, ACK or storage anchor.
          if (!live()) result = failure();
          note?.(result); return result;
        });
        sourceCompletion(queued);
        const returned = queued.catch(() => { failed(); return failure(); });
        return sourceCompletion(returned);
      }
      async function controls(): Promise<{ open: NativeSqliteConnection; before: RecordState }> {
        check(live); const open = (await core.openBoxed(live)).connection; check(live);
        const before = await read(open, live); check(live);
        if (!before || !origin || !sameStatic(before, origin.before) || before.identity === null || observedSchemaVersion !== origin.version) stop();
        return { open, before: before! };
      }
      async function addressed(open: NativeSqliteConnection, key: string): Promise<string | null> {
        const query = sourceMethod(open, "query", live); check(live); runtimeReads++;
        const value = await work.value(Reflect.apply(query, open, ["SELECT value_ascii FROM installation_transfer_live_v1 WHERE key=?;", [key]])); check(live);
        const rows = work.rows(value.value, ["value_ascii"], 1, (_name, raw) => { if (!isPublishedLiveCodeUnits(raw)) { failed(); throw null; } });
        return rows.length ? rows[0].value_ascii as string : null;
      }
      function get(key: string): Promise<StorageGetResult> {
        const family = keyFamily(key); if (!family || !live()) return Promise.resolve(readFailed());
        let reads = runtimeReads;
        return runtimeTask(async () => {
          reads = runtimeReads;
          try {
            const { open, before } = await controls();
            const ascii = family === "identity" ? before.identity!.find(row => row.key === key)?.ascii ?? null : await addressed(open, key);
            check(live);
            const value = ascii === null ? null : family === "identity" ? decodeTransferCodeUnits(ascii) : decodePublishedLiveCodeUnits(ascii);
            check(live); return { status: "value" as const, value };
          } catch (reason) { if (reason !== cancelled) failed(); return readFailed(); }
        }, readFailed, result => {
          const success = result.status === "value";
          nativeRuntimeEvidence(session, "domain", { operation: "read", issued: runtimeReads !== reads, acknowledged: success, verified: success, outcome: success ? "success" : runtimeReads !== reads ? "unverified" : "refused" });
        });
      }
      function mutate(kind: "write" | "remove", key: string, value?: string): Promise<PersistenceWriteResult | PersistenceRemoveResult> {
        const family = keyFamily(key);
        if (!family || !live() || kind === "write" && (typeof value !== "string" || family === "identity" && value.length > 1048576)) return Promise.resolve(mutationFailed());
        let encoded: string | null;
        try { encoded = kind === "remove" ? null : family === "identity" ? encodeTransferCodeUnits(value) : encodePublishedLiveCodeUnits(value!); }
        catch { return Promise.resolve(mutationFailed()); }
        const project = (before: RecordState): RecordState | null => {
          if (family === "live") return before;
          const identity = before.identity!.filter(row => row.key !== key);
          if (encoded !== null) identity.push({ key, ascii: encoded });
          identity.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
          return identity.length <= 4096 && identity.reduce((total, row) => total + (row.ascii.length - 4) / 4, 0) <= 4194304 ? { ...before, identity } : null;
        };
        // Input/capacity refusal performs no native work and does not fault a store.
        if (!known?.identity || !project(known)) return Promise.resolve(mutationFailed());
        const tx = { beginIssued: false, beginAcknowledged: false, statementIssued: false, statementAcknowledged: false, commitIssued: false, commitAcknowledged: false, rollbackIssued: false, rollbackAcknowledged: false };
        let reads = runtimeReads, success = false;
        return runtimeTask(async () => {
          reads = runtimeReads;
          let open: NativeSqliteConnection | null = null, rollback: (() => unknown) | null = null;
          try {
            const observed = await controls(); open = observed.open;
            const before = observed.before, desired = project(before); if (!desired) return mutationFailed();
            const previous = family === "identity" ? before.identity!.find(row => row.key === key)?.ascii ?? null : await addressed(open, key);
            if (kind === "remove" && previous === null) { check(live); success = true; return { ok: true as const }; }
            const begin = sourceMethod(open, "beginTransaction", live), run = sourceMethod(open, "run", live), commit = sourceMethod(open, "commitTransaction", live), rollbackCall = sourceMethod(open, "rollbackTransaction", live);
            const receiver = open; rollback = () => Reflect.apply(rollbackCall, receiver, []);
            check(live); tx.beginIssued = true;
            work.ack((await work.value(Reflect.apply(begin, open, []))).value); tx.beginAcknowledged = true; check(live);
            if (!same(await read(open, live), before)) stop();
            if (family === "live" && await addressed(open, key) !== previous) { failed(); throw null; }
            const table = family === "identity" ? "installation_transfer_identity_v1" : "installation_transfer_live_v1";
            const sql = kind === "remove" ? `DELETE FROM ${table} WHERE key=? AND value_ascii=?` : previous === null ? `INSERT INTO ${table} (key,value_ascii) VALUES (?,?)` : `UPDATE ${table} SET value_ascii=? WHERE key=? AND value_ascii=?`;
            const values = kind === "remove" ? [key, previous] : previous === null ? [key, encoded] : [encoded, key, previous];
            check(live); tx.statementIssued = true;
            work.mutationAck((await work.value(Reflect.apply(run, open, [sql, values, false]))).value, 1); tx.statementAcknowledged = true; check(live);
            if (!same(await read(open, live, true), desired)) stop();
            if (family === "live" && await addressed(open, key) !== encoded) { failed(); throw null; }
            check(live); tx.commitIssued = true;
            work.ack((await work.value(Reflect.apply(commit, open, []))).value); tx.commitAcknowledged = true; check(live);
            // Normal writes use the original connection. Reopening here would
            // rotate a live storage anchor while credential work legitimately waits.
            if (!same(await read(open, live, true), desired)) stop();
            if (family === "live" && await addressed(open, key) !== encoded) { failed(); throw null; }
            check(live); known = desired; if (family === "identity") identityRevision++;
            success = true; return { ok: true as const };
          } catch (reason) {
            if (reason !== cancelled) failed();
            await work.finish();
            if (tx.beginAcknowledged && !tx.commitIssued && rollback) {
              tx.rollbackIssued = true;
              try { work.ack((await work.value(rollback())).value); tx.rollbackAcknowledged = true; } catch { failed(); }
              await work.finish();
            }
            if (tx.beginIssued && !tx.commitAcknowledged && !tx.rollbackAcknowledged) failed();
            if (tx.beginIssued && !success && reason !== cancelled) core.phase();
            return mutationFailed();
          }
        }, mutationFailed, result => {
          success = result.ok === true;
          nativeRuntimeEvidence(session, "domain", { operation: kind, issued: tx.statementIssued, acknowledged: tx.commitAcknowledged, verified: success, controlReadIssued: runtimeReads !== reads, transaction: tx, outcome: success ? "success" : tx.beginIssued || runtimeReads !== reads ? "unverified" : "refused" });
        });
      }
      const anchors = new WeakSet<object>(); let closing: Promise<object | null> | null = null;
      const actual = () => context as unknown as NativePublishedInstallationContext;
      return publicationTask(async () => {
        const facts = readPublishedInstallationBinding(binding);
        origin = acceptedPublishedOrigin;
        if (!publishedMode || publishedConsumed || publishedClosing || binding !== acceptedPublishedBinding || facts?.context !== publishedContextIdentity || !origin?.current() || !nativeRuntimeCurrent(session, "domain", true) || !ownerCurrent() || !lease || !core.leaseCurrent(lease, true)) return null;
        const current = () => !publishedConsumed && !publishedClosing && !fault && origin!.current() && nativeRuntimeCurrent(session, "domain", true) && ownerCurrent() === true;
        try {
          const before = await observe(current);
          if (!before || !same(before, origin.before) || observedSchemaVersion !== origin.version || !current()) return null;
        } catch (reason) { if (reason !== cancelled) { failed(); } throw reason; }
        draft = Object.freeze({
          ready, activate: () => { if (ready()) runtimeRole = "runtime"; },
          abandon: () => { if (runtimeRole === "prepared" && runtimeSession === session) { publishedClosing = true; runtimeRole = "closed"; } },
          adapter: Object.freeze({ get, set: (key: string, value: string) => mutate("write", key, value) as Promise<PersistenceWriteResult>, remove: (key: string) => mutate("remove", key) as Promise<PersistenceRemoveResult> }),
          anchor: () => !live() ? Promise.resolve(null) : runtimeTask(async () => { await controls(); check(live); const token = Object.freeze(Object.create(null)) as object; anchors.add(token); return token; }, () => null),
          anchorCurrent: (token: object) => anchors.has(token) && live(),
          close: () => {
            publishedClosing = true; runtimeRole = "closed";
            if (closing) return closing;
            const queued = actual().cleanup();
            const returned = queued.finally(() => { closing = null; });
            closing = sourceCompletion(returned); return closing;
          },
          releaseReady: (receipt: object) => runtimeRole === "closed" && nativeRuntimeStorageHealthy(session) && actual().releaseReady(receipt),
          retire: (receipt: object) => { if (runtimeRole === "closed" && nativeRuntimeStorageHealthy(session) && actual().releaseReady(receipt)) { actual().retire(receipt); runtimeRole = "retired"; } },
        });
        return draft;
      }, null, undefined, result => {
        if (!result || !origin?.current() || publishedConsumed || publishedClosing || fault || !nativeRuntimeCurrent(session, "domain", true) || !ownerCurrent()) return null;
        // No await/callback follows this consume. Abandon can only close it.
        publishedConsumed = true; runtimeSession = session; runtimeSchemaVersion = origin.version; runtimeRole = "prepared";
        return result;
      });
    }

    const context: NativeTransferQuarantineContext = Object.freeze({
      inspect: (proceed: () => boolean) => task(async () => {
        if (fault) return "fault_held";
        if (unresolved) return "outcome_unresolved";
        if (!await reserve()) return "unavailable";
        const observed = await observe(proceed);
        if (observed?.pair) return observed.pair.boundQ === null ? "pair_intent_unverified" : "paired_unverified";
        return observed?.rows !== null && observed !== null ? preparedAuthenticated ? "prepared" : "prepared_unverified" : observed ? authenticated ? "quarantined" : "quarantined_unverified" : "empty";
      }),
      stage: (wire: string, digest: string, proceed: () => boolean) => task(async () => {
        if (fault) return "fault_held";
        if (unresolved) return "outcome_unresolved";
        if (!await reserve()) return "unavailable";
        const before = await observe(proceed);
        const desired: RecordState = { wire, digest, rows: null, pair: null, identity: null, sourceDenial: null, publication: null };
        if (before) {
          if (!sameArchive(before, wire, digest)) return "target_conflict";
          authenticated = true; return "already_quarantined";
        }
        return transact(before, desired, proceed, "quarantined", async open => {
          check(proceed); work.ack((await work.value(open.execute(ddl, false))).value); check(proceed);
          work.ack((await work.value(open.run("INSERT INTO installation_transfer_quarantine_v1 (singleton,protected_wire,package_digest) VALUES (1,?,?)", [wire, digest], false))).value, 1); check(proceed);
        });
      }),
      ...(preparationMode ? { prepare: (wire: string, digest: string, rows: readonly PreparedSportingRow[], proceed: () => boolean) => task(async () => {
        if (fault) return "fault_held";
        if (unresolved) return "outcome_unresolved";
        if (!await reserve()) return "unavailable";
        const before = await observe(proceed);
        if (!before || !sameArchive(before, wire, digest)) return "target_conflict";
        const desired: RecordState = { wire, digest, rows, pair: before.pair, identity: before.identity, sourceDenial: before.sourceDenial, publication: before.publication };
        if (before.rows !== null) {
          if (!same(before, desired)) return "target_conflict";
          preparedAuthenticated = true; return "already_prepared";
        }
        return transact(before, desired, proceed, "prepared", async open => {
          for (const statement of [preparedDdl, sportingDdl]) {
            check(proceed); work.ack((await work.value(open.execute(statement, false))).value); check(proceed);
          }
          for (let slot = 0; slot < rows.length; slot++) {
            const row = rows[slot]; check(proceed);
            work.ack((await work.value(open.run("INSERT INTO installation_transfer_sporting_v1 (slot,key,value_ascii,value_digest) VALUES (?,?,?,?)", [slot, row.key, row.ascii, row.digest], false))).value, 1, slot); check(proceed);
          }
          check(proceed); work.ack((await work.value(open.run("INSERT INTO installation_transfer_prepared_v1 (singleton,package_digest,row_count) VALUES (1,?,?)", [digest, rows.length], false))).value, 1); check(proceed);
        });
      }) } : {}),
      ...(pairingMode ? {
        pairing: (proceed: () => boolean) => {
          const whole = (async () => {
            let pair: TransferPairState | null = null, identity = false;
            const code = await task(async () => {
              if (fault) return "fault_held";
              if (unresolved) return "outcome_unresolved";
              if (!await reserve()) return "unavailable";
              const before = await observe(proceed);
              if (!before || before.rows === null) return "target_conflict";
              pair = before.pair; identity = before.identity !== null;
              return pair ? pair.boundQ === null ? "pair_intent_unverified" : "paired_unverified" : "prepared_unverified";
            });
            return Object.freeze({ code, pair, identity });
          })();
          return sourceCompletion(whole);
        },
        intent: (pair: TransferPairState, proceed: () => boolean) => task(async () => {
          if (fault) return "fault_held";
          if (unresolved) return "outcome_unresolved";
          if (!await reserve()) return "unavailable";
          const before = await observe(proceed);
          if (!before || before.rows === null || before.pair || pair.boundQ !== null || !readTransferPair(pair.intentQ, pair.manifest)) return "target_conflict";
          const desired = { ...before, pair };
          return transact(before, desired, proceed, "pair_intent", async open => {
            check(proceed); work.ack((await work.value(open.execute(pairDdl, false))).value); check(proceed);
            work.ack((await work.value(open.run("INSERT INTO installation_transfer_pair_v1 (singleton,package_digest,intent_q,manifest) VALUES (1,?,?,?)", [before.digest, pair.intentQ, pair.manifest], false))).value, 1); check(proceed);
          });
        }),
        bind: (proceed: () => boolean) => task(async () => {
          if (fault) return "fault_held";
          if (unresolved) return "outcome_unresolved";
          if (!await reserve()) return "unavailable";
          const before = await observe(proceed);
          if (!before?.pair || before.pair.boundQ !== null) return "target_conflict";
          const boundQ = transferBoundQ(before.pair.intentQ, before.pair.manifest);
          if (!boundQ) return "target_conflict";
          const desired = { ...before, pair: Object.freeze({ ...before.pair, boundQ }) };
          return transact(before, desired, proceed, "paired", async open => {
            check(proceed); work.ack((await work.value(open.execute(bindingDdl, false))).value); check(proceed);
            work.ack((await work.value(open.run("INSERT INTO installation_transfer_binding_v1 (singleton,package_digest,bound_q) VALUES (1,?,?)", [before.digest, boundQ], false))).value, 1); check(proceed);
          });
        }),
        cleanup: () => {
          if (publishedMode) publishedClosing = true;
          const queued = core.enqueue(async () => {
            work = createQuarantineWork(value => value === queued || value === whole || owned(value));
            try {
              // Acquisition is pure core ownership and precedes every native open.
              // No published lease means this facade issued no native store work.
              if (!lease) return publishedMode && !fault ? cleanupReceipt ??= Object.freeze({}) : null;
              if (outcome) { await settleOutcome(); if (outcome) return null; }
              const released = await core.release(lease, true);
              if (!released.ok) return null;
              return cleanupReceipt ??= Object.freeze({});
            } catch { return null; }
            finally { await work.finish(); }
          });
          sourceCompletion(queued);
          const whole = queued.catch(() => null);
          return sourceCompletion(whole);
        },
        releaseReady: (receipt: object) => !fault && !unresolved && !outcome && cleanupReceipt === receipt && (lease ? core.retireReady(lease) : publishedMode && publishedClosing),
        retire: (receipt: object) => {
          if (lease && !fault && !unresolved && !outcome && cleanupReceipt === receipt && core.retireReady(lease)) { core.retire(lease); lease = null; }
        },
      } : {}),
      ...(identityMode ? {
        initializeIdentity: (proceed: () => boolean) => task(async () => {
          if (fault || runtimeRole !== "migration") return "fault_held";
          if (unresolved) return "outcome_unresolved";
          const before = await observe(proceed);
          if (!before?.pair?.boundQ) return "target_conflict";
          if (before.identity !== null) return "paired";
          return transact(before, { ...before, identity: [] }, proceed, "paired", async open => {
            check(proceed); work.ack((await work.value(open.execute(identityDdl, false))).value); check(proceed);
          });
        }),
        ...(sourceAwareMode ? {
          bindFreshEmailOtpSource: (source: unknown) => {
            if (!isNativeFreshEmailOtpSource(source) || !sourceReady() || freshSource !== null && freshSource !== source) return false;
            freshSource = source; return true;
          },
          pinFreshEmailOtp, freshEmailOtpCurrent, pinAccountControl, accountControlCurrent,
          verifyPublicationIntent, preparePublication, publicationDraftPayload, acceptPublicationAnchor, publishPrepared,
          initializeSourceDenial: (handle: unknown, proceed: () => boolean) => task(async () => {
          if (fault || runtimeRole !== "migration") return "fault_held";
          if (unresolved) return "outcome_unresolved";
          const projection = resolveTransferSourceDenial(handle);
          if (!projection) return "target_conflict";
          const before = await observe(proceed);
          if (!before?.pair?.boundQ || before.identity === null || before.digest !== projection.packageDigest) return "target_conflict";
          const sourceDenial = Object.freeze({ packageDigest: projection.packageDigest, ascii: projection.ascii, digest: projection.digest });
          if (before.sourceDenial !== null) {
            if (!sameSource(before.sourceDenial, sourceDenial)) stop();
            check(proceed); sourceVerified = true; return "paired";
          }
          const result = await transact(before, { ...before, sourceDenial }, proceed, "paired", async open => {
            check(proceed); work.ack((await work.value(open.execute(sourceDenialDdl, false))).value); check(proceed);
            work.ack((await work.value(open.run("INSERT INTO installation_transfer_source_denial_v1 (singleton,package_digest,projection_ascii,projection_digest) VALUES (1,?,?,?)", [before.digest, sourceDenial.ascii, sourceDenial.digest], false))).value, 1); check(proceed);
          });
          if (result === "paired" && proceed()) sourceVerified = true;
          return result;
        }) } : {}),
        prepareIdentityRuntime: prepareRuntime,
      } : {}),
      ...(publishedMode ? {
        candidate: publishedCandidate, candidatePayload: publishedCandidatePayload, verifyBinding: verifyPublishedBinding, preparePublishedRuntime,
        bindingCurrent: (value: unknown) => { const binding = readPublishedInstallationBinding(value); return value === acceptedPublishedBinding && binding?.context === publishedContextIdentity; },
        ownsCompletion: (value: unknown) => value !== null && (typeof value === "object" || typeof value === "function") && publicationCompletions.has(value),
        health: () => fault ? "failed" as const : "healthy" as const,
      } : {}),
      close: () => task(async () => {
        if (!lease) return "closed";
        if (outcome) { await settleOutcome(); if (outcome) return "cleanup_held"; }
        const released = await core.release(lease, fault);
        if (!released.ok) return "cleanup_held";
        if (fault) return "fault_held";
        lease = null; return "closed";
      }),
    });
    return { context,
      ...(sourceAwareMode ? {
        openConnection: async (open: NativeSqliteConnection, proceed: () => boolean) => {
          try {
            const method = sourceMethod(open, "open", proceed);
            const result = await work.value(Reflect.apply(method, open, []));
            if (result.value !== undefined) stop();
            check(proceed);
          } catch (reason) { if (publishedMode && reason !== cancelled) fault = true; await work.finish(); throw null; }
        },
        createConnection: async (engine: import("./nativeSqliteAdapter").NativeSqliteEngine, databaseName: string, proceed: () => boolean) => {
          try {
            check(proceed);
            const container = await work.value(engine);
            if (container.value !== engine) stop();
            const method = sourceMethod(engine, "createConnection", proceed);
            const result = await work.value(Reflect.apply(method, engine, [databaseName]));
            if (!result.value || typeof result.value !== "object") stop();
            // Core stores this positive connection before its cancellation check.
            return Object.freeze(Object.assign(Object.create(null), { connection: result.value as NativeSqliteConnection }));
          } catch (reason) { if (publishedMode && reason !== cancelled) fault = true; await work.finish(); throw null; }
        },
        configureConnection: async (open: NativeSqliteConnection, proceed: () => boolean, journalSql: string, synchronousSql: string) => {
          try {
            const query = sourceMethod(open, "query", proceed);
            const execute = sourceMethod(open, "execute", proceed);
            check(proceed);
            const result = await work.value(Reflect.apply(query, open, [journalSql, []]));
            const rows = work.rows(result.value, ["journal_mode"], 1, (_field, value) => { if (value !== "wal") stop(); });
            if (rows.length !== 1) stop();
            check(proceed); work.ack((await work.value(Reflect.apply(execute, open, [synchronousSql, false]))).value); check(proceed);
          } catch (reason) { if (publishedMode && reason !== cancelled) fault = true; await work.finish(); throw null; }
        },
      } : {}),
      cleanupEvidence: values => { if (runtimeSession) nativeRuntimeCleanup(runtimeSession, values); },
      settleVoid: async input => {
        try { return (await work.value(input)).value === undefined; }
        catch { return false; }
        finally { await work.finish(); }
      },
      discover: async (open, proceed) => {
      const observed = await read(open, proceed);
      if (outcome && !outcome.observed) { outcome.readback = observed; outcome.observed = true; }
      if (observed && !publicationPlan) known = observed; // Complete durable discovery, never the owned uncommitted preparation.
    } };
  };
  return createNativeTransferQuarantineContext(options, install);
}
