import type { OwnedTeamExerciseResultRecord } from "../cloudSporting/teamExerciseRecords";

export const TEAM_EXERCISE_RESULT_EXPORT_SCHEMA_VERSION = 3;

/** Athlete-owned raw export; it contains no sibling athlete result or note. */
export function serializeOwnedTeamExerciseResultExport(
  record: OwnedTeamExerciseResultRecord
): string {
  return JSON.stringify({
    schemaVersion: TEAM_EXERCISE_RESULT_EXPORT_SCHEMA_VERSION,
    session: {
      id: record.sessionId,
      teamId: record.teamId,
      recordedByProfileId: record.recordedByProfileId,
      execution: record.sharedExecution,
    },
    originalAthleteResult: record.originalResult,
    athleteResult: record.result,
    activeAttemptCorrections: record.activeAttemptCorrections,
    postCompletionRevisions: record.postCompletionRevisions,
    isVoided: record.isVoided,
    privateAthleteNote: record.privateNote,
  }, null, 2);
}
