"use client";
// Shared genuine native composition. Only the explicit new-user beta build
// selects it from the mobile root; transfer remains a separate local workflow.
// The host must be constructed once outside React; this tree never disposes it.
import { useState } from "react";
import type { NativeSportingIdentityRuntimeReady } from "../../lib/supabase/supabaseAuthService";
import { authenticateNativeTrackerRuntime, bindNativeTrackerRuntime, resolveNativeApplicationComposition } from "../../lib/persistence/nativeTrackerRegistry";
import IdentityProvider, { useIdentity } from "../identity/IdentityProvider";
import { ProfileScopedSportingPersistence } from "../ProfileScopedSportingPersistence";
import TrackerApp from "../TrackerApp";
import { NativeTrackerProvider } from "./nativeTrackerContext";
import { NativeApplicationProvider } from "./nativeApplicationContext";
function Unavailable() { return <section role="alert">Training data is unavailable. Access must be checked before training can start.</section>; }
function AdmittedTracker({ runtime }: { runtime: NativeSportingIdentityRuntimeReady }) {
  const { session } = useIdentity();
  // Created only after the actual Provider's genuine startup/OTP admission.
  // Hold that same binding while Q1 retires ordinary manager access.
  const [binding] = useState(() => session ? bindNativeTrackerRuntime(runtime, session.profileId) : null);
  if (!binding || !session || binding.profileId !== session.profileId) return <Unavailable />;
  return <NativeTrackerProvider binding={binding}><ProfileScopedSportingPersistence profileId={binding.profileId}><TrackerApp /></ProfileScopedSportingPersistence></NativeTrackerProvider>;
}
export function DormantNativeTrackerComposition({ runtime }: { runtime: NativeSportingIdentityRuntimeReady }) {
  const [originalRuntime] = useState(() => runtime);
  // Membership check precedes ANY runtime property read or Provider invocation.
  if (runtime !== originalRuntime || !authenticateNativeTrackerRuntime(runtime)) return <Unavailable />;
  const composition = resolveNativeApplicationComposition(runtime);
  if (!composition) return <Unavailable />;
  return <NativeApplicationProvider composition={composition}><IdentityProvider runtime={runtime}><AdmittedTracker runtime={runtime} /></IdentityProvider></NativeApplicationProvider>;
}
