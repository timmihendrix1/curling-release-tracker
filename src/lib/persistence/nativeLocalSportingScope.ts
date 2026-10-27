// Dormant S5g. Only the genuine private native host composes this typed boundary.
// No adapter, SDK, admission or generic runner is returned to application callers.
import {
  createProfileScopedSportingRepositories, createProfileScopedSportingStorageAdapter,
  PROFILE_SCOPED_SPORTING_STORAGE_KEYS, SPORTING_STORAGE_KEYS,
  profileScopedSportingStorageKey, LEGACY_SPORTING_RETIREMENT_MARKER_KEY,
  retireLegacyUnscopedSportingData, readProfileSportingExport,
  type SportingRepositories, type LegacySportingRetirementResult,
} from "./profileScopedSportingPersistence";
import { createSportingSyncStateRepository, type SportingSyncStateRepository } from "../cloudSporting/syncStateRepository";
import { captureNativeSportingArguments, type NativeSportingInput } from "./nativeSportingDataCapture";
import { CURRENT_SESSION_STORAGE_KEY, SESSION_HISTORY_STORAGE_KEY } from "../sessionRepository";
import type { RemovableStorageAdapter, StorageGetResult, PersistenceWriteResult, PersistenceRemoveResult } from "./types";

export type NativeLocalSportingScope = Readonly<{
  repositories: SportingRepositories;
  syncState: SportingSyncStateRepository;
  retireLegacyUnscopedData(): Promise<LegacySportingRetirementResult>;
  readPersonalExport(): ReturnType<typeof readProfileSportingExport>;
}>;
type Owner = Readonly<{
  profileId: string;
  adapter: RemovableStorageAdapter;
  current(): boolean;
  register(work: Promise<unknown>): void;
  isOwnDisposal(value: unknown): boolean;
  onSessionWriteAcknowledged?(slot: "current" | "history"): void;
}>;
const apply = Reflect.apply, then = Promise.prototype.then;
const error = () => ({ kind: "storage_unavailable" as const });
const readFailed = (): StorageGetResult => ({ status: "read_failed", fallback: null, error: error() });
const writeFailed = (): PersistenceWriteResult => ({ ok: false, error: error() });
const removeFailed = (): PersistenceRemoveResult => ({ ok: false, error: error() });
const refusal: RemovableStorageAdapter = Object.freeze({ get: async () => readFailed(), set: async () => writeFailed(), remove: async () => removeFailed() });
type Input = NativeSportingInput;
type Kind = "read" | "write" | "archive" | "retire" | "export";
type Operation = (adapter: RemovableStorageAdapter, args: unknown[]) => Promise<unknown>;
type Call = { valid: boolean; pending: Promise<unknown>[]; issued: Promise<unknown>[]; historyAcknowledged: boolean };

export function createNativeLocalSportingScope(owner: Owner): NativeLocalSportingScope {
  const { profileId, adapter, current: scopeCurrent, register, isOwnDisposal } = owner;
  const scopedKeys = new Set<string>(PROFILE_SCOPED_SPORTING_STORAGE_KEYS.map(key => profileScopedSportingStorageKey(profileId, key)));
  const legacyKeys = new Set<string>(SPORTING_STORAGE_KEYS);
  const historyKey = profileScopedSportingStorageKey(profileId, SESSION_HISTORY_STORAGE_KEY);
  const currentKey = profileScopedSportingStorageKey(profileId, CURRENT_SESSION_STORAGE_KEY);
  function observe(value: unknown): Promise<unknown> {
    if (isOwnDisposal(value)) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      try { apply(then, value, [resolve, reject]); }
      catch { void new Promise<unknown>(done => done(value)).then(resolve, reject); }
    });
  }
  function retain(call: Call, value: unknown) {
    if (isOwnDisposal(value)) return;
    if ((typeof value === "object" && value !== null) || typeof value === "function") call.pending.push(observe(value).then(() => {}, () => {}));
  }
  function capture(call: Call, args: readonly unknown[], kinds: readonly Input[]): unknown[] {
    return captureNativeSportingArguments(args, kinds, {
      current: () => call.valid && scopeCurrent(), retire: () => { call.valid = false; },
      retain: value => retain(call, value), isOwnDisposal,
    });
  }

  function invoke(kind: Kind, inputs: readonly Input[], args: readonly unknown[], operation: Operation): Promise<unknown> {
    let finish!: (value: unknown) => void;
    const work = new Promise<unknown>(resolve => { finish = resolve; });
    register(work); // before foreign reflection, invocation and every actual I/O
    const call: Call = { valid: true, pending: [], issued: [], historyAcknowledged: false };
    const current = () => call.valid && scopeCurrent();
    let copied: unknown[] = [];
    try { if (!current()) call.valid = false; else copied = capture(call, args, inputs); }
    catch { call.valid = false; }
    function malformed(value: unknown) { call.valid = false; retain(call, value); }
    function io<T>(method: "get" | "set" | "remove", key: unknown, value: unknown, failed: () => T): Promise<T> {
      let settle!: (value: T) => void;
      const issued = new Promise<T>(resolve => { settle = resolve; });
      call.issued.push(issued); // before the underlying method can reenter close
      void (async () => {
        if (!current()) return failed();
        if (typeof key !== "string") { malformed(key); return failed(); }
        const allowed = kind === "retire"
          ? method === "get" ? key === LEGACY_SPORTING_RETIREMENT_MARKER_KEY : method === "remove" ? legacyKeys.has(key) : key === LEGACY_SPORTING_RETIREMENT_MARKER_KEY && value === "complete"
          : method !== "remove" && scopedKeys.has(key);
        if (!allowed) { malformed(key); return failed(); }
        if (method === "set" && typeof value !== "string") { malformed(value); return failed(); }
        if (!current()) return failed();
        let result: unknown;
        try { result = await observe(apply(adapter[method], adapter, method === "set" ? [key, value] : [key])); }
        catch { return failed(); }
        // An issued write's genuine ACK is a fact, not a further permission.
        if (method === "set" && (result as PersistenceWriteResult)?.ok === true) {
          if (key === historyKey) call.historyAcknowledged = true;
          // Private per-call source fact; never a returned application grant.
          if (key === historyKey || key === currentKey) owner.onSessionWriteAcknowledged?.(key === historyKey ? "history" : "current");
        }
        if (method === "get" && !current()) return failed();
        return result as T;
      })().then(settle, () => settle(failed()));
      return issued;
    }
    const guarded: RemovableStorageAdapter = Object.freeze<RemovableStorageAdapter>({
      get: key => io("get", key, undefined, readFailed),
      set: (key, value) => io("set", key, value, writeFailed),
      remove: key => io("remove", key, undefined, removeFailed),
    });
    async function fallback(): Promise<unknown> {
      if (kind === "write") return writeFailed();
      if (kind === "archive") return { ok: false, step: call.historyAcknowledged ? "current" : "history", error: error() };
      try { return await observe(operation(refusal, [])); }
      catch { return kind === "export" ? { ok: false } : kind === "retire" ? { ok: false, reason: "marker_read_failed" } : { status: "read_failed", fallback: null, error: error() }; }
    }
    const completion = (async () => {
      try {
        await Promise.all(call.pending);
        if (!current()) return await fallback();
        let result: unknown, mappingFailed = false;
        try { result = await observe(operation(guarded, copied)); }
        catch {
          // Retire this call before an issued sibling can resume its mapper.
          // Its eventual ACK remains a fact, but grants no successor I/O.
          call.valid = false;
          mappingFailed = true;
        }
        // Mapping may settle before siblings (e.g. Promise.all rejecting early).
        await Promise.all(call.issued);
        await Promise.all(call.pending);
        if (mappingFailed) return await fallback();
        if ((kind === "read" || kind === "export") && !current()) return await fallback();
        return result;
      } finally {
        call.valid = false;
        await Promise.all(call.issued);
        await Promise.all(call.pending);
      }
    })();
    void completion.then(finish, async () => { finish(await fallback()); });
    return work;
  }
  type Repo = keyof SportingRepositories;
  function base(name: Repo, method: string, kind: Kind, inputs: readonly Input[], args: readonly unknown[]): Promise<unknown> {
    return invoke(kind, inputs, args, async (target, values) => {
      const repositories = createProfileScopedSportingRepositories(profileId, target);
      const repository = repositories[name];
      return await observe(apply((repository as unknown as Record<string, (...args: unknown[]) => unknown>)[method], repository, values));
    });
  }
  const repositories: SportingRepositories = Object.freeze({
    session: Object.freeze<SportingRepositories["session"]>({
      loadCurrent: () => base("session", "loadCurrent", "read", [], []) as ReturnType<SportingRepositories["session"]["loadCurrent"]>,
      loadHistory: () => base("session", "loadHistory", "read", [], []) as ReturnType<SportingRepositories["session"]["loadHistory"]>,
      saveCurrent: value => base("session", "saveCurrent", "write", ["record"], [value]) as ReturnType<SportingRepositories["session"]["saveCurrent"]>,
      saveHistory: value => base("session", "saveHistory", "write", ["array"], [value]) as ReturnType<SportingRepositories["session"]["saveHistory"]>,
      archiveAndReplace: (history, replacement) => base("session", "archiveAndReplace", "archive", ["array", "record"], [history, replacement]) as ReturnType<SportingRepositories["session"]["archiveAndReplace"]>,
    }),
    historyFilters: Object.freeze<SportingRepositories["historyFilters"]>({ load: () => base("historyFilters", "load", "read", [], []) as ReturnType<SportingRepositories["historyFilters"]["load"]>, save: value => base("historyFilters", "save", "write", ["record"], [value]) as ReturnType<SportingRepositories["historyFilters"]["save"]> }),
    assessment: Object.freeze<SportingRepositories["assessment"]>({ loadState: () => base("assessment", "loadState", "read", [], []) as ReturnType<SportingRepositories["assessment"]["loadState"]>, saveState: value => base("assessment", "saveState", "write", ["record"], [value]) as ReturnType<SportingRepositories["assessment"]["saveState"]> }),
    trainingPlans: Object.freeze<SportingRepositories["trainingPlans"]>({ loadPlans: () => base("trainingPlans", "loadPlans", "read", [], []) as ReturnType<SportingRepositories["trainingPlans"]["loadPlans"]>, savePlans: value => base("trainingPlans", "savePlans", "write", ["array"], [value]) as ReturnType<SportingRepositories["trainingPlans"]["savePlans"]> }),
    accuracyToleranceProfiles: Object.freeze<SportingRepositories["accuracyToleranceProfiles"]>({ loadState: () => base("accuracyToleranceProfiles", "loadState", "read", [], []) as ReturnType<SportingRepositories["accuracyToleranceProfiles"]["loadState"]>, saveState: value => base("accuracyToleranceProfiles", "saveState", "write", ["record"], [value]) as ReturnType<SportingRepositories["accuracyToleranceProfiles"]["saveState"]> }),
    smartRandomProfiles: Object.freeze<SportingRepositories["smartRandomProfiles"]>({ loadState: () => base("smartRandomProfiles", "loadState", "read", [], []) as ReturnType<SportingRepositories["smartRandomProfiles"]["loadState"]>, saveState: value => base("smartRandomProfiles", "saveState", "write", ["record"], [value]) as ReturnType<SportingRepositories["smartRandomProfiles"]["saveState"]> }),
    assessmentPreferences: Object.freeze<SportingRepositories["assessmentPreferences"]>({
      getShowIntroduction: () => base("assessmentPreferences", "getShowIntroduction", "read", [], []) as ReturnType<SportingRepositories["assessmentPreferences"]["getShowIntroduction"]>,
      setShowIntroduction: value => base("assessmentPreferences", "setShowIntroduction", "write", ["boolean"], [value]) as ReturnType<SportingRepositories["assessmentPreferences"]["setShowIntroduction"]>,
      getLastThresholdPreset: () => base("assessmentPreferences", "getLastThresholdPreset", "read", [], []) as ReturnType<SportingRepositories["assessmentPreferences"]["getLastThresholdPreset"]>,
      setLastThresholdPreset: value => base("assessmentPreferences", "setLastThresholdPreset", "write", ["preset"], [value]) as ReturnType<SportingRepositories["assessmentPreferences"]["setLastThresholdPreset"]>,
      getLastCustomThreshold: () => base("assessmentPreferences", "getLastCustomThreshold", "read", [], []) as ReturnType<SportingRepositories["assessmentPreferences"]["getLastCustomThreshold"]>,
      setLastCustomThreshold: value => base("assessmentPreferences", "setLastCustomThreshold", "write", ["record"], [value]) as ReturnType<SportingRepositories["assessmentPreferences"]["setLastCustomThreshold"]>,
    }),
  });
  const syncOperation = (method: "load" | "save"): Operation => async (target, values) => {
    const repository = createSportingSyncStateRepository(createProfileScopedSportingStorageAdapter(profileId, target));
    return await observe(apply(repository[method], repository, values));
  };
  return Object.freeze({ repositories,
    syncState: Object.freeze<SportingSyncStateRepository>({ load: () => invoke("read", [], [], syncOperation("load")) as ReturnType<SportingSyncStateRepository["load"]>, save: value => invoke("write", ["record"], [value], syncOperation("save")) as ReturnType<SportingSyncStateRepository["save"]> }),
    retireLegacyUnscopedData: () => invoke("retire", [], [], target => retireLegacyUnscopedSportingData(target)) as Promise<LegacySportingRetirementResult>,
    readPersonalExport: () => invoke("export", [], [], target => readProfileSportingExport(profileId, createProfileScopedSportingStorageAdapter(profileId, target))) as ReturnType<typeof readProfileSportingExport>,
  });
}
