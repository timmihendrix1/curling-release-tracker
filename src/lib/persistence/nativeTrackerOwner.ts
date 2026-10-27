// Dormant S5i. This owner is constructed only inside the genuine native host.
import type { Session } from "../../types";
import type { NativeRuntimeEvidence } from "./nativeCombinedRuntime";
import type { NativeTrackerNormalSession } from "./nativeSportingApplicationScope";
import type { RemovableStorageAdapter, PersistenceWriteResult } from "./types";
import type { NativeTrackerPort, NativeTrainingIntent, NativeCurrentJob, NativeHistoryJob, NativeArchiveJob, NativeTrainingPresentation, NativeCurrentSettlement, NativeArchiveSettlement } from "./nativeTrackerTypes";
import { reduceCredentialFault, type CredentialFaultState } from "../identity/credentialFaultPolicy";
import { captureNativeSportingArguments } from "./nativeSportingDataCapture";
import { SESSION_HISTORY_STORAGE_KEY } from "../sessionRepository";
import { profileScopedSportingStorageKey } from "./profileScopedSportingPersistence";
import { createNativeLocalSportingScope } from "./nativeLocalSportingScope";

type Options = Readonly<{
  profileId: string; identityGeneration: number; newId(): string;
  adapter: RemovableStorageAdapter; normalSession: NativeTrackerNormalSession;
  current(): boolean; normalCurrent(): boolean; hasTeamDraft(): boolean;
  register(work: Promise<unknown>): void; isOwnDisposal(value: unknown): boolean;
}>;
type Line = { id: string; workId: string | null; ended: boolean; sequence: number; lastIssued: number };
type Provenance = { line: Line; sequence: number; epoch: number; begun: boolean };
type Job = { kind: "current" | "history" | "archive"; valid: boolean; epoch: number; line: Line | null; sequence: number; begun: boolean;
  values: unknown[]; pending: Promise<unknown>[]; finish(value: unknown): void; promise: Promise<unknown>; capturing: boolean; running: boolean; historyAck: boolean; archivedHistory: Session[] | null };
const failed = (): PersistenceWriteResult => ({ ok: false, error: { kind: "storage_unavailable" } });
const normal = Object.freeze({ mode: "normal" as const, credentialPaused: false }), continuing = Object.freeze({ mode: "continuing" as const, credentialPaused: true }), blocked = Object.freeze({ mode: "blocked" as const, credentialPaused: true }), accessBlocked = Object.freeze({ mode: "blocked" as const, credentialPaused: false }), completed = Object.freeze({ mode: "completed" as const, credentialPaused: true });
const apply = Reflect.apply, then = Promise.prototype.then;
export function createNativeTrackerOwner(options: Options): Readonly<{ port: NativeTrackerPort; fault(evidence: NativeRuntimeEvidence | null): void; deny(): void; recheck(): void; retire(): void }> {
  let retired = false, attached = false, incarnation: object | null = null, epoch = 0, line: Line | null = null;
  let view = "home", overlay = false, faulted = false, contextLost = false;
  let state: CredentialFaultState = { tuple: null, sporting: "healthy", credentialPause: false, denied: false, completed: false };
  let snapshot: NativeTrainingPresentation = accessBlocked;
  const listeners = new Set<() => void>(), jobs = new WeakMap<object, Job>(), outstanding = new Set<Job>();
  const provenance = new WeakMap<Session, Provenance>(), intents = new WeakMap<object, { epoch: number; line: Line | null }>();
  function observe(value: unknown): Promise<unknown> {
    if (options.isOwnDisposal(value)) return Promise.resolve(undefined);
    return new Promise((resolve, reject) => { try { apply(then, value, [resolve, reject]); } catch { void new Promise<unknown>(done => done(value)).then(resolve, reject); } });
  }
  function retain(value: unknown, target: Promise<unknown>[]) {
    if (!options.isOwnDisposal(value) && ((typeof value === "object" && value !== null) || typeof value === "function")) target.push(observe(value).then(() => {}, () => {}));
  }
  function emit() {
    const next = !faulted ? (retired || state.denied || !attached ? accessBlocked : normal) : retired || contextLost || state.denied || state.sporting !== "healthy" ? blocked : state.completed ? completed : state.tuple && attached && personal() ? continuing : blocked;
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      let finish!: () => void; const delivery = new Promise<void>(done => { finish = done; }); options.register(delivery);
      try { void observe(listener()).then(finish, finish); } catch { finish(); }
    }
  }
  function event(value: unknown) { const reduced = reduceCredentialFault(state, value); if (!reduced.ok) { retired = true; state.tuple = null; } else state = { ...reduced.value.state }; emit(); }
  function personal() { return view === "train" && !overlay && !options.hasTeamDraft(); }
  function live() {
    if (retired) return false;
    let current = false; try { current = options.current(); } catch { /* fail closed */ }
    if (!current) { retired = true; state.tuple = null; cancelUnsubmitted(); emit(); }
    return current;
  }
  function ordinary() { return live() && !state.denied && !faulted && options.normalCurrent(); }
  function allowed() { return live() && attached && !state.denied && (!faulted ? options.normalCurrent() : !contextLost && personal() && state.tuple !== null && !state.denied && !state.completed && state.sporting === "healthy"); }
  function own(who: object) { return attached && who === incarnation; }
  function jobAllowed(job: Job) { return job.valid && job.epoch === epoch && allowed() && (job.kind === "history" ? !faulted : job.line !== null && job.line === line && !line.ended); }
  function fallback(job: Job): unknown {
    if (job.kind === "current") return { result: failed(), written: job.values[0] ?? null, sequence: job.sequence };
    if (job.kind === "history") return failed();
    return { result: { ...failed(), step: job.historyAck ? "current" : "history" }, history: job.archivedHistory, stopAfterCompletion: faulted && job.historyAck };
  }
  function cancelUnsubmitted() {
    for (const job of [...outstanding]) if (!job.running) {
      job.valid = false;
      // Reflection can revoke us and only THEN return observable malformed
      // work. Its complete pending list does not exist until capture exits.
      if (!job.capturing) void Promise.all(job.pending).then(() => { outstanding.delete(job); job.finish(fallback(job)); });
    }
  }
  function retire() { retired = true; attached = false; epoch++; state.tuple = null; cancelUnsubmitted(); emit(); listeners.clear(); }
  function fault(evidence: NativeRuntimeEvidence | null) {
    if (faulted) return;
    faulted = true;
    if (!live() || !attached || !personal() || !line || line.ended) state.tuple = null;
    if (!evidence) { contextLost = true; cancelUnsubmitted(); emit(); return; }
    event({ kind: "credential_failure", operation: evidence.operation, outcome: evidence.issued ? "unknown" : "not_issued", previousValueMayBeLost: evidence.operation === "write" && evidence.issued && evidence.previousValueMayBeLost === true });
    if (!state.tuple) cancelUnsubmitted();
  }
  function acknowledgeCurrent(job: Job) {
    if (faulted || !jobAllowed(job) || !job.begun || !personal() || !job.line?.workId) return;
    state = { tuple: { profileId: options.profileId, identityGeneration: options.identityGeneration, workId: job.line.workId, context: "training" }, sporting: "healthy", credentialPause: false, denied: false, completed: false };
  }
  function acknowledgeHistory(job: Job) {
    job.historyAck = true; // An issued ACK remains factual even after revocation.
    if (job.line !== null && job.line === line) { job.line.ended = true; event({ kind: "training_completed_saved" }); }
  }
  function prepare(kind: Job["kind"], who: object, args: readonly unknown[], sequence = 0): object {
    let finish!: (value: unknown) => void;
    const promise = new Promise<unknown>(done => { finish = done; }); options.register(promise);
    const source = kind === "current" ? provenance.get(args[0] as Session) : null;
    const job: Job = { kind, valid: own(who) && allowed(), epoch, line: kind === "history" ? null : source?.line ?? line, sequence: source?.sequence ?? line?.sequence ?? sequence, begun: source?.begun ?? false,
      values: [], pending: [], finish, promise, capturing: true, running: false, historyAck: false, archivedHistory: null };
    const token = Object.freeze({}); jobs.set(token, job); outstanding.add(job);
    try {
      if (kind === "current" && (!source || source.epoch !== epoch || source.sequence !== sequence)) job.valid = false;
      if (job.valid) job.values = captureNativeSportingArguments(args, kind === "current" ? ["record"] : kind === "history" ? ["array"] : ["record", "array", "record"], {
        current: () => job.valid && jobAllowed(job), retire: () => { job.valid = false; }, retain: value => retain(value, job.pending), isOwnDisposal: options.isOwnDisposal,
      });
      if (kind !== "history" && job.values.length && (job.values[0] as Session).id !== job.line?.id) job.valid = false;
      if (kind === "current" && job.values.length) job.begun = job.begun && hasStarted(job.values[0] as Session);
    } catch { job.valid = false; }
    finally { job.capturing = false; }
    // A rejected/unsubmitted job has no future I/O and cannot hold disposal hostage.
    if (!job.valid) void Promise.all(job.pending).then(() => { outstanding.delete(job); finish(fallback(job)); });
    return token;
  }
  function persist(token: object, kind: Job["kind"]): Promise<unknown> {
    const job = jobs.get(token);
    if (!job || job.kind !== kind) return Promise.resolve(kind === "current" ? { result: failed(), written: null, sequence: 0 } : kind === "history" ? failed() : { result: { ...failed(), step: "history" }, history: null, stopAfterCompletion: false });
    if (job.running || !outstanding.has(job)) return job.promise;
    job.running = true;
    void (async () => {
      await Promise.all(job.pending);
      if (!jobAllowed(job)) return fallback(job);
      if (kind === "current" && job.line) {
        if (job.sequence < job.line.lastIssued) return fallback(job);
        job.line.lastIssued = job.sequence;
      }
      if (kind === "history") return await options.normalSession.saveHistory(job.values[0] as Session[]);
      const current = job.values[0] as Session;
      if (!faulted) {
        if (kind === "current") {
          const result = await options.normalSession.saveCurrent(current, () => acknowledgeCurrent(job));
          return { result, written: current, sequence: job.sequence };
        }
        job.archivedHistory = job.values[1] as Session[];
        const result = await options.normalSession.archiveAndReplace(job.archivedHistory, job.values[2] as Session, () => acknowledgeHistory(job));
        return { result, history: job.archivedHistory, stopAfterCompletion: faulted && job.historyAck };
      }
      // Reduced role is private to this already-authenticated job and Session line.
      const reduced = createNativeLocalSportingScope({ profileId: options.profileId, adapter: options.adapter,
        current: () => jobAllowed(job), register: options.register, isOwnDisposal: options.isOwnDisposal,
        onSessionWriteAcknowledged: slot => { if (kind === "archive" && slot === "history") acknowledgeHistory(job); },
      }).repositories.session;
      if (kind === "current") { const result = await reduced.saveCurrent(current); return { result, written: current, sequence: job.sequence }; }
      // The generic legacy loader can represent malformed history as absent or
      // filter malformed legacy rows. Q1 may not turn that into permission to
      // overwrite unknown existing data. Check presence/cardinality, then retain
      // the actual repository's domain validation/migration as the sole schema.
      if (!jobAllowed(job)) return fallback(job);
      const rawHistory = await options.adapter.get(profileScopedSportingStorageKey(options.profileId, SESSION_HISTORY_STORAGE_KEY));
      if (rawHistory.status === "read_failed" || !jobAllowed(job)) return fallback(job);
      let priorCount = 0;
      if (rawHistory.value !== null) {
        try { const parsed: unknown = JSON.parse(rawHistory.value); if (!Array.isArray(parsed) || parsed.some(value => value === null || typeof value !== "object" || Array.isArray(value))) return fallback(job); priorCount = parsed.length; }
        catch { return fallback(job); }
      }
      const stored = await reduced.loadHistory();
      if (stored.status === "read_failed" || !jobAllowed(job) || (rawHistory.value !== null && (stored.status !== "value" || stored.value.length !== priorCount))) return fallback(job);
      job.archivedHistory = [current, ...(stored.status === "value" ? stored.value : [])];
      const result = await reduced.archiveAndReplace(job.archivedHistory, job.values[2] as Session);
      return { result, history: job.archivedHistory, stopAfterCompletion: job.historyAck };
    })().then(value => { job.valid = false; outstanding.delete(job); job.finish(value); emit(); }, async () => {
      job.valid = false; await Promise.all(job.pending); outstanding.delete(job); job.finish(fallback(job)); emit();
    });
    return job.promise;
  }
  function hasStarted(value: Session): boolean { return Array.isArray(value.blocks) && Array.isArray(value.shots) && (value.blocks.length > 0 || value.shots.length > 0 || (Array.isArray(value.exerciseExecutions) && value.exerciseExecutions.length > 0)); }
  function captureCommit(value: Session): Session | null {
    let finish!: () => void; const work = new Promise<void>(done => { finish = done; }); options.register(work);
    let valid = allowed(); const pending: Promise<unknown>[] = [];
    try {
      const copy = valid ? captureNativeSportingArguments([value], ["record"], { current: () => valid && allowed(), retire: () => { valid = false; }, retain: item => retain(item, pending), isOwnDisposal: options.isOwnDisposal })[0] as Session : null;
      return valid && allowed() && copy && typeof copy.id === "string" ? copy : null;
    } catch { return null; }
    finally { void Promise.all(pending).then(finish, finish); }
  }
  const port: NativeTrackerPort = Object.freeze({
    attach(who) { if (attached && incarnation !== who) { retire(); return; } if (!live() || faulted || state.denied) { emit(); return; } incarnation = who; attached = true; emit(); },
    detach(who) { if (!own(who)) return; attached = false; incarnation = null; epoch++; state.tuple = null; line = null; view = "home"; overlay = false; if (faulted) contextLost = true; cancelUnsubmitted(); emit(); listeners.clear(); },
    context(who, nextView, nonPersonal) { if (!own(who)) return; view = nextView; overlay = nonPersonal; if (faulted && !personal()) { contextLost = true; state.tuple = null; cancelUnsubmitted(); } emit(); },
    hydrated(who, value, sequence) { if (!own(who) || !ordinary()) return; line = { id: value.id, workId: null, ended: false, sequence, lastIssued: 0 }; provenance.set(value, { line, epoch, sequence, begun: false }); },
    commit(who, value, sequence) {
      if (!own(who) || !allowed()) return false;
      const copied = captureCommit(value); if (!copied) return false;
      if (!line || line.ended || line.id !== copied.id) { if (faulted) return false; line = { id: copied.id, workId: null, ended: false, sequence, lastIssued: 0 }; state = { tuple: null, sporting: "healthy", credentialPause: false, denied: false, completed: false }; }
      if (sequence < line.sequence) return false;
      line.sequence = sequence;
      const begun = hasStarted(copied);
      if (begun && !line.workId) { try { line.workId = options.newId(); } catch { retire(); return false; } if (!allowed()) return false; }
      provenance.set(value, { line, epoch, sequence, begun }); return true;
    },
    captureIntent(who) { if (!own(who) || !allowed()) return null; const token = Object.freeze({}) as NativeTrainingIntent; intents.set(token, { epoch, line }); return token; },
    resumeIntent(who, token) { if (!token || !own(who) || !allowed()) return false; const intent = intents.get(token); return !!intent && intent.epoch === epoch && intent.line === line && !line?.ended; },
    normalMutation: who => own(who) && ordinary(),
    prepareCurrent: (who, value, sequence) => prepare("current", who, [value], sequence) as NativeCurrentJob,
    prepareHistory: (who, value) => prepare("history", who, [value]) as NativeHistoryJob,
    prepareArchive: (who, terminal, history, replacement) => prepare("archive", who, [terminal, history, replacement]) as NativeArchiveJob,
    persistCurrent: job => persist(job, "current") as Promise<NativeCurrentSettlement>,
    persistHistory: job => persist(job, "history") as Promise<PersistenceWriteResult>,
    persistArchive: job => persist(job, "archive") as Promise<NativeArchiveSettlement>,
    getSnapshot: () => snapshot,
    subscribe(listener) { if (retired) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
  });
  return Object.freeze({ port, fault, deny() { event({ kind: "deny", reason: "definitive_provider_denial" }); cancelUnsubmitted(); }, recheck() { live(); emit(); }, retire });
}
