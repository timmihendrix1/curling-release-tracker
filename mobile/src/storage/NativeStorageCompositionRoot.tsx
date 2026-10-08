// The lazily-loaded native-storage composition root — Stage M3b3.
//
// This module is the ONLY thing that pulls the composition implementation, the
// native SQLite adapter and the protected credential store into a bundle, and it
// is reached exclusively through `MobileApp.tsx`'s build-time conditional import.
// A default build folds that conditional away, so none of it — no SQLite, no
// secure-storage plugin, no application database name — reaches the artifact
// (`mobile/__tests__/bundle.test.ts`).
//
// It wraps the whole provider tree rather than sitting beside it, which is what
// makes readiness gating structural: until the composition is ready, its
// children do not exist, so nothing can hydrate, restore a session, initialise
// the sync manager or retire anything.
import { useCallback, type ReactNode } from "react";
import StorageCompositionGate from "../../../src/components/persistence/StorageCompositionGate";
import { composeProductionNativeStorage } from "./nativeStorageComposition";
import type { StorageCompositionState } from "../../../src/lib/persistence/storageComposition";

export type NativeStorageCompositionRootProps = {
  children: ReactNode;
  /**
   * Test-only composition seam, matching `IdentityProvider`'s `runtime?` prop
   * convention. Production passes nothing and gets
   * `composeProductionNativeStorage`, whose activation authority is always
   * unavailable.
   */
  compose?: () => Promise<StorageCompositionState>;
};

export default function NativeStorageCompositionRoot({
  children,
  compose: injectedCompose,
}: NativeStorageCompositionRootProps) {
  // Stable across renders so the gate's effect does not treat a re-render as a
  // new generation and start a second composition attempt.
  const compose = useCallback(
    () => (injectedCompose ?? composeProductionNativeStorage)(),
    [injectedCompose]
  );

  return <StorageCompositionGate compose={compose}>{children}</StorageCompositionGate>;
}
