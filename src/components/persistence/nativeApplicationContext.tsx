"use client";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { NativeApplicationComposition } from "../../lib/persistence/nativeApplicationTypes";
const NativeApplicationContext = createContext<NativeApplicationComposition | null>(null);
export function useNativeApplicationComposition(): NativeApplicationComposition | null { return useContext(NativeApplicationContext); }
export function NativeApplicationProvider({ composition, children }: { composition: NativeApplicationComposition; children: ReactNode }) {
  const delivery = useSyncExternalStore(composition.subscribeToTeamLinkDelivery, composition.getTeamLinkDeliverySnapshot, composition.getTeamLinkDeliverySnapshot);
  return <NativeApplicationContext.Provider value={composition}>
    {delivery.kind === "capture_failed" ? <p role="alert">A Team link could not be saved. Open the link again to retry.</p> : null}
    {children}
  </NativeApplicationContext.Provider>;
}
