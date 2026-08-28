import type { StorageAdapter, DomainLoadResult, PersistenceWriteResult } from "../persistence/types";
import { loadedAbsent, loadedValue, loadFailed } from "../persistence/types";
import type { CloudSportingRecord, CloudSportingRecordKind } from "./types";
import { isCanonicalUuid } from "../uuid";
import type {
  TeamExerciseAthleteBundleUpload,
  TeamExerciseBlockReason,
  TeamExerciseSessionUpload,
} from "./teamExerciseTypes";
import { TEAM_FUNCTIONS, type TeamFunction } from "../team/types";
import { EXERCISE_CATALOG } from "../exercises/catalog";
import type { ExerciseExecution } from "../exercises/executionTypes";
import { validateExerciseExecution } from "../exercises/executionValidation";
import {
  validateOwnedTeamExerciseResultRecord,
  type OwnedTeamExerciseResultRecord,
} from "./teamExerciseRecords";

export const CLOUD_SPORTING_SYNC_STORAGE_KEY = "curling-release-tracker-cloud-sporting-sync";
export const CLOUD_SPORTING_SYNC_SCHEMA_VERSION = 5;

export type SportingSyncEntry = CloudSportingRecord & {
  desired: "present" | "deleted";
  status: "pending" | "synced" | "issue";
};

export type TeamExerciseSessionSyncEntry = TeamExerciseSessionUpload & {
  entryKind: "team_exercise_session";
  contentSha256: string;
  status: "pending" | "synced" | "issue";
};

export type TeamExerciseBundleSyncEntry = TeamExerciseAthleteBundleUpload & {
  entryKind: "team_exercise_bundle";
  contentSha256: string;
  status: "pending" | "synced" | "blocked" | "issue";
  blockReason?: TeamExerciseBlockReason;
};

export type TeamExerciseSyncEntry = TeamExerciseSessionSyncEntry | TeamExerciseBundleSyncEntry;

export type TeamExerciseEligibilityParticipant = {
  profileId: string;
  displayName: string | null;
  participationAsPlayer: boolean;
  functions: TeamFunction[];
  recordingPermissionGranted: boolean;
};

/**
 * The latest server-observed active Team roster and prospective recording
 * permission facts. It is deliberately a local start aid, never cloud
 * authority: every completed athlete bundle is revalidated at upload.
 */
export type TeamExerciseEligibilitySnapshot = {
  teamId: string;
  teamName: string;
  cachedAt: string;
  participants: TeamExerciseEligibilityParticipant[];
};

export type SportingSyncState = {
  schemaVersion: 5;
  entries: SportingSyncEntry[];
  teamEntries: TeamExerciseSyncEntry[];
  teamEligibilitySnapshots: TeamExerciseEligibilitySnapshot[];
  /** Exactly one recorder-owned, reload-safe Team draft in V1. */
  activeTeamExerciseDraft: ExerciseExecution | null;
  /** Athlete-owned Team results restored from cloud; never recorder outbox data. */
  teamExerciseResults: OwnedTeamExerciseResultRecord[];
};

export interface SportingSyncStateRepository {
  load(): Promise<DomainLoadResult<SportingSyncState>>;
  save(state: SportingSyncState): Promise<PersistenceWriteResult>;
}

export function emptySportingSyncState(): SportingSyncState {
  return {
    schemaVersion: CLOUD_SPORTING_SYNC_SCHEMA_VERSION,
    entries: [],
    teamEntries: [],
    teamEligibilitySnapshots: [],
    activeTeamExerciseDraft: null,
    teamExerciseResults: [],
  };
}

function isKind(value: unknown): value is CloudSportingRecordKind {
  return value === "training_session" || value === "assessment_run";
}

function parseSportingEntries(raw: unknown): SportingSyncEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: SportingSyncEntry[] = [];
  const keys = new Set<string>();
  for (const candidate of raw) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (!isKind(item.recordKind) || !isCanonicalUuid(item.recordId) || !Number.isInteger(item.schemaVersion) || (item.schemaVersion as number) < 1 ||
        typeof item.payload !== "string" ||
        (item.desired === "present" && item.payload.length === 0) ||
        (item.desired === "deleted" && item.payload !== "") ||
        !/^[0-9a-f]{64}$/.test(String(item.contentSha256)) ||
        typeof item.recordedAt !== "string" || !Number.isFinite(Date.parse(item.recordedAt)) ||
        (item.desired !== "present" && item.desired !== "deleted") ||
        (item.status !== "pending" && item.status !== "synced" && item.status !== "issue")) return null;
    const key = `${item.recordKind}:${item.recordId}`;
    if (keys.has(key)) return null;
    keys.add(key);
    entries.push({
      recordKind: item.recordKind,
      recordId: item.recordId,
      schemaVersion: item.schemaVersion as number,
      payload: item.payload,
      contentSha256: item.contentSha256 as string,
      recordedAt: item.recordedAt,
      desired: item.desired,
      status: item.status,
    });
  }
  return entries;
}

const BLOCK_REASONS = new Set<TeamExerciseBlockReason>([
  "athlete_not_session_participant",
  "execution_not_in_session",
  "athlete_ineligible",
  "athlete_membership_inactive",
  "recording_permission_missing",
]);

function validUuidArray(value: unknown, nonEmpty = true): value is string[] {
  return Array.isArray(value) && (!nonEmpty || value.length > 0) &&
    value.every(isCanonicalUuid) && new Set(value).size === value.length;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowlist = new Set(allowed);
  return Object.keys(value).every((key) => allowlist.has(key));
}

function parseTeamEntries(raw: unknown): TeamExerciseSyncEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: TeamExerciseSyncEntry[] = [];
  const keys = new Set<string>();
  for (const candidate of raw) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (!/^[0-9a-f]{64}$/.test(String(item.contentSha256)) || !Number.isInteger(item.schemaVersion) ||
        (item.schemaVersion as number) < 1 || !isCanonicalUuid(item.sessionId)) return null;
    if (item.entryKind === "team_exercise_session") {
      if (!hasOnlyKeys(item, [
        "entryKind", "sessionId", "teamId", "schemaVersion", "coordinationPayload",
        "startedAt", "completedAt", "participantProfileIds", "trainingAthleteProfileIds",
        "executionIds", "contentSha256", "status",
      ]) || !isCanonicalUuid(item.teamId) || typeof item.coordinationPayload !== "string" ||
          (item.status === "synced" ? item.coordinationPayload !== "" : item.coordinationPayload.length === 0) ||
          typeof item.startedAt !== "string" || !Number.isFinite(Date.parse(item.startedAt)) ||
          typeof item.completedAt !== "string" || !Number.isFinite(Date.parse(item.completedAt)) ||
          Date.parse(item.completedAt) < Date.parse(item.startedAt) ||
          !validUuidArray(item.participantProfileIds) || !validUuidArray(item.trainingAthleteProfileIds) ||
          !(item.trainingAthleteProfileIds as string[]).every((id) => (item.participantProfileIds as string[]).includes(id)) ||
          !validUuidArray(item.executionIds) ||
          (item.status !== "pending" && item.status !== "synced" && item.status !== "issue") || item.blockReason !== undefined) return null;
      const key = `session:${item.sessionId}`;
      if (keys.has(key)) return null;
      keys.add(key);
      entries.push({
        entryKind: "team_exercise_session",
        sessionId: item.sessionId,
        teamId: item.teamId,
        schemaVersion: item.schemaVersion as number,
        coordinationPayload: item.coordinationPayload,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        participantProfileIds: item.participantProfileIds,
        trainingAthleteProfileIds: item.trainingAthleteProfileIds,
        executionIds: item.executionIds,
        contentSha256: item.contentSha256 as string,
        status: item.status,
      });
    } else if (item.entryKind === "team_exercise_bundle") {
      if (!hasOnlyKeys(item, [
        "entryKind", "bundleId", "sessionId", "athleteProfileId", "schemaVersion",
        "resultPayload", "recordedAt", "resultIds", "executionIds", "contentSha256",
        "status", "blockReason",
      ]) || !isCanonicalUuid(item.bundleId) || !isCanonicalUuid(item.athleteProfileId) ||
          typeof item.resultPayload !== "string" ||
          (item.status === "synced" ? item.resultPayload !== "" : item.resultPayload.length === 0) ||
          typeof item.recordedAt !== "string" || !Number.isFinite(Date.parse(item.recordedAt)) ||
          !validUuidArray(item.resultIds) || !validUuidArray(item.executionIds) ||
          item.resultIds.length !== item.executionIds.length ||
          (item.status !== "pending" && item.status !== "synced" && item.status !== "blocked" && item.status !== "issue") ||
          (item.status === "blocked" ? !BLOCK_REASONS.has(item.blockReason as TeamExerciseBlockReason) : item.blockReason !== undefined)) return null;
      const key = `bundle:${item.bundleId}`;
      if (keys.has(key)) return null;
      keys.add(key);
      entries.push({
        entryKind: "team_exercise_bundle",
        bundleId: item.bundleId,
        sessionId: item.sessionId,
        athleteProfileId: item.athleteProfileId,
        schemaVersion: item.schemaVersion as number,
        resultPayload: item.resultPayload,
        recordedAt: item.recordedAt,
        resultIds: item.resultIds,
        executionIds: item.executionIds,
        contentSha256: item.contentSha256 as string,
        status: item.status,
        ...(item.status === "blocked" ? { blockReason: item.blockReason as TeamExerciseBlockReason } : {}),
      });
    } else return null;
  }
  const sessions = entries.filter(
    (entry): entry is TeamExerciseSessionSyncEntry => entry.entryKind === "team_exercise_session"
  );
  const bundles = entries.filter(
    (entry): entry is TeamExerciseBundleSyncEntry => entry.entryKind === "team_exercise_bundle"
  );
  const resultIds = new Set<string>();
  for (const session of sessions) {
    const children = bundles.filter((bundle) => bundle.sessionId === session.sessionId);
    if (children.length !== session.trainingAthleteProfileIds.length ||
        session.trainingAthleteProfileIds.some((athleteId) =>
          children.filter((bundle) => bundle.athleteProfileId === athleteId).length !== 1
        )) return null;
    for (const bundle of children) {
      if (Date.parse(bundle.recordedAt) < Date.parse(session.startedAt) ||
          Date.parse(bundle.recordedAt) > Date.parse(session.completedAt) ||
          bundle.executionIds.some((executionId) => !session.executionIds.includes(executionId)) ||
          bundle.resultIds.some((resultId) => resultIds.has(resultId))) return null;
      bundle.resultIds.forEach((resultId) => resultIds.add(resultId));
    }
  }
  if (bundles.some((bundle) => !sessions.some((session) => session.sessionId === bundle.sessionId))) return null;
  return entries;
}

function parseEligibilitySnapshots(raw: unknown): TeamExerciseEligibilitySnapshot[] | null {
  if (!Array.isArray(raw)) return null;
  const snapshots: TeamExerciseEligibilitySnapshot[] = [];
  const teamIds = new Set<string>();
  for (const candidate of raw) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (
      !hasOnlyKeys(item, ["teamId", "teamName", "cachedAt", "participants"]) ||
      !isCanonicalUuid(item.teamId) ||
      typeof item.teamName !== "string" || item.teamName.trim().length === 0 ||
      typeof item.cachedAt !== "string" || !Number.isFinite(Date.parse(item.cachedAt)) ||
      teamIds.has(item.teamId) ||
      !Array.isArray(item.participants) || item.participants.length === 0
    ) return null;
    const participants: TeamExerciseEligibilityParticipant[] = [];
    const profileIds = new Set<string>();
    for (const participantCandidate of item.participants) {
      if (typeof participantCandidate !== "object" || participantCandidate === null || Array.isArray(participantCandidate)) return null;
      const participant = participantCandidate as Record<string, unknown>;
      if (
        !hasOnlyKeys(participant, [
          "profileId", "displayName", "participationAsPlayer", "functions",
          "recordingPermissionGranted",
        ]) ||
        !isCanonicalUuid(participant.profileId) ||
        profileIds.has(participant.profileId) ||
        (participant.displayName !== null &&
          (typeof participant.displayName !== "string" || participant.displayName.trim().length === 0)) ||
        typeof participant.participationAsPlayer !== "boolean" ||
        typeof participant.recordingPermissionGranted !== "boolean" ||
        !Array.isArray(participant.functions) ||
        new Set(participant.functions).size !== participant.functions.length ||
        !participant.functions.every((fn) => TEAM_FUNCTIONS.includes(fn as TeamFunction))
      ) return null;
      profileIds.add(participant.profileId);
      participants.push({
        profileId: participant.profileId,
        displayName: participant.displayName as string | null,
        participationAsPlayer: participant.participationAsPlayer,
        functions: participant.functions as TeamFunction[],
        recordingPermissionGranted: participant.recordingPermissionGranted,
      });
    }
    teamIds.add(item.teamId);
    snapshots.push({
      teamId: item.teamId,
      teamName: item.teamName,
      cachedAt: item.cachedAt,
      participants,
    });
  }
  return snapshots;
}

function parseState(raw: unknown): SportingSyncState | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const root = raw as Record<string, unknown>;
  const entries = parseSportingEntries(root.entries);
  if (!entries) return null;
  if (root.schemaVersion === 1) {
    return {
      schemaVersion: 5,
      entries,
      teamEntries: [],
      teamEligibilitySnapshots: [],
      activeTeamExerciseDraft: null,
      teamExerciseResults: [],
    };
  }
  const teamEntries = parseTeamEntries(root.teamEntries);
  if (!teamEntries) return null;
  if (root.schemaVersion === 2) {
    return {
      schemaVersion: 5,
      entries,
      teamEntries,
      teamEligibilitySnapshots: [],
      activeTeamExerciseDraft: null,
      teamExerciseResults: [],
    };
  }
  if (root.schemaVersion !== 3 && root.schemaVersion !== 4 && root.schemaVersion !== 5) return null;
  const teamEligibilitySnapshots = parseEligibilitySnapshots(root.teamEligibilitySnapshots);
  if (!teamEligibilitySnapshots) return null;
  if (root.schemaVersion === 3) {
    return {
      schemaVersion: 5,
      entries,
      teamEntries,
      teamEligibilitySnapshots,
      activeTeamExerciseDraft: null,
      teamExerciseResults: [],
    };
  }
  let activeTeamExerciseDraft: ExerciseExecution | null = null;
  if (root.activeTeamExerciseDraft !== null) {
    const draftValidation = validateExerciseExecution(
      root.activeTeamExerciseDraft,
      EXERCISE_CATALOG
    );
    if (
      !draftValidation.valid ||
      typeof root.activeTeamExerciseDraft !== "object" ||
      root.activeTeamExerciseDraft === null ||
      (root.activeTeamExerciseDraft as ExerciseExecution).status !== "in-progress" ||
      !(root.activeTeamExerciseDraft as ExerciseExecution).teamContext
    ) return null;
    activeTeamExerciseDraft = root.activeTeamExerciseDraft as ExerciseExecution;
  }
  if (root.schemaVersion === 4) {
    return {
      schemaVersion: 5,
      entries,
      teamEntries,
      teamEligibilitySnapshots,
      activeTeamExerciseDraft,
      teamExerciseResults: [],
    };
  }
  if (!Array.isArray(root.teamExerciseResults)) return null;
  const teamExerciseResults: OwnedTeamExerciseResultRecord[] = [];
  const resultIds = new Set<string>();
  const sessionIds = new Set<string>();
  for (const candidate of root.teamExerciseResults) {
    const parsed = validateOwnedTeamExerciseResultRecord(candidate);
    if (!parsed || resultIds.has(parsed.result.id) || sessionIds.has(parsed.sessionId)) return null;
    resultIds.add(parsed.result.id);
    sessionIds.add(parsed.sessionId);
    teamExerciseResults.push(parsed);
  }
  return {
    schemaVersion: 5,
    entries,
    teamEntries,
    teamEligibilitySnapshots,
    activeTeamExerciseDraft,
    teamExerciseResults,
  };
}

export function createSportingSyncStateRepository(adapter: StorageAdapter): SportingSyncStateRepository {
  return {
    async load() {
      const result = await adapter.get(CLOUD_SPORTING_SYNC_STORAGE_KEY);
      if (result.status === "read_failed") return loadFailed(emptySportingSyncState(), result.error);
      if (result.value === null) return loadedAbsent<SportingSyncState>();
      try {
        const parsed = parseState(JSON.parse(result.value));
        return parsed ? loadedValue(parsed) : loadFailed(emptySportingSyncState(), { kind: "unknown", message: "Cloud sync state is invalid." });
      } catch {
        return loadFailed(emptySportingSyncState(), { kind: "unknown", message: "Cloud sync state is invalid." });
      }
    },
    save(state) {
      return adapter.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, JSON.stringify(state));
    },
  };
}
