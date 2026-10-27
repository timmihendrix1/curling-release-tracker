"use client";
// Shared UI boundary: React and erased contracts only; no native value imports.
import { createContext, useContext, type ReactNode } from "react";
import type { NativeTrackerBinding } from "../../lib/persistence/nativeTrackerTypes";
const NativeTrackerContext = createContext<NativeTrackerBinding | null>(null);
export function useNativeTrackerBinding(): NativeTrackerBinding | null { return useContext(NativeTrackerContext); }
export function NativeTrackerProvider({ binding, children }: { binding: NativeTrackerBinding; children: ReactNode }) {
  return <NativeTrackerContext.Provider value={binding}>{children}</NativeTrackerContext.Provider>;
}
