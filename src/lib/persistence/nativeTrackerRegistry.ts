// Internal two-phase composition. Membership authenticates the final runtime,
// without minting Profile authority. Only the genuine host registers entries.
import type { NativeTrackerBinding } from "./nativeTrackerTypes";
import type { NativeApplicationComposition } from "./nativeApplicationTypes";
const runtimes = new WeakMap<object, NativeApplicationComposition>();
export function registerNativeTrackerRuntime(runtime: object, bind: (profileId: string) => NativeTrackerBinding | null, subscribe: NativeApplicationComposition["subscribeToIdentityInvalidations"], observePendingIntent: NativeApplicationComposition["observePendingIntent"], subscribeToPendingIntentChanges: NativeApplicationComposition["subscribeToPendingIntentChanges"], discardPendingIntent: NativeApplicationComposition["discardPendingIntent"], recoverInvitationAccount: NativeApplicationComposition["recoverInvitationAccount"], getTeamLinkDeliverySnapshot: NativeApplicationComposition["getTeamLinkDeliverySnapshot"], subscribeToTeamLinkDelivery: NativeApplicationComposition["subscribeToTeamLinkDelivery"]): void {
  runtimes.set(runtime, Object.freeze({ bindProfile: bind, subscribeToIdentityInvalidations: subscribe, observePendingIntent, subscribeToPendingIntentChanges, discardPendingIntent, recoverInvitationAccount, getTeamLinkDeliverySnapshot, subscribeToTeamLinkDelivery }));
}
export function authenticateNativeTrackerRuntime(runtime: object): boolean { return runtimes.has(runtime); }
export function bindNativeTrackerRuntime(runtime: object, profileId: string): NativeTrackerBinding | null { return runtimes.get(runtime)?.bindProfile(profileId) ?? null; }
export function resolveNativeApplicationComposition(runtime: object): NativeApplicationComposition | null { return runtimes.get(runtime) ?? null; }
