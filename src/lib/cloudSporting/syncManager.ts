import type { AssessmentPersistedState } from "../assessment/persistence";
import type { SessionArchiveOutcome, SessionRepository } from "../sessionRepository";
import type { AssessmentRepository } from "../assessment/repository";
import type { SportingRepositories } from "../persistence/profileScopedSportingPersistence";
import type { PersistenceWriteResult } from "../persistence/types";
import type { Session } from "../../types";
import type { CloudSportingRecord, CloudSportingService, SportingSyncTruth } from "./types";
import {
  deserializeAssessmentRun,
  deserializeTrainingSession,
  recordKey,
  serializeAssessmentRun,
  serializeTrainingSession,
  sha256Hex,
  type LocalTerminalRecord,
} from "./records";
import {
  emptySportingSyncState,
  type SportingSyncState,
  type SportingSyncStateRepository,
} from "./syncStateRepository";

export type SportingSyncSnapshot = {
  ready: boolean;
  truth: SportingSyncTruth;
  pendingCount: number;
};

type Listener = () => void;

export class SportingCloudSyncManager {
  private state: SportingSyncState = emptySportingSyncState();
  private snapshot: SportingSyncSnapshot = { ready: false, truth: "saved_on_device", pendingCount: 0 };
  private listeners = new Set<Listener>();
  private lane: Promise<void> = Promise.resolve();
  private storageWritable = true;
  private globalIssue = false;
  private cloudVerified = false;

  constructor(
    private readonly repositories: SportingRepositories,
    private readonly stateRepository: SportingSyncStateRepository,
    private readonly service: CloudSportingService | null,
    private readonly isOnline: () => boolean = () => typeof navigator !== "undefined" && navigator.onLine
  ) {}

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SportingSyncSnapshot => this.snapshot;

  private publish(): void {
    const pendingCount = this.state.entries.filter((entry) => entry.status === "pending").length;
    const truth: SportingSyncTruth = this.globalIssue || this.state.entries.some((entry) => entry.status === "issue")
      ? "sync_issue"
      : pendingCount > 0 || !this.snapshot.ready || !this.service || !this.cloudVerified
        ? "saved_on_device"
        : "synced";
    this.snapshot = { ready: this.snapshot.ready, truth, pendingCount };
    for (const listener of this.listeners) listener();
  }

  private schedule(work: () => Promise<void>): Promise<void> {
    this.lane = this.lane.then(work, work).catch(() => {
      this.globalIssue = true;
      this.publish();
    });
    return this.lane;
  }

  initialize(): Promise<void> {
    return this.schedule(async () => {
      const loaded = await this.stateRepository.load();
      if (loaded.status === "value") this.state = loaded.value;
      if (loaded.status === "read_failed") {
        this.storageWritable = false;
        this.globalIssue = true;
      }

      const safeToReconcile = this.service && this.isOnline()
        ? await this.restoreIntoLocalRepositories()
        : true;
      if (safeToReconcile) {
        await this.reconcileFromRepositories();
        if (this.service && this.isOnline()) await this.drain();
      }
      this.snapshot = { ...this.snapshot, ready: true };
      this.publish();
    });
  }

  synchronize(): Promise<void> {
    return this.schedule(async () => {
      if (!this.service || !this.isOnline()) return;
      const safeToReconcile = await this.restoreIntoLocalRepositories();
      if (safeToReconcile) {
        await this.reconcileFromRepositories();
        await this.drain();
      }
      this.publish();
    });
  }

  retry(): Promise<void> {
    return this.schedule(async () => {
      if (!this.storageWritable) return;
      this.globalIssue = false;
      this.state = {
        ...this.state,
        entries: this.state.entries.map((entry) => entry.status === "issue" ? { ...entry, status: "pending" } : entry),
      };
      await this.persist();
      if (this.service && this.isOnline()) {
        const safeToReconcile = await this.restoreIntoLocalRepositories();
        if (safeToReconcile) {
          await this.reconcileFromRepositories();
          await this.drain();
        }
      }
      this.publish();
    });
  }

  reconcileTrainingHistory(history: Session[]): void {
    void this.schedule(async () => {
      await this.reconcile(history.map(serializeTrainingSession), "training_session");
      if (this.service && this.isOnline()) await this.drain();
    });
  }

  reconcileAssessmentHistory(state: AssessmentPersistedState): void {
    void this.schedule(async () => {
      await this.reconcile(state.history.map(serializeAssessmentRun), "assessment_run");
      if (this.service && this.isOnline()) await this.drain();
    });
  }

  decorateRepositories(): SportingRepositories {
    const session = this.repositories.session;
    const assessment = this.repositories.assessment;
    const reconcileTraining = (history: Session[]) => this.reconcileTrainingHistory(history);
    const reconcileAssessment = (state: AssessmentPersistedState) => this.reconcileAssessmentHistory(state);
    const decoratedSession: SessionRepository = {
      ...session,
      async saveHistory(history): Promise<PersistenceWriteResult> {
        const result = await session.saveHistory(history);
        if (result.ok) reconcileTraining(history);
        return result;
      },
      async archiveAndReplace(history, current): Promise<SessionArchiveOutcome> {
        const result = await session.archiveAndReplace(history, current);
        if (result.ok || result.step === "current") reconcileTraining(history);
        return result;
      },
    };
    const decoratedAssessment: AssessmentRepository = {
      ...assessment,
      async saveState(state): Promise<PersistenceWriteResult> {
        const result = await assessment.saveState(state);
        if (result.ok) reconcileAssessment(state);
        return result;
      },
    };
    return Object.freeze({ ...this.repositories, session: decoratedSession, assessment: decoratedAssessment });
  }

  private async persist(): Promise<void> {
    if (!this.storageWritable) return;
    const saved = await this.stateRepository.save(this.state);
    if (!saved.ok) {
      this.storageWritable = false;
      this.globalIssue = true;
    }
    this.publish();
  }

  private async reconcileFromRepositories(): Promise<void> {
    const [sessions, assessment] = await Promise.all([
      this.repositories.session.loadHistory(),
      this.repositories.assessment.loadState(),
    ]);
    if (sessions.status === "read_failed" || assessment.status === "read_failed") {
      this.globalIssue = true;
      return;
    }
    await this.reconcile(
      (sessions.status === "value" ? sessions.value : []).map(serializeTrainingSession),
      "training_session"
    );
    const assessmentState = assessment.status === "value" ? assessment.value.state : { schemaVersion: 1, history: [] };
    await this.reconcile(assessmentState.history.map(serializeAssessmentRun), "assessment_run");
  }

  private async reconcile(
    candidates: Array<LocalTerminalRecord | null>,
    kind: "training_session" | "assessment_run"
  ): Promise<void> {
    if (!this.storageWritable) return;
    const existing = new Map(this.state.entries.map((entry) => [recordKey(entry.recordKind, entry.recordId), entry]));
    const localKeys = new Set<string>();

    for (const candidate of candidates) {
      if (!candidate) {
        this.globalIssue = true;
        continue;
      }
      const key = recordKey(candidate.recordKind, candidate.recordId);
      localKeys.add(key);
      const hash = await sha256Hex(candidate.payload);
      if (!hash) {
        this.globalIssue = true;
        continue;
      }
      const prior = existing.get(key);
      if (!prior) {
        existing.set(key, { ...candidate, contentSha256: hash, desired: "present", status: "pending" });
      } else if (prior.payload !== candidate.payload || prior.contentSha256 !== hash || prior.desired === "deleted") {
        existing.set(key, { ...prior, status: "issue" });
      }
    }

    for (const [key, entry] of existing) {
      if (entry.recordKind === kind && entry.desired === "present" && !localKeys.has(key)) {
        // A deletion needs the last server-acknowledged digest, not the raw sporting
        // payload. Remove the payload from the device-side queue immediately rather
        // than retaining deleted personal data until connectivity returns.
        existing.set(key, { ...entry, payload: "", desired: "deleted", status: "pending" });
      }
    }

    this.state = { schemaVersion: 1, entries: [...existing.values()] };
    await this.persist();
  }

  private async drain(): Promise<void> {
    if (!this.service || !this.storageWritable || !this.isOnline()) return;
    for (const original of [...this.state.entries]) {
      if (original.status !== "pending") continue;
      const result = original.desired === "present"
        ? await this.service.put(original)
        : await this.service.delete(original);
      const index = this.state.entries.findIndex((entry) => recordKey(entry.recordKind, entry.recordId) === recordKey(original.recordKind, original.recordId));
      if (index < 0) continue;
      if (!result.ok) {
        if (result.error !== "unavailable") this.state.entries[index] = { ...this.state.entries[index], status: "issue" };
        await this.persist();
        continue;
      }
      if (result.value.outcome === "conflict" || result.value.contentSha256 !== original.contentSha256) {
        this.state.entries[index] = { ...this.state.entries[index], status: "issue" };
      } else if (original.desired === "deleted") {
        this.state.entries.splice(index, 1);
      } else {
        this.state.entries[index] = { ...this.state.entries[index], status: "synced" };
      }
      await this.persist();
    }
  }

  private async restoreIntoLocalRepositories(): Promise<boolean> {
    if (!this.service) return true;
    const restored = await this.service.restore();
    if (!restored.ok) {
      this.cloudVerified = false;
      if (restored.error !== "unavailable") this.globalIssue = true;
      return true;
    }

    const trusted: CloudSportingRecord[] = [];
    const restoredSessions: Session[] = [];
    const restoredAssessmentRuns: AssessmentPersistedState["history"] = [];
    for (const record of restored.value) {
      const hash = await sha256Hex(record.payload);
      if (hash !== record.contentSha256) {
        this.globalIssue = true;
        this.cloudVerified = false;
        return false;
      }
      if (record.recordKind === "training_session") {
        const value = deserializeTrainingSession(record);
        if (!value) {
          this.globalIssue = true;
          this.cloudVerified = false;
          return false;
        }
        restoredSessions.push(value);
      } else {
        const value = deserializeAssessmentRun(record);
        if (!value) {
          this.globalIssue = true;
          this.cloudVerified = false;
          return false;
        }
        restoredAssessmentRuns.push(value);
      }
      trusted.push(record);
    }

    const [sessionLoad, assessmentLoad] = await Promise.all([
      this.repositories.session.loadHistory(),
      this.repositories.assessment.loadState(),
    ]);
    if (sessionLoad.status === "read_failed" || assessmentLoad.status === "read_failed") {
      this.globalIssue = true;
      this.cloudVerified = false;
      return false;
    }

    const deletionKeys = new Set(
      this.state.entries
        .filter((entry) => entry.desired === "deleted")
        .map((entry) => recordKey(entry.recordKind, entry.recordId))
    );
    const sessions = sessionLoad.status === "value" ? sessionLoad.value : [];
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    let sessionsChanged = false;
    for (const value of restoredSessions) {
      if (deletionKeys.has(recordKey("training_session", value.id))) continue;
      const prior = sessionsById.get(value.id);
      const record = trusted.find(
        (item) => item.recordKind === "training_session" && item.recordId === value.id
      );
      if (!record) {
        this.globalIssue = true;
        this.cloudVerified = false;
        return false;
      }
      if (prior && JSON.stringify(prior) !== record.payload) {
        this.globalIssue = true;
        this.cloudVerified = false;
        return false;
      }
      if (!prior) {
        sessionsById.set(value.id, value);
        sessionsChanged = true;
      }
    }

    const assessmentState = assessmentLoad.status === "value"
      ? assessmentLoad.value.state
      : { schemaVersion: 1 as const, history: [] };
    const assessmentById = new Map(assessmentState.history.map((run) => [run.id, run]));
    let assessmentChanged = false;
    for (const value of restoredAssessmentRuns) {
      if (deletionKeys.has(recordKey("assessment_run", value.id))) continue;
      const prior = assessmentById.get(value.id);
      const record = trusted.find(
        (item) => item.recordKind === "assessment_run" && item.recordId === value.id
      );
      if (!record) {
        this.globalIssue = true;
        this.cloudVerified = false;
        return false;
      }
      if (prior && JSON.stringify(prior) !== record.payload) {
        this.globalIssue = true;
        this.cloudVerified = false;
        return false;
      }
      if (!prior) {
        assessmentById.set(value.id, value);
        assessmentChanged = true;
      }
    }

    if (sessionsChanged) {
      const saved = await this.repositories.session.saveHistory(
        [...sessionsById.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      );
      if (!saved.ok) {
        this.globalIssue = true;
        this.cloudVerified = false;
        return false;
      }
    }
    if (assessmentChanged) {
      const saved = await this.repositories.assessment.saveState({
        ...assessmentState,
        history: [...assessmentById.values()].sort(
          (a, b) => Date.parse(b.completedAt ?? b.pausedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.pausedAt ?? a.createdAt)
        ),
      });
      if (!saved.ok) {
        this.globalIssue = true;
        this.cloudVerified = false;
        return false;
      }
    }

    const entries = new Map(this.state.entries.map((entry) => [recordKey(entry.recordKind, entry.recordId), entry]));
    for (const record of trusted) {
      const key = recordKey(record.recordKind, record.recordId);
      if (deletionKeys.has(key)) continue;
      const prior = entries.get(key);
      if (!prior) entries.set(key, { ...record, desired: "present", status: "synced" });
      else if (prior.payload !== record.payload || prior.contentSha256 !== record.contentSha256) entries.set(key, { ...prior, status: "issue" });
      else if (prior.desired === "present") entries.set(key, { ...prior, status: "synced" });
    }
    this.state = { schemaVersion: 1, entries: [...entries.values()] };
    this.cloudVerified = true;
    await this.persist();
    return true;
  }
}
