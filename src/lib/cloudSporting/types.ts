export type CloudSportingRecordKind = "training_session" | "assessment_run";

export type CloudSportingRecord = {
  recordKind: CloudSportingRecordKind;
  recordId: string;
  schemaVersion: number;
  payload: string;
  contentSha256: string;
  recordedAt: string;
};

export type CloudMutationOutcome =
  | "inserted"
  | "already_present"
  | "deleted"
  | "already_deleted"
  | "conflict";

export type CloudSportingErrorKind =
  | "unavailable"
  | "forbidden"
  | "invalid_input"
  | "invalid_response"
  | "unexpected_error";

export type CloudSportingResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: CloudSportingErrorKind };

export interface CloudSportingService {
  restore(): Promise<CloudSportingResult<CloudSportingRecord[]>>;
  put(record: Omit<CloudSportingRecord, "contentSha256">): Promise<CloudSportingResult<{
    outcome: CloudMutationOutcome;
    contentSha256: string;
  }>>;
  delete(record: Pick<CloudSportingRecord, "recordKind" | "recordId" | "contentSha256">): Promise<CloudSportingResult<{
    outcome: CloudMutationOutcome;
    contentSha256: string;
  }>>;
}

export type SportingSyncTruth = "saved_on_device" | "synced" | "sync_issue";

