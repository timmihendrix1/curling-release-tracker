export const TEAM_EXERCISE_CLOUD_PAYLOAD_SCHEMA_VERSION = 2;
export const SUPPORTED_TEAM_EXERCISE_CLOUD_PAYLOAD_SCHEMA_VERSIONS = [1, 2] as const;

export type TeamExerciseSessionUpload = {
  sessionId: string;
  teamId: string;
  schemaVersion: number;
  coordinationPayload: string;
  startedAt: string;
  completedAt: string;
  participantProfileIds: string[];
  trainingAthleteProfileIds: string[];
  executionIds: string[];
};

export type TeamExerciseAthleteBundleUpload = {
  bundleId: string;
  sessionId: string;
  athleteProfileId: string;
  schemaVersion: number;
  resultPayload: string;
  recordedAt: string;
  resultIds: string[];
  executionIds: string[];
};

export type TeamExerciseUploadPackage = {
  session: TeamExerciseSessionUpload;
  bundles: TeamExerciseAthleteBundleUpload[];
};

export type TeamExerciseCloudReadRecord = {
  session: TeamExerciseSessionUpload & {
    recordedByProfileId: string;
    contentSha256: string;
    createdAt: string;
  };
  bundle: TeamExerciseAthleteBundleUpload & {
    recordedByProfileId: string;
    contentSha256: string;
    createdAt: string;
  };
  privateNote: {
    resultId: string;
    note: string;
    updatedAt: string;
  } | null;
};

export type TeamExerciseBlockReason =
  | "athlete_not_session_participant"
  | "execution_not_in_session"
  | "athlete_ineligible"
  | "athlete_membership_inactive"
  | "recording_permission_missing";

export type TeamExerciseCloudErrorKind =
  | "unavailable"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "invalid_response"
  | "unexpected_error";

export type TeamExerciseCloudResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TeamExerciseCloudErrorKind };

export type TeamExercisePutOutcome = "inserted" | "already_present" | "conflict";

export type TeamExerciseRecordingPermission = {
  athleteProfileId: string;
  grantedAt: string;
};

export interface TeamExerciseCloudService {
  /** Returns only athlete-owned records visible through server RLS. */
  listMyResults(): Promise<TeamExerciseCloudResult<TeamExerciseCloudReadRecord[]>>;
  /**
   * Returns only currently active permissions visible through the Team-member
   * RLS policy. The result is suitable for an offline eligibility snapshot;
   * upload still revalidates every athlete independently on the server.
   */
  listActiveRecordingPermissions(teamId: string): Promise<TeamExerciseCloudResult<
    TeamExerciseRecordingPermission[]
  >>;
  putSession(record: TeamExerciseSessionUpload): Promise<TeamExerciseCloudResult<{
    outcome: TeamExercisePutOutcome;
    contentSha256: string;
    recordedByProfileId: string;
  }>>;
  putAthleteBundle(record: TeamExerciseAthleteBundleUpload): Promise<TeamExerciseCloudResult<{
    outcome: TeamExercisePutOutcome | "blocked";
    contentSha256: string;
    blockReason: TeamExerciseBlockReason | null;
  }>>;
  setRecordingPermission(teamId: string, granted: boolean): Promise<TeamExerciseCloudResult<{
    outcome: "granted" | "already_granted" | "revoked" | "already_revoked";
    changedAt: string | null;
  }>>;
  approveSession(sessionId: string): Promise<TeamExerciseCloudResult<{
    outcome: "approved" | "already_approved";
    changedAt: string;
  }>>;
  setPrivateNote(resultId: string, note: string | null): Promise<TeamExerciseCloudResult<{
    outcome: "created" | "updated" | "cleared" | "already_clear";
    updatedAt: string;
  }>>;
}
