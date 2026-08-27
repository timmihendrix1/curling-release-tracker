"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createProfileScopedSportingRepositories,
  createUnscopedSportingRepositoriesForTests,
  retireLegacyUnscopedSportingData,
  type SportingRepositories,
} from "../lib/persistence/profileScopedSportingPersistence";
import { createProfileScopedSportingStorageAdapter } from "../lib/persistence/profileScopedSportingPersistence";
import { createSportingSyncStateRepository } from "../lib/cloudSporting/syncStateRepository";
import { SportingCloudSyncManager, type SportingSyncSnapshot } from "../lib/cloudSporting/syncManager";
import { resolveCloudConfig } from "../lib/supabase/config";
import { getSupabaseBrowserClient } from "../lib/supabase/supabaseClient";
import { createSupabaseSportingCloudService } from "../lib/supabase/supabaseSportingCloudService";
import { useIdentity } from "./identity/IdentityProvider";

const SportingPersistenceContext = createContext<SportingRepositories | null>(null);
const SportingProfileIdContext = createContext<string | null>(null);
type SportingCloudSyncContextValue = SportingSyncSnapshot & { retry(): void };
const SportingCloudSyncContext = createContext<SportingCloudSyncContextValue | null>(null);
let unscopedTestRepositories: SportingRepositories | null = null;

export function useSportingRepositories(): SportingRepositories {
  const repositories = useContext(SportingPersistenceContext);
  if (repositories !== null) return repositories;

  // Keeps the pre-B0.3 component suite focused on TrackerApp behaviour without a
  // production-reachable bypass. Production composition must always provide a Profile.
  if (process.env.NODE_ENV === "test") {
    unscopedTestRepositories ??= createUnscopedSportingRepositoriesForTests();
    return unscopedTestRepositories;
  }
  throw new Error("Sporting persistence requires an authenticated Profile scope.");
}

export function useSportingProfileId(): string {
  const profileId = useContext(SportingProfileIdContext);
  if (profileId !== null) return profileId;
  if (process.env.NODE_ENV === "test") {
    return "00000000-0000-4000-8000-000000000001";
  }
  throw new Error("Sporting execution requires an authenticated Profile scope.");
}

export function useSportingCloudSync(): SportingCloudSyncContextValue | null {
  return useContext(SportingCloudSyncContext);
}

type ProfileScopeProps = {
  profileId: string;
  children: ReactNode;
};

function ProfileScopedSportingPersistenceInstance({
  profileId,
  children,
}: ProfileScopeProps) {
  const baseRepositories = useMemo(
    () => createProfileScopedSportingRepositories(profileId),
    [profileId]
  );
  const manager = useMemo(() => {
    const adapter = createProfileScopedSportingStorageAdapter(profileId);
    const config = resolveCloudConfig();
    const service = config.status === "configured"
      ? createSupabaseSportingCloudService(getSupabaseBrowserClient(config))
      : null;
    return new SportingCloudSyncManager(
      baseRepositories,
      createSportingSyncStateRepository(adapter),
      service
    );
  }, [baseRepositories, profileId]);
  const repositories = useMemo(() => manager.decorateRepositories(), [manager]);
  const [syncSnapshot, setSyncSnapshot] = useState<SportingSyncSnapshot>(manager.getSnapshot());
  const [attempt, setAttempt] = useState(0);
  const [retirementState, setRetirementState] = useState<
    "retiring" | "ready" | "failed"
  >("retiring");
  const retirementPromiseRef = useRef<ReturnType<typeof retireLegacyUnscopedSportingData> | null>(
    null
  );

  useEffect(() => {
    let active = true;
    retirementPromiseRef.current ??= retireLegacyUnscopedSportingData();
    void retirementPromiseRef.current.then(async (result) => {
      if (!active) return;
      if (!result.ok) {
        setRetirementState("failed");
        return;
      }
      await manager.initialize();
      if (active) setRetirementState("ready");
    });
    return () => {
      active = false;
    };
  }, [attempt, manager]);

  useEffect(() => manager.subscribe(() => setSyncSnapshot(manager.getSnapshot())), [manager]);

  useEffect(() => {
    if (retirementState !== "ready") return;
    const synchronize = () => void manager.synchronize();
    window.addEventListener("online", synchronize);
    return () => window.removeEventListener("online", synchronize);
  }, [manager, retirementState]);

  if (retirementState === "retiring") {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-950">Preparing your training data</h1>
        <p className="mt-2 text-sm text-slate-600">Setting up this Profile&apos;s private workspace.</p>
      </section>
    );
  }

  if (retirementState === "failed") {
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm" role="alert">
        <h1 className="text-lg font-semibold text-amber-950">Training data is unavailable</h1>
        <p className="mt-2 text-sm text-amber-900">
          This Profile&apos;s private workspace could not be prepared. No training data has been opened.
        </p>
        <button
          type="button"
          className="mt-4 min-h-11 rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white"
          onClick={() => {
            retirementPromiseRef.current = null;
            setRetirementState("retiring");
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  return (
    <SportingProfileIdContext.Provider value={profileId}>
      <SportingCloudSyncContext.Provider value={{
        ...syncSnapshot,
        retry: () => void manager.retry(),
      }}>
        <SportingPersistenceContext.Provider value={repositories}>
          {children}
        </SportingPersistenceContext.Provider>
      </SportingCloudSyncContext.Provider>
    </SportingProfileIdContext.Provider>
  );
}

export function ProfileScopedSportingPersistence(props: ProfileScopeProps) {
  return <ProfileScopedSportingPersistenceInstance key={props.profileId} {...props} />;
}

export default function AuthenticatedSportingPersistence({ children }: { children: ReactNode }) {
  const { session } = useIdentity();
  if (session === null) {
    throw new Error("The identity gate must establish a Profile before sporting persistence mounts.");
  }

  // The key forces a complete application-state and repository remount on an account
  // switch. No state or delayed repository closure from the former Profile is reused.
  return (
    <ProfileScopedSportingPersistence profileId={session.profileId}>
      {children}
    </ProfileScopedSportingPersistence>
  );
}
