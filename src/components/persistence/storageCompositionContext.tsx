"use client";

// How a mounted tree reads the owned storage composition — Stage M3b3.
//
// This module is deliberately TINY and native-free. `ProfileScopedSportingPersistence`
// imports it, so it ships in every build including the Web one; anything it
// pulled in would ship too. It therefore contains a context, a hook and a
// provider component, and it reaches the implementation only through
// `import type`, which erases.
//
// The hook NEVER returns null. With no provider above it — the Web build, and
// any component test — it returns `WEB_DEFAULT_SPORTING_SEAMS`, which reproduces
// exactly what the three sporting call sites did before this stage. That is what
// lets the consumer have ONE code path rather than an `if (native)` branch whose
// untaken side is the Web's entire storage behaviour.
import { createContext, useContext, type ReactNode } from "react";
import {
  WEB_DEFAULT_SPORTING_SEAMS,
  type SportingStorageSeams,
} from "../../lib/persistence/storageSeams";

const SportingStorageSeamsContext = createContext<SportingStorageSeams | null>(null);

/**
 * The three sporting seams to use. Always defined: the Web default stands in
 * when nothing was composed, so no consumer has to know whether a native
 * composition exists.
 */
export function useSportingStorageSeams(): SportingStorageSeams {
  return useContext(SportingStorageSeamsContext) ?? WEB_DEFAULT_SPORTING_SEAMS;
}

/** Non-null only where a composition is actually mounted. Exported for tests
 * and assertions that need to prove which branch a tree took. */
export function useComposedSportingStorageSeams(): SportingStorageSeams | null {
  return useContext(SportingStorageSeamsContext);
}

export function SportingStorageSeamsProvider({
  seams,
  children,
}: {
  seams: SportingStorageSeams;
  children: ReactNode;
}) {
  return (
    <SportingStorageSeamsContext.Provider value={seams}>
      {children}
    </SportingStorageSeamsContext.Provider>
  );
}
