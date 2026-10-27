export type AccountDeletionState = {
  requestId: string;
  profileId: string;
  requestedAt: string;
  finalizeAfter: string;
};
export type AccountDeletionFailure = "reauthentication_required" | "recovery_period_ended" | "unavailable" | "account_changed";
export type AccountDeletionResult<T> = { ok: true; value: T; recoveredProfileId?: string } | { ok: false; error: AccountDeletionFailure };
/** False retires a superseded observation before it may mutate local evidence. */
export type AccountDeletionPendingObserver = (pending: AccountDeletionState) => boolean | void;
export interface AccountDeletionService {
  getState(onPending?: AccountDeletionPendingObserver): Promise<AccountDeletionResult<AccountDeletionState | null>>;
  request(expectedProfileId: string, beforeMutation?: () => Promise<boolean>, onPending?: AccountDeletionPendingObserver): Promise<AccountDeletionResult<AccountDeletionState>>;
  cancel(expectedRequestId: string): Promise<AccountDeletionResult<boolean>>;
  exportCloud(expectedProfileId: string): Promise<AccountDeletionResult<Record<string, unknown>>>;
}
