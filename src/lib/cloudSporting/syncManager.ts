import type { AssessmentPersistedState } from "../assessment/persistence";
import type { SessionArchiveOutcome, SessionRepository } from "../sessionRepository";
import type { AssessmentRepository } from "../assessment/repository";
import type { SportingRepositories } from "../persistence/profileScopedSportingPersistence";
import type { PersistenceWriteResult } from "../persistence/types";
import type { Session } from "../../types";
import type { CloudSportingRecord, CloudSportingService, SportingSyncTruth } from "./types";
import type { ExerciseExecution } from "../exercises/executionTypes";
import { EXERCISE_CATALOG } from "../exercises/catalog";
import { validateExerciseExecution } from "../exercises/executionValidation";
import type { TeamWorkspace } from "../team/teamService";
import { isCanonicalUuid } from "../uuid";
import {
  deserializeOwnedTeamExerciseResult,
  serializeCompletedTeamExercise,
  type OwnedTeamExerciseResultRecord,
} from "./teamExerciseRecords";
import type { TeamExerciseCloudService, TeamExerciseUploadPackage } from "./teamExerciseTypes";
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
  type TeamExerciseBundleSyncEntry,
  type TeamExerciseEligibilitySnapshot,
  type TeamExerciseSessionSyncEntry,
} from "./syncStateRepository";

export type TeamExerciseSyncStatus =
  | "locally_completed_upload_pending"
  | "fully_synced"
  | "partially_synced_athlete_result_blocked"
  | "sync_issue";

export type SportingSyncSnapshot = {
  ready: boolean;
  truth: SportingSyncTruth;
  pendingCount: number;
  teamBlockedCount: number;
  teamSessions: Array<{ sessionId: string; status: TeamExerciseSyncStatus }>;
  teamEligibilitySnapshots: TeamExerciseEligibilitySnapshot[];
  activeTeamExerciseDraft: ExerciseExecution | null;
  teamExerciseResults: OwnedTeamExerciseResultRecord[];
  teamExerciseResultReadStatus: "loading" | "refreshed" | "cached" | "unavailable" | "issue";
};

export type TeamExercisePermissionUpdateOutcome =
  | "updated"
  | "updated_cache_issue"
  | "failed";

export type TeamExercisePrivateNoteUpdateOutcome =
  | "updated"
  | "updated_cache_issue"
  | "failed";

type Listener = () => void;

function isExactCompletionOf(
  active: ExerciseExecution,
  completed: ExerciseExecution
): boolean {
  const lifecycleFields = new Set(["status", "completedAt", "abandonedAt"]);
  const withoutLifecycle = (execution: ExerciseExecution) =>
    Object.fromEntries(Object.entries(execution).filter(([key]) => !lifecycleFields.has(key)));
  return sameJsonValue(withoutLifecycle(active), withoutLifecycle(completed));
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return Object.is(left, right);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((item, index) => sameJsonValue(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined).sort();
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every(
    (key, index) => key === rightKeys[index] && sameJsonValue(leftRecord[key], rightRecord[key])
  );
}

export class SportingCloudSyncManager {
  private state: SportingSyncState = emptySportingSyncState();
  private snapshot: SportingSyncSnapshot = {
    ready: false,
    truth: "saved_on_device",
    pendingCount: 0,
    teamBlockedCount: 0,
    teamSessions: [],
    teamEligibilitySnapshots: [],
    activeTeamExerciseDraft: null,
    teamExerciseResults: [],
    teamExerciseResultReadStatus: "loading",
  };
  private listeners = new Set<Listener>();
  private lane: Promise<void> = Promise.resolve();
  private storageWritable = true;
  private globalIssue = false;
  private cloudVerified = false;
  private teamExerciseResultReadStatus: SportingSyncSnapshot["teamExerciseResultReadStatus"] = "loading";

  constructor(
    private readonly repositories: SportingRepositories,
    private readonly stateRepository: SportingSyncStateRepository,
    private readonly service: CloudSportingService | null,
    private readonly isOnline: () => boolean = () => typeof navigator !== "undefined" && navigator.onLine,
    private readonly teamService: TeamExerciseCloudService | null = null,
    private readonly mountedProfileId: string | null = null
  ) {}

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SportingSyncSnapshot => this.snapshot;

  private publish(): void {
    const pendingCount = this.state.entries.filter((entry) => entry.status === "pending").length +
      this.state.teamEntries.filter((entry) => entry.status === "pending").length;
    const teamBlockedCount = this.state.teamEntries.filter((entry) => entry.status === "blocked").length;
    const sessionIds = [...new Set(this.state.teamEntries.map((entry) => entry.sessionId))];
    const teamSessions = sessionIds.map((sessionId) => {
      const entries = this.state.teamEntries.filter((entry) => entry.sessionId === sessionId);
      const status: TeamExerciseSyncStatus = entries.some((entry) => entry.status === "issue")
        ? "sync_issue"
        : entries.some((entry) => entry.status === "blocked")
          ? "partially_synced_athlete_result_blocked"
          : entries.every((entry) => entry.status === "synced")
            ? "fully_synced"
            : "locally_completed_upload_pending";
      return { sessionId, status };
    });
    const teamNeedsService = this.state.teamEntries.length > 0 && !this.teamService;
    const truth: SportingSyncTruth = this.globalIssue || teamBlockedCount > 0 ||
        this.state.entries.some((entry) => entry.status === "issue") ||
        this.state.teamEntries.some((entry) => entry.status === "issue")
      ? "sync_issue"
      : pendingCount > 0 || !this.snapshot.ready || !this.service || !this.cloudVerified || teamNeedsService
        ? "saved_on_device"
        : "synced";
    this.snapshot = {
      ready: this.snapshot.ready,
      truth,
      pendingCount,
      teamBlockedCount,
      teamSessions,
      teamEligibilitySnapshots: this.state.teamEligibilitySnapshots.map((snapshot) => ({
        ...snapshot,
        participants: snapshot.participants.map((participant) => ({
          ...participant,
          functions: [...participant.functions],
        })),
      })),
      activeTeamExerciseDraft: this.state.activeTeamExerciseDraft === null
        ? null
        : JSON.parse(JSON.stringify(this.state.activeTeamExerciseDraft)) as ExerciseExecution,
      teamExerciseResults: JSON.parse(JSON.stringify(this.state.teamExerciseResults)) as OwnedTeamExerciseResultRecord[],
      teamExerciseResultReadStatus: this.teamExerciseResultReadStatus,
    };
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
      if (loaded.status === "value") {
        const recorder = loaded.value.activeTeamExerciseDraft?.teamContext?.recorderProfileId;
        if (
          (recorder !== undefined && recorder !== this.mountedProfileId) ||
          loaded.value.teamExerciseResults.some(
            (result) => result.athleteProfileId !== this.mountedProfileId
          )
        ) {
          this.storageWritable = false;
          this.globalIssue = true;
          this.teamExerciseResultReadStatus = "issue";
        } else {
          this.state = loaded.value;
          this.teamExerciseResultReadStatus = loaded.value.teamExerciseResults.length > 0
            ? "cached"
            : "unavailable";
        }
      }
      if (loaded.status === "read_failed") {
        this.storageWritable = false;
        this.globalIssue = true;
        this.teamExerciseResultReadStatus = "issue";
      }
      if (loaded.status === "absent") this.teamExerciseResultReadStatus = "unavailable";

      const safeToReconcile = this.service && this.isOnline()
        ? await this.restoreIntoLocalRepositories()
        : true;
      if (safeToReconcile) {
        await this.reconcileFromRepositories();
        if ((this.service || this.teamService) && this.isOnline()) await this.drain();
        if (this.teamService && this.isOnline()) await this.refreshOwnedTeamExerciseResults();
      }
      this.snapshot = { ...this.snapshot, ready: true };
      this.publish();
    });
  }

  synchronize(): Promise<void> {
    return this.schedule(async () => {
      if ((!this.service && !this.teamService) || !this.isOnline()) return;
      const safeToReconcile = this.service ? await this.restoreIntoLocalRepositories() : true;
      if (safeToReconcile) {
        await this.reconcileFromRepositories();
        await this.drain();
        if (this.teamService) await this.refreshOwnedTeamExerciseResults();
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
        teamEntries: this.state.teamEntries.map((entry) =>
          entry.status === "issue" || entry.status === "blocked"
            ? { ...entry, status: "pending", blockReason: undefined } as typeof entry
            : entry
        ),
      };
      await this.persist();
      if ((this.service || this.teamService) && this.isOnline()) {
        const safeToReconcile = this.service ? await this.restoreIntoLocalRepositories() : true;
        if (safeToReconcile) {
          await this.reconcileFromRepositories();
          await this.drain();
          if (this.teamService) await this.refreshOwnedTeamExerciseResults();
        }
      }
      this.publish();
    });
  }

  async enqueueCompletedTeamExercise(
    execution: ExerciseExecution,
    authenticatedProfileId: string
  ): Promise<boolean> {
    let accepted = false;
    await this.schedule(async () => {
      if (
        !this.snapshot.ready ||
        !this.storageWritable ||
        (this.mountedProfileId !== null && authenticatedProfileId !== this.mountedProfileId) ||
        execution.teamContext?.recorderProfileId !== authenticatedProfileId
      ) {
        this.globalIssue = true;
        this.publish();
        return;
      }
      const upload = serializeCompletedTeamExercise(execution);
      if (!upload) {
        this.globalIssue = true;
        this.publish();
        return;
      }
      const merged = await this.mergeTeamUpload(this.state, upload);
      this.state = merged.state;
      const persisted = await this.persist();
      accepted = merged.accepted && persisted;
      if (accepted && this.teamService && this.isOnline()) {
        await this.drainTeamEntries();
        await this.refreshOwnedTeamExerciseResults();
      }
      this.publish();
    });
    return accepted;
  }

  /** Durably creates or replaces the one active recorder-owned Team draft. */
  async saveActiveTeamExerciseDraft(
    execution: ExerciseExecution,
    authenticatedProfileId: string
  ): Promise<boolean> {
    let saved = false;
    await this.schedule(async () => {
      const validation = validateExerciseExecution(execution, EXERCISE_CATALOG);
      const existing = this.state.activeTeamExerciseDraft;
      if (
        !this.snapshot.ready ||
        !this.storageWritable ||
        (this.mountedProfileId !== null && authenticatedProfileId !== this.mountedProfileId) ||
        !validation.valid ||
        execution.status !== "in-progress" ||
        !execution.teamContext ||
        execution.teamContext.recorderProfileId !== authenticatedProfileId ||
        (existing !== null && existing.id !== execution.id)
      ) {
        this.globalIssue = true;
        this.publish();
        return;
      }
      const previous = this.state;
      this.state = {
        ...this.state,
        activeTeamExerciseDraft: JSON.parse(JSON.stringify(execution)) as ExerciseExecution,
      };
      saved = await this.persist();
      if (!saved) {
        this.state = previous;
        this.publish();
      }
    });
    return saved;
  }

  /**
   * Atomically removes the active draft and creates the immutable completed
   * Session/bundle outbox entries. A failed durable write leaves the prior
   * draft as the reload truth and never uploads.
   */
  async finalizeActiveTeamExerciseDraft(
    execution: ExerciseExecution,
    authenticatedProfileId: string
  ): Promise<boolean> {
    let finalized = false;
    await this.schedule(async () => {
      const current = this.state.activeTeamExerciseDraft;
      const validation = validateExerciseExecution(execution, EXERCISE_CATALOG);
      if (
        !this.snapshot.ready ||
        !this.storageWritable ||
        (this.mountedProfileId !== null && authenticatedProfileId !== this.mountedProfileId) ||
        !current ||
        current.id !== execution.id ||
        !isExactCompletionOf(current, execution) ||
        !validation.valid ||
        execution.status !== "completed" ||
        !execution.teamContext ||
        execution.teamContext.recorderProfileId !== authenticatedProfileId
      ) {
        this.globalIssue = true;
        this.publish();
        return;
      }
      const upload = serializeCompletedTeamExercise(execution);
      if (!upload) {
        this.globalIssue = true;
        this.publish();
        return;
      }
      const previous = this.state;
      const merged = await this.mergeTeamUpload(previous, upload);
      if (!merged.accepted) {
        this.state = merged.state;
        await this.persist();
        return;
      }
      this.state = { ...merged.state, activeTeamExerciseDraft: null };
      if (!await this.persist()) {
        this.state = previous;
        this.publish();
        return;
      }
      finalized = true;
      if (this.teamService && this.isOnline()) {
        await this.drainTeamEntries();
        await this.refreshOwnedTeamExerciseResults();
      }
      this.publish();
    });
    return finalized;
  }

  /** Explicitly discards only the current matching draft; UI confirmation is
   * required before calling this destructive boundary. */
  async discardActiveTeamExerciseDraft(
    executionId: string,
    authenticatedProfileId: string
  ): Promise<boolean> {
    let discarded = false;
    await this.schedule(async () => {
      const current = this.state.activeTeamExerciseDraft;
      if (
        !this.snapshot.ready ||
        !this.storageWritable ||
        (this.mountedProfileId !== null && authenticatedProfileId !== this.mountedProfileId) ||
        !current ||
        current.id !== executionId ||
        current.teamContext?.recorderProfileId !== authenticatedProfileId
      ) return;
      const previous = this.state;
      this.state = { ...this.state, activeTeamExerciseDraft: null };
      if (!await this.persist()) {
        this.state = previous;
        this.publish();
        return;
      }
      discarded = true;
    });
    return discarded;
  }

  /**
   * Refreshes the bounded offline Team-start snapshot from two independently
   * authorised reads: TeamService supplies the active roster and the Exercise
   * cloud boundary supplies currently active recording permissions. Failure
   * leaves the last known snapshot intact.
   */
  async refreshTeamExerciseEligibility(
    workspace: TeamWorkspace,
    authenticatedProfileId: string,
    cachedAt = new Date().toISOString()
  ): Promise<boolean> {
    let refreshed = false;
    await this.schedule(async () => {
      if (
        !this.snapshot.ready ||
        !this.storageWritable ||
        !this.teamService ||
        !this.isOnline() ||
        workspace.team.status !== "active" ||
        !isCanonicalUuid(workspace.team.id) ||
        !isCanonicalUuid(authenticatedProfileId) ||
        !Number.isFinite(Date.parse(cachedAt)) ||
        workspace.roster.length === 0 ||
        !workspace.roster.some((entry) => entry.profileId === authenticatedProfileId)
      ) return;

      const permissionResult = await this.teamService.listActiveRecordingPermissions(
        workspace.team.id
      );
      if (!permissionResult.ok) return;
      const rosterIds = new Set(workspace.roster.map((entry) => entry.profileId));
      if (
        workspace.roster.some((entry) => !isCanonicalUuid(entry.profileId)) ||
        rosterIds.size !== workspace.roster.length
      ) return;
      const grantedIds = new Set(
        permissionResult.value
          .filter((permission) => rosterIds.has(permission.athleteProfileId))
          .map((permission) => permission.athleteProfileId)
      );
      const next: TeamExerciseEligibilitySnapshot = {
        teamId: workspace.team.id,
        teamName: workspace.team.name,
        cachedAt,
        participants: workspace.roster.map((entry) => ({
          profileId: entry.profileId,
          displayName: entry.displayName,
          participationAsPlayer: entry.participationAsPlayer,
          functions: [...entry.functions],
          recordingPermissionGranted: grantedIds.has(entry.profileId),
        })),
      };
      const previous = this.state.teamEligibilitySnapshots;
      this.state = {
        ...this.state,
        teamEligibilitySnapshots: [
          ...previous.filter((snapshot) => snapshot.teamId !== next.teamId),
          next,
        ],
      };
      refreshed = await this.persist();
      this.publish();
    });
    return refreshed;
  }

  /** Athlete-owned prospective permission control; a successful cloud change
   * updates the matching cached self row only after the refreshed fact is
   * durably stored. */
  async setMyTeamExerciseRecordingPermission(
    teamId: string,
    authenticatedProfileId: string,
    granted: boolean
  ): Promise<TeamExercisePermissionUpdateOutcome> {
    let outcome: TeamExercisePermissionUpdateOutcome = "failed";
    await this.schedule(async () => {
      if (
        !this.snapshot.ready ||
        !this.storageWritable ||
        !this.teamService ||
        !this.isOnline() ||
        !isCanonicalUuid(teamId) ||
        !isCanonicalUuid(authenticatedProfileId)
      ) return;
      const result = await this.teamService.setRecordingPermission(teamId, granted);
      if (!result.ok) return;
      const snapshotIndex = this.state.teamEligibilitySnapshots.findIndex(
        (snapshot) => snapshot.teamId === teamId
      );
      if (snapshotIndex >= 0) {
        const snapshot = this.state.teamEligibilitySnapshots[snapshotIndex];
        if (snapshot.participants.some((participant) => participant.profileId === authenticatedProfileId)) {
          this.state = {
            ...this.state,
            teamEligibilitySnapshots: this.state.teamEligibilitySnapshots.map((candidate, index) =>
              index === snapshotIndex
                ? {
                    ...candidate,
                    cachedAt: new Date().toISOString(),
                    participants: candidate.participants.map((participant) =>
                      participant.profileId === authenticatedProfileId
                        ? { ...participant, recordingPermissionGranted: granted }
                        : participant
                    ),
                  }
                : candidate
            ),
          };
          if (!await this.persist()) {
            outcome = "updated_cache_issue";
            return;
          }
        }
      }
      outcome = "updated";
      this.publish();
    });
    return outcome;
  }

  async refreshMyTeamExerciseResults(): Promise<boolean> {
    let refreshed = false;
    await this.schedule(async () => {
      refreshed = await this.refreshOwnedTeamExerciseResults();
    });
    return refreshed;
  }

  async setMyTeamExercisePrivateNote(
    resultId: string,
    authenticatedProfileId: string,
    note: string | null
  ): Promise<TeamExercisePrivateNoteUpdateOutcome> {
    let outcome: TeamExercisePrivateNoteUpdateOutcome = "failed";
    await this.schedule(async () => {
      const normalized = note === null || note.trim().length === 0 ? null : note;
      const owned = this.state.teamExerciseResults.find(
        (record) => record.result.id === resultId &&
          record.athleteProfileId === authenticatedProfileId
      );
      if (
        !this.snapshot.ready || !this.storageWritable || !this.teamService ||
        !this.isOnline() || !owned || authenticatedProfileId !== this.mountedProfileId ||
        (normalized !== null && new TextEncoder().encode(normalized).byteLength > 65_536)
      ) return;
      const result = await this.teamService.setPrivateNote(resultId, normalized);
      if (!result.ok || (normalized === null
        ? result.value.outcome !== "cleared" && result.value.outcome !== "already_clear"
        : result.value.outcome !== "created" && result.value.outcome !== "updated")) return;
      this.state = {
        ...this.state,
        teamExerciseResults: this.state.teamExerciseResults.map((record) =>
          record.result.id === resultId
            ? {
                ...record,
                privateNote: normalized === null
                  ? null
                  : { note: normalized, updatedAt: result.value.updatedAt },
              }
            : record
        ),
      };
      if (!await this.persist()) {
        outcome = "updated_cache_issue";
        return;
      }
      outcome = "updated";
      this.publish();
    });
    return outcome;
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

  private async persist(): Promise<boolean> {
    if (!this.storageWritable) return false;
    const saved = await this.stateRepository.save(this.state);
    if (!saved.ok) {
      this.storageWritable = false;
      this.globalIssue = true;
    }
    this.publish();
    return saved.ok;
  }

  private async refreshOwnedTeamExerciseResults(): Promise<boolean> {
    if (!this.teamService || !this.isOnline() || !this.storageWritable ||
        !this.mountedProfileId || !isCanonicalUuid(this.mountedProfileId)) {
      this.teamExerciseResultReadStatus = this.state.teamExerciseResults.length > 0
        ? "cached"
        : "unavailable";
      this.publish();
      return false;
    }
    this.teamExerciseResultReadStatus = "loading";
    this.publish();
    const response = await this.teamService.listMyResults();
    if (!response.ok) {
      this.teamExerciseResultReadStatus = response.error === "unavailable"
        ? (this.state.teamExerciseResults.length > 0 ? "cached" : "unavailable")
        : "issue";
      if (response.error !== "unavailable") this.globalIssue = true;
      this.publish();
      return false;
    }
    const parsed = await Promise.all(
      response.value.map((record) =>
        deserializeOwnedTeamExerciseResult(record, this.mountedProfileId!)
      )
    );
    const values = parsed.filter(
      (record): record is OwnedTeamExerciseResultRecord => record !== null
    );
    if (
      values.length !== response.value.length ||
      new Set(values.map((record) => record.result.id)).size !== values.length ||
      new Set(values.map((record) => record.sessionId)).size !== values.length
    ) {
      this.teamExerciseResultReadStatus = "issue";
      this.globalIssue = true;
      this.publish();
      return false;
    }
    const previous = this.state;
    this.state = {
      ...this.state,
      teamExerciseResults: values.sort(
        (left, right) => Date.parse(right.sharedExecution.completedAt ?? right.cloudCreatedAt) -
          Date.parse(left.sharedExecution.completedAt ?? left.cloudCreatedAt)
      ),
    };
    if (!await this.persist()) {
      this.state = previous;
      this.teamExerciseResultReadStatus = "issue";
      this.publish();
      return false;
    }
    this.teamExerciseResultReadStatus = "refreshed";
    this.publish();
    return true;
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

    this.state = { ...this.state, entries: [...existing.values()] };
    await this.persist();
  }

  private async drain(): Promise<void> {
    if (!this.storageWritable || !this.isOnline()) return;
    if (this.service) {
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
          if (!this.storageWritable) return;
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
        if (!this.storageWritable) return;
      }
    }
    await this.drainTeamEntries();
  }

  private async mergeTeamUpload(
    state: SportingSyncState,
    upload: TeamExerciseUploadPackage
  ): Promise<{ state: SportingSyncState; accepted: boolean }> {
    const sessionHash = await sha256Hex(upload.session.coordinationPayload);
    const bundleHashes = await Promise.all(upload.bundles.map((bundle) => sha256Hex(bundle.resultPayload)));
    if (!sessionHash || bundleHashes.some((hash) => hash === null)) {
      this.globalIssue = true;
      return { state, accepted: false };
    }
    const priorSession = state.teamEntries.find(
      (entry): entry is TeamExerciseSessionSyncEntry =>
        entry.entryKind === "team_exercise_session" && entry.sessionId === upload.session.sessionId
    );
    const priorBundles = state.teamEntries.filter(
      (entry): entry is TeamExerciseBundleSyncEntry => entry.entryKind === "team_exercise_bundle" && entry.sessionId === upload.session.sessionId
    );
    const exactSession = !priorSession ||
      (priorSession.contentSha256 === sessionHash &&
        (priorSession.coordinationPayload === upload.session.coordinationPayload ||
          (priorSession.status === "synced" && priorSession.coordinationPayload === "")));
    const exactBundles = priorBundles.length === 0 ||
      (priorBundles.length === upload.bundles.length && upload.bundles.every((bundle, index) => {
        const prior = priorBundles.find((entry) => entry.bundleId === bundle.bundleId);
        return prior?.contentSha256 === bundleHashes[index] &&
          (prior.resultPayload === bundle.resultPayload || (prior.status === "synced" && prior.resultPayload === ""));
      }));
    if (!exactSession || !exactBundles) {
      return {
        accepted: false,
        state: {
          ...state,
          teamEntries: state.teamEntries.map((entry) =>
            entry.sessionId === upload.session.sessionId ? { ...entry, status: "issue" } : entry
          ),
        },
      };
    }
    if (!priorSession) {
      const sessionEntry: TeamExerciseSessionSyncEntry = {
        entryKind: "team_exercise_session",
        ...upload.session,
        contentSha256: sessionHash,
        status: "pending",
      };
      const bundleEntries: TeamExerciseBundleSyncEntry[] = upload.bundles.map((bundle, index) => ({
        entryKind: "team_exercise_bundle",
        ...bundle,
        contentSha256: bundleHashes[index]!,
        status: "pending",
      }));
      return {
        accepted: true,
        state: { ...state, teamEntries: [...state.teamEntries, sessionEntry, ...bundleEntries] },
      };
    }
    return { state, accepted: true };
  }

  private async drainTeamEntries(): Promise<void> {
    if (!this.teamService || !this.storageWritable || !this.isOnline()) return;
    const sessionEntries = this.state.teamEntries.filter(
      (entry): entry is TeamExerciseSessionSyncEntry => entry.entryKind === "team_exercise_session"
    );
    for (const original of sessionEntries) {
      if (original.status !== "pending") continue;
      if (await sha256Hex(original.coordinationPayload) !== original.contentSha256) {
        const corruptIndex = this.state.teamEntries.findIndex(
          (entry) => entry.entryKind === "team_exercise_session" && entry.sessionId === original.sessionId
        );
        if (corruptIndex >= 0) this.state.teamEntries[corruptIndex] = { ...original, status: "issue" };
        await this.persist();
        if (!this.storageWritable) return;
        continue;
      }
      const result = await this.teamService.putSession(original);
      const index = this.state.teamEntries.findIndex(
        (entry) => entry.entryKind === "team_exercise_session" && entry.sessionId === original.sessionId
      );
      if (index < 0) continue;
      if (!result.ok) {
        if (result.error !== "unavailable") this.state.teamEntries[index] = { ...original, status: "issue" };
      } else if (result.value.outcome === "conflict" || result.value.contentSha256 !== original.contentSha256) {
        this.state.teamEntries[index] = { ...original, status: "issue" };
      } else {
        this.state.teamEntries[index] = { ...original, coordinationPayload: "", status: "synced" };
      }
      await this.persist();
      if (!this.storageWritable) return;
    }

    const bundleEntries = this.state.teamEntries.filter(
      (entry): entry is TeamExerciseBundleSyncEntry => entry.entryKind === "team_exercise_bundle"
    );
    for (const original of bundleEntries) {
      if (original.status !== "pending") continue;
      if (await sha256Hex(original.resultPayload) !== original.contentSha256) {
        const corruptIndex = this.state.teamEntries.findIndex(
          (entry) => entry.entryKind === "team_exercise_bundle" && entry.bundleId === original.bundleId
        );
        if (corruptIndex >= 0) this.state.teamEntries[corruptIndex] = { ...original, status: "issue" };
        await this.persist();
        if (!this.storageWritable) return;
        continue;
      }
      const envelope = this.state.teamEntries.find(
        (entry) => entry.entryKind === "team_exercise_session" && entry.sessionId === original.sessionId
      );
      if (envelope?.status !== "synced") continue;
      const result = await this.teamService.putAthleteBundle(original);
      const index = this.state.teamEntries.findIndex(
        (entry) => entry.entryKind === "team_exercise_bundle" && entry.bundleId === original.bundleId
      );
      if (index < 0) continue;
      if (!result.ok) {
        if (result.error !== "unavailable") this.state.teamEntries[index] = { ...original, status: "issue" };
      } else if (result.value.contentSha256 !== original.contentSha256 || result.value.outcome === "conflict") {
        this.state.teamEntries[index] = { ...original, status: "issue" };
      } else if (result.value.outcome === "blocked") {
        this.state.teamEntries[index] = result.value.blockReason
          ? { ...original, status: "blocked", blockReason: result.value.blockReason }
          : { ...original, status: "issue" };
      } else {
        this.state.teamEntries[index] = {
          ...original,
          resultPayload: "",
          status: "synced",
          blockReason: undefined,
        };
      }
      await this.persist();
      if (!this.storageWritable) return;
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
    this.state = { ...this.state, entries: [...entries.values()] };
    this.cloudVerified = true;
    await this.persist();
    return true;
  }
}
