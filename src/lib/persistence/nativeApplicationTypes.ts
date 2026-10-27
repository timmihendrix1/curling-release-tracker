// Erased composition contract. Genuine registry membership, never a matching
// shape, admits the dormant root; profile binding still requires real admission.
import type { NativeTrackerBinding } from "./nativeTrackerTypes";
import type { InvalidationOutcome, InvitationRecoveryOutcome } from "../identity/identityTransitionCoordinator";
import type { PendingIntent } from "../identity/pendingIntentRepository";
export type NativeTeamLinkDeliverySnapshot = Readonly<{ kind: "inactive" | "listening" | "capture_failed" | "unavailable" | "closed" }>;
export type NativePendingIntentObservation = Readonly<{ kind: "known"; intent: PendingIntent | null } | { kind: "unavailable" }>;
export type NativeApplicationComposition = Readonly<{
  bindProfile(profileId: string): NativeTrackerBinding | null;
  getTeamLinkDeliverySnapshot(): NativeTeamLinkDeliverySnapshot;
  subscribeToTeamLinkDelivery(listener: () => void): () => void;
  subscribeToIdentityInvalidations(listener: (outcome: InvalidationOutcome) => void): () => void;
  observePendingIntent(): Promise<NativePendingIntentObservation>;
  subscribeToPendingIntentChanges(listener: () => void): () => void;
  discardPendingIntent(intent: unknown): Promise<boolean>;
  recoverInvitationAccount(intent: unknown): Promise<InvitationRecoveryOutcome | null>;
}>;
