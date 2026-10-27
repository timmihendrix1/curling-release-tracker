// Dormant S5h: privately composed only by the genuine native sporting host.
import { createNativeLocalSportingScope, type NativeLocalSportingScope } from "./nativeLocalSportingScope";
import { captureNativeSportingArguments, type NativeSportingInput } from "./nativeSportingDataCapture";
import type { SportingRepositories } from "./profileScopedSportingPersistence";
import { SportingCloudSyncManager, type SportingSyncSnapshot, type TeamExercisePermissionUpdateOutcome, type TeamExercisePrivateNoteUpdateOutcome, type TeamExerciseResultMutationOutcome } from "../cloudSporting/syncManager";
import type { CloudSportingService } from "../cloudSporting/types";
import type { TeamExerciseCloudService } from "../cloudSporting/teamExerciseTypes";
import type { AthleteExerciseResult, ExerciseExecution } from "../exercises/executionTypes";
import type { Session } from "../../types";
import type { SessionRepository } from "../sessionRepository";
import type { TeamWorkspace } from "../team/teamService";

type Owner = Parameters<typeof createNativeLocalSportingScope>[0];
export type NativeSportingApplicationScope = Readonly<Pick<NativeLocalSportingScope, "repositories" | "retireLegacyUnscopedData" | "readPersonalExport"> & {
  sync: Readonly<{
    initialize(): Promise<void>;
    synchronize(): Promise<void>;
    retry(): Promise<void>;
    getSnapshot(): SportingSyncSnapshot;
    subscribe(listener: () => void): () => void;
    enqueueCompletedTeamExercise(execution: ExerciseExecution): Promise<boolean>;
    saveActiveTeamExerciseDraft(execution: ExerciseExecution): Promise<boolean>;
    finalizeActiveTeamExerciseDraft(execution: ExerciseExecution): Promise<boolean>;
    discardActiveTeamExerciseDraft(executionId: string): Promise<boolean>;
    refreshTeamExerciseEligibility(workspace: TeamWorkspace): Promise<boolean>;
    setMyTeamExerciseRecordingPermission(teamId: string, granted: boolean): Promise<TeamExercisePermissionUpdateOutcome>;
    refreshMyTeamExerciseResults(): Promise<boolean>;
    setMyTeamExercisePrivateNote(resultId: string, note: string | null): Promise<TeamExercisePrivateNoteUpdateOutcome>;
    reviseMyTeamExerciseResult(resultId: string, replacement: AthleteExerciseResult, revisionId: string, reason: string): Promise<TeamExerciseResultMutationOutcome>;
    voidMyTeamExerciseResult(resultId: string, revisionId: string, reason: string): Promise<TeamExerciseResultMutationOutcome>;
  }>;
}>;
type Repo = keyof SportingRepositories;
const methods: Readonly<Record<Repo, Readonly<Record<string, readonly NativeSportingInput[]>>>> = Object.freeze({
  session: { loadCurrent: [], loadHistory: [], saveCurrent: ["record"], saveHistory: ["array"], archiveAndReplace: ["array", "record"] },
  historyFilters: { load: [], save: ["record"] },
  assessment: { loadState: [], saveState: ["record"] },
  trainingPlans: { loadPlans: [], savePlans: ["array"] },
  accuracyToleranceProfiles: { loadState: [], saveState: ["record"] },
  smartRandomProfiles: { loadState: [], saveState: ["record"] },
  assessmentPreferences: { getShowIntroduction: [], setShowIntroduction: ["boolean"], getLastThresholdPreset: [], setLastThresholdPreset: ["preset"], getLastCustomThreshold: [], setLastCustomThreshold: ["record"] },
});
const apply = Reflect.apply, then = Promise.prototype.then;
type Call = { valid: boolean; pending: Promise<unknown>[]; issued: Promise<unknown>[]; baseObserved: boolean; baseResult: unknown; local: NativeLocalSportingScope | null };

export type NativeTrackerNormalSession = Readonly<{
  saveCurrent(value: Session, acknowledged: () => void): ReturnType<SessionRepository["saveCurrent"]>;
  saveHistory(value: Session[]): ReturnType<SessionRepository["saveHistory"]>;
  archiveAndReplace(history: Session[], replacement: Session, acknowledged: () => void): ReturnType<SessionRepository["archiveAndReplace"]>;
}>;
/** The lifecycle handle is held only by the host; only .scope reaches callers. */
export function createNativeSportingApplicationScope(owner: Owner, service: CloudSportingService, teamService: TeamExerciseCloudService): Readonly<{ scope: NativeSportingApplicationScope; retire(): void; trackerSession: NativeTrackerNormalSession; hasTeamDraft(): boolean }> {
  let retired = false, detach = () => {};
  const listeners = new Set<() => void>();
  function retire() { if (retired) return; retired = true; detach(); listeners.clear(); }
  function current(): boolean {
    if (retired) return false;
    let live = false;
    try { live = owner.current(); } catch { /* no infrastructure reason escapes */ }
    if (!live) retire();
    return live;
  }
  function observe(value: unknown): Promise<unknown> {
    if (owner.isOwnDisposal(value)) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      try { apply(then, value, [resolve, reject]); }
      catch { void new Promise<unknown>(done => done(value)).then(resolve, reject); }
    });
  }
  function retain(call: Call, value: unknown) {
    if (owner.isOwnDisposal(value)) return;
    if ((typeof value === "object" && value !== null) || typeof value === "function") call.pending.push(observe(value).then(() => {}, () => {}));
  }
  function captured(call: Call, args: readonly unknown[], inputs: readonly NativeSportingInput[]): unknown[] {
    return captureNativeSportingArguments(args, inputs, {
      current: () => call.valid && current(), retire: () => { call.valid = false; },
      retain: value => retain(call, value), isOwnDisposal: owner.isOwnDisposal,
    });
  }
  function callable(repositories: SportingRepositories, name: Repo, method: string) {
    return (repositories[name] as unknown as Record<string, (...args: unknown[]) => unknown>)[method];
  }
  const local = createNativeLocalSportingScope({ ...owner, current });
  const refused = createNativeLocalSportingScope({ ...owner, current: () => false });
  // This slot exists only around the synchronous decorator invocation. Every
  // started base call captures its own fixed owner before the slot is cleared;
  // a later manager lane cannot borrow it or an unrelated invocation.
  let invokingRepository: Call | null = null;
  const managerRepositories = {} as Record<Repo, Record<string, (...args: unknown[]) => unknown>>;
  for (const name of Object.keys(methods) as Repo[]) {
    managerRepositories[name] = {};
    for (const method of Object.keys(methods[name])) {
      managerRepositories[name][method] = (...args) => {
        const call = invokingRepository;
        const target = call?.local ?? local;
        const issued = observe(apply(callable(target.repositories, name, method), target.repositories[name], args));
        if (!call) return issued;
        const recorded = issued.then(value => { call.baseObserved = true; call.baseResult = value; return value; });
        call.issued.push(recorded.then(() => {}, () => {}));
        return recorded;
      };
    }
    Object.freeze(managerRepositories[name]);
  }
  Object.freeze(managerRepositories);
  const manager = new SportingCloudSyncManager(managerRepositories as unknown as SportingRepositories, local.syncState, service, undefined, teamService, owner.profileId, { current, register: work => owner.register(work) });
  const decorated = manager.decorateRepositories();
  const initial = manager.getSnapshot();
  function copySnapshot(value: SportingSyncSnapshot): SportingSyncSnapshot {
    // Actual manager DTOs are private data. Use the same descriptor copy so even
    // optional undefined fields retain their ordinary meaning.
    const call: Call = { valid: true, pending: [], issued: [], baseObserved: false, baseResult: undefined, local: null };
    let finish!: () => void;
    const work = new Promise<void>(resolve => { finish = resolve; }); owner.register(work);
    try {
      return captureNativeSportingArguments([value], ["record"], {
        current: () => call.valid, retire: () => { call.valid = false; }, retain: item => retain(call, item), isOwnDisposal: owner.isOwnDisposal,
      })[0] as SportingSyncSnapshot;
    } finally { void Promise.all(call.pending).then(finish, finish); }
  }
  function getSnapshot(): SportingSyncSnapshot { return copySnapshot(current() ? manager.getSnapshot() : initial); }
  detach = manager.subscribe(() => {
    for (const listener of [...listeners]) {
      if (!current()) break;
      if (!listeners.has(listener)) continue;
      let finish!: () => void;
      const delivery = new Promise<void>(resolve => { finish = resolve; }); owner.register(delivery);
      let returned: unknown;
      try { returned = apply(listener, undefined, []); }
      catch { finish(); continue; }
      // Do not join a reentrant listener into publish/the lane it can schedule on.
      void observe(returned).then(finish, finish);
    }
  });
  function subscribe(listener: () => void): () => void {
    if (!current()) return () => {};
    if (typeof listener !== "function") {
      let finish!: () => void; const pending = new Promise<void>(resolve => { finish = resolve; }); owner.register(pending);
      void observe(listener).then(finish, finish); return () => {};
    }
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }
  function invoke<T>(inputs: readonly NativeSportingInput[], args: readonly unknown[], operation: (args: unknown[], call: Call) => unknown, fallback: (call: Call) => T | Promise<T>, read = false): Promise<T> {
    let finish!: (value: T) => void;
    const work = new Promise<T>(resolve => { finish = resolve; }); owner.register(work);
    const call: Call = { valid: true, pending: [], issued: [], baseObserved: false, baseResult: undefined, local: null };
    let values: unknown[] = [];
    try { if (current()) values = captured(call, args, inputs); else call.valid = false; }
    catch { call.valid = false; }
    const completion = (async () => {
      try {
        await Promise.all(call.pending);
        if (!call.valid || !current()) return await fallback(call);
        let result: unknown, failed = false;
        try { result = await observe(operation(values, call)); }
        catch { call.valid = false; failed = true; }
        await Promise.all(call.issued); await Promise.all(call.pending);
        if (failed || (read && !current())) return await fallback(call);
        return result as T;
      } finally { call.valid = false; await Promise.all(call.issued); await Promise.all(call.pending); }
    })();
    void completion.then(finish, async () => { finish(await fallback(call)); });
    return work;
  }
  function repositoryCall(name: Repo, method: string, inputs: readonly NativeSportingInput[], args: readonly unknown[], read = false, acknowledged?: (slot: "current" | "history") => void): Promise<unknown> {
    return invoke(inputs, args, (values, call) => {
      call.local = createNativeLocalSportingScope({ ...owner, current: () => call.valid && current(), onSessionWriteAcknowledged: acknowledged });
      invokingRepository = call;
      try { return apply(callable(decorated, name, method), decorated[name], values); }
      finally { invokingRepository = null; }
    }, call => !read && call.baseObserved ? call.baseResult : observe(apply(callable(refused.repositories, name, method), refused.repositories[name], [])), read);
  }
  const repositories = {} as Record<Repo, Record<string, (...args: unknown[]) => unknown>>;
  for (const name of Object.keys(methods) as Repo[]) {
    repositories[name] = {};
    for (const [method, inputs] of Object.entries(methods[name])) {
      const read = inputs.length === 0;
      repositories[name][method] = (...args) => repositoryCall(name, method, inputs, args, read);
    }
    Object.freeze(repositories[name]);
  }
  Object.freeze(repositories);
  const action = <T>(method: keyof SportingCloudSyncManager, inputs: readonly NativeSportingInput[], args: readonly unknown[], map: (values: unknown[]) => unknown[], fallback: T): Promise<T> => invoke(inputs, args, values => apply(manager[method] as (...args: unknown[]) => unknown, manager, map(values)), () => fallback);
  const sync: NativeSportingApplicationScope["sync"] = Object.freeze({
    initialize: () => action("initialize", [], [], () => [], undefined),
    synchronize: () => action("synchronize", [], [], () => [], undefined),
    retry: () => action("retry", [], [], () => [], undefined), getSnapshot, subscribe,
    enqueueCompletedTeamExercise: execution => action("enqueueCompletedTeamExercise", ["record"], [execution], values => [values[0], owner.profileId], false),
    saveActiveTeamExerciseDraft: execution => action("saveActiveTeamExerciseDraft", ["record"], [execution], values => [values[0], owner.profileId], false),
    finalizeActiveTeamExerciseDraft: execution => action("finalizeActiveTeamExerciseDraft", ["record"], [execution], values => [values[0], owner.profileId], false),
    discardActiveTeamExerciseDraft: id => action("discardActiveTeamExerciseDraft", ["string"], [id], values => [values[0], owner.profileId], false),
    refreshTeamExerciseEligibility: workspace => action("refreshTeamExerciseEligibility", ["record"], [workspace], values => [values[0], owner.profileId], false),
    setMyTeamExerciseRecordingPermission: (id, granted) => action("setMyTeamExerciseRecordingPermission", ["string", "boolean"], [id, granted], values => [values[0], owner.profileId, values[1]], "failed" as TeamExercisePermissionUpdateOutcome),
    refreshMyTeamExerciseResults: () => action("refreshMyTeamExerciseResults", [], [], () => [], false),
    setMyTeamExercisePrivateNote: (id, note) => action("setMyTeamExercisePrivateNote", ["string", "nullable_string"], [id, note], values => [values[0], owner.profileId, values[1]], "failed" as TeamExercisePrivateNoteUpdateOutcome),
    reviseMyTeamExerciseResult: (id, replacement, revision, reason) => action("reviseMyTeamExerciseResult", ["string", "record", "string", "string"], [id, replacement, revision, reason], values => [values[0], owner.profileId, values[1], values[2], values[3]], "failed" as TeamExerciseResultMutationOutcome),
    voidMyTeamExerciseResult: (id, revision, reason) => action("voidMyTeamExerciseResult", ["string", "string", "string"], [id, revision, reason], values => [values[0], owner.profileId, values[1], values[2]], "failed" as TeamExerciseResultMutationOutcome),
  });
  const trackerSession: NativeTrackerNormalSession = Object.freeze({
    saveCurrent: (value, acknowledged) => repositoryCall("session", "saveCurrent", ["record"], [value], false, slot => { if (slot === "current") acknowledged(); }) as ReturnType<SessionRepository["saveCurrent"]>,
    saveHistory: value => repositoryCall("session", "saveHistory", ["array"], [value]) as ReturnType<SessionRepository["saveHistory"]>,
    archiveAndReplace: (history, replacement, acknowledged) => repositoryCall("session", "archiveAndReplace", ["array", "record"], [history, replacement], false, slot => { if (slot === "history") acknowledged(); }) as ReturnType<SessionRepository["archiveAndReplace"]>,
  });
  return Object.freeze({ retire, trackerSession, hasTeamDraft: () => manager.getSnapshot().activeTeamExerciseDraft !== null, scope: Object.freeze({ repositories: repositories as unknown as SportingRepositories, sync, retireLegacyUnscopedData: local.retireLegacyUnscopedData, readPersonalExport: local.readPersonalExport }) });
}
