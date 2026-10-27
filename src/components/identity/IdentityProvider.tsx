"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getIdentityRuntime,
  reduceGateState,
  type GateEvent,
  type GateSession as RuntimeGateSession,
  type GateState,
  type IdentityRuntime,
  type IdentityRuntimeReady,
  type PendingIntent,
  type AccountDeletionService,
  type AccountDeletionState,
  type AccountDeletionResult,
} from "../../lib/identity/identityRuntime";
import IdentityGateScreen from "./IdentityGateScreen";
import AccountDeletionFlow from "./AccountDeletionFlow";
import { useSportingStorageSeams } from "../persistence/storageCompositionContext";
import { readProfileSportingExport } from "../../lib/persistence/profileScopedSportingPersistence";
import { useNativeApplicationComposition } from "../persistence/nativeApplicationContext";

export type GateSession = RuntimeGateSession;
export type { AccountDeletionState, AccountDeletionResult };
export type AccountDeletionActions = Omit<AccountDeletionService, "cancel"> & {
  cancel(expectedRequestId: string, onCurrentResult?: (result: AccountDeletionResult<boolean>) => void): Promise<AccountDeletionResult<boolean>>;
  exportPersonal(profileId: string): Promise<AccountDeletionResult<string>>;
  /** Native-only, one-way retirement of this export's original presentation
   * owner. Cannot admit identity, read data, or authorize another operation. */
  captureNativeExportRetirement?(profileId: string): Readonly<{ isRetired(): boolean }>;
};

export type IdentityContextValue = {
  state: GateState;
  session: GateSession | null;
  pendingIntent: PendingIntent | null;
  emailForOtp: string;
  startGoogleSignIn(): Promise<void>;
  requestEmailOtp(email: string): Promise<void>;
  verifyEmailOtp(token: string): Promise<void>;
  submitOnboarding(input: {
    displayName: string;
    termsAccepted: boolean;
    privacyAcknowledged: boolean;
  }): Promise<void>;
  refreshLegalSnapshot(): Promise<void>;
  retryTrustedState(): Promise<void>;
  signOut(): Promise<void>;
  recoverInvitationAccount(): Promise<void>;
  discardPendingIntent(): Promise<boolean>;
  accountDeletion?: AccountDeletionActions;
  beginAccountDeletion?(): void;
};

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function useIdentity(): IdentityContextValue {
  const value = useContext(IdentityContext);
  if (value === null) {
    throw new Error("useIdentity must be used inside IdentityProvider.");
  }
  return value;
}

/** Presentational leaf components may render in isolation in component tests.
 * Production composition always supplies the provider at the root. */
export function useOptionalIdentity(): IdentityContextValue | null {
  return useContext(IdentityContext);
}

type IdentityProviderProps = {
  children: ReactNode;
  /** Explicit limited import recovery, reachable while ordinary access is gated. */
  accessRecovery?: ReactNode;
  /** Explicit native composition/test seam. The default uses the page-scoped runtime. */
  runtime?: IdentityRuntime;
};

function readySession(state: GateState): GateSession | null {
  return state.kind === "ready_online" || state.kind === "ready_offline"
    ? state.session
    : null;
}

function outcomeProvesIntentRemoval(outcome: {
  kind: string;
  outstanding?: readonly string[];
}): boolean {
  // Every server-driven invalidation carries the complete residue list. Absence
  // of the pending-intent residue is the proof that deletion completed.
  if (Array.isArray(outcome.outstanding)) {
    return !outcome.outstanding.includes("pending_intent");
  }
  // Successful server denial completed all required cleanup; unlike failed
  // reports it needs no residue array. Explicit sign-out also removes the
  // ordinary intent before trusted-state removal.
  return outcome.kind === "signed_out_locked" || outcome.kind === "trusted_state_not_invalidated";
}

/**
 * The application-level identity owner from ADR-0025. It renders the sporting
 * application only after the reducer has accepted a ready verdict. Every other
 * state renders the gate, so sporting repositories cannot hydrate behind it.
 */
export default function IdentityProvider({ children, runtime: injectedRuntime, accessRecovery }: IdentityProviderProps) {
  const nativeComposition = useNativeApplicationComposition();
  const [runtime] = useState<IdentityRuntime>(() => injectedRuntime ?? getIdentityRuntime());
  const [state, setState] = useState<GateState>(() =>
    runtime.status === "ready" ? { kind: "intaking_oauth_return" } : { kind: "cloud_unavailable" }
  );
  const stateRef = useRef(state);
  const [emailForOtp, setEmailForOtp] = useState("");
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null);
  const deliberateSignOutRef = useRef(false);
  const revalidationRef = useRef<Promise<void> | null>(null);
  const [deletionOwner, setDeletionOwner] = useState<GateSession | null>(null);
  const sportingStorage = useSportingStorageSeams();
  const appliedNativeDenials = useRef(new Set<string>());
  const intentProjection = useRef(0);
  const nativeActive = useRef(false);
  useEffect(() => {
    nativeActive.current = true;
    return () => { nativeActive.current = false; };
  }, []);

  const refreshNativeIntent = useCallback(async (isActive: () => boolean = () => true) => {
    if (!nativeComposition || runtime.status !== "ready") return;
    const version = ++intentProjection.current, owner = stateRef.current;
    const observed = await nativeComposition.observePendingIntent();
    if (nativeActive.current && isActive() && version === intentProjection.current && stateRef.current === owner && observed.kind === "known") setPendingIntent(observed.intent);
  }, [nativeComposition, runtime]);

  const commit = useCallback((event: GateEvent) => {
    if (nativeComposition && !nativeActive.current) return false;
    if (nativeComposition && event.type === "transition_settled" && event.outcome.transition && event.outcome.denial) {
      const outcome = event.outcome;
      // Only presentation idempotence for genuine native reports. The first
      // begun denial ALWAYS reaches the reducer, regardless of sequence.
      const completion = JSON.stringify([outcome.transition, outcome.kind, outcome.denial, "outstanding" in outcome ? outcome.outstanding : null]);
      if (appliedNativeDenials.current.has(completion)) return false;
      appliedNativeDenials.current.add(completion);
    }
    // Retire observation/action ownership synchronously with the event, even
    // while React batches rendering. No queued callback may still see the
    // previous ready owner after a newer authentication transition has begun.
    const next = reduceGateState(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    return true;
  }, [nativeComposition]);

  useEffect(() => {
    if (!nativeComposition) return;
    let active = true;
    const unsubscribe = nativeComposition.subscribeToIdentityInvalidations(outcome => {
      if (!active || !commit({ type: "transition_settled", outcome })) return;
      // Old successful removal is not proof about a newer link. Re-read the
      // actual repository with separate projection ownership instead.
      if (outcomeProvesIntentRemoval(outcome)) return refreshNativeIntent(() => active);
    });
    return () => { active = false; unsubscribe(); };
  }, [nativeComposition, commit, refreshNativeIntent]);

  useEffect(() => {
    if (!nativeComposition) return;
    let active = true;
    const unsubscribe = nativeComposition.subscribeToPendingIntentChanges(() => refreshNativeIntent(() => active));
    return () => { active = false; unsubscribe(); };
  }, [nativeComposition, refreshNativeIntent]);

  useEffect(() => {
    if (runtime.status !== "ready") return;
    let active = true;

    const unsubscribeProgress = runtime.subscribeToProgress((phase, transition) => {
      if (active) commit({ type: "progress", phase, transition });
    });

    // `startUpOnce()` synchronously performs Phase 0 before returning its shared
    // promise. Starting it before intent capture guarantees OAuth-owned URL data
    // is cleaned before the first asynchronous operation.
    const startup = runtime.startUpOnce();
    void (async () => {
      // Do not expose a sign-in action until a Team intent is either durably
      // captured or proven absent/invalid. Otherwise a fast startup could let a
      // redirect begin while the link is still only in the URL.
      ++intentProjection.current;
      const captureOutcome = await runtime.captureCurrentDeepLinkIntent();
      if (!active) return;
      if (captureOutcome.kind === "not_captured" && (!nativeComposition || nativeComposition.getTeamLinkDeliverySnapshot().kind === "inactive")) {
        commit({ type: "transition_settled", outcome: { kind: "intent_state_not_persisted" } }); return;
      }
      // Genuine native not_captured keeps the original startup/debt recovery reachable.
      // Its source-owned notice never claims the valid refused link was kept.
      if (captureOutcome.kind === "blocked") {
        commit({
          type: "transition_settled",
          outcome: { kind: "intent_state_not_persisted" },
        });
        return;
      }
      if (captureOutcome.kind === "captured" && !nativeComposition) setPendingIntent(captureOutcome.intent);

      const outcome = await startup;
      if (!active) return;
      commit({
        type: "startup_completed",
        callback: outcome.callback,
        verdict: outcome.verdict,
        finalization: outcome.finalization,
        transition: outcome.transition,
      });
    })();

    return () => {
      active = false;
      unsubscribeProgress();
    };
  }, [commit, runtime, nativeComposition]);

  useEffect(() => {
    if (runtime.status !== "ready") return;
    let active = true;
    let unsubscribe = () => {};
    try {
      unsubscribe = runtime.subscribeToAuthChanges((change) => {
        if (!active) return;
        commit({ type: "provider_auth_change", change });
        if (runtime.coordinator.classifyAuthChange(change).kind !== "invalidation_required") return;
        // Explicit sign-out already established its own durable denial before the
        // provider emits SIGNED_OUT. Starting a second invalidation would only
        // supersede the transition that owns that denial.
        if (deliberateSignOutRef.current) return;
        void runtime.coordinator.invalidateIdentity().then(async (outcome) => {
          if (!active) return;
          commit({ type: "transition_settled", outcome });
          if (outcomeProvesIntentRemoval(outcome)) { if (nativeComposition) await refreshNativeIntent(() => active); else setPendingIntent(null); }
        });
      });
    } catch {
      // Without the sole provider-event subscription, a later server sign-out
      // could not revoke an already-mounted shell. Deny through the coordinator
      // so the failure cannot degrade into an unmonitored ready state.
      void runtime.coordinator.invalidateIdentity().then(async (outcome) => {
        if (!active) return;
        commit({ type: "transition_settled", outcome });
        if (outcomeProvesIntentRemoval(outcome)) { if (nativeComposition) await refreshNativeIntent(() => active); else setPendingIntent(null); }
      });
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, [commit, runtime, nativeComposition, refreshNativeIntent]);

  useEffect(() => {
    if (runtime.status !== "ready") return;
    let active = true;
    const unsubscribe = runtime.subscribeToBarrierChanges(() => {
      void runtime.coordinator.observeNewerBarrier().then((observation) => {
        if (active && observation.kind === "newer_barrier") {
          commit({ type: "newer_barrier_observed" });
        }
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [commit, runtime]);

  const revalidate = useCallback(
    async (readyRuntime: IdentityRuntimeReady) => {
      if (revalidationRef.current !== null) return revalidationRef.current;
      const work = readyRuntime.coordinator.revalidateGateFacts().then(async (outcome) => {
        commit({ type: "transition_settled", outcome });
        if (outcomeProvesIntentRemoval(outcome)) { if (nativeComposition) await refreshNativeIntent(); else setPendingIntent(null); }
      });
      revalidationRef.current = work.finally(() => {
        revalidationRef.current = null;
      });
      return revalidationRef.current;
    },
    [commit, nativeComposition, refreshNativeIntent]
  );

  useEffect(() => {
    if (runtime.status !== "ready") return;
    const onOnline = () => {
      if (stateRef.current.kind === "ready_online" || stateRef.current.kind === "ready_offline") {
        void revalidate(runtime);
      }
    };
    window.addEventListener("online", onOnline);
    if (state.kind === "ready_offline" && navigator.onLine) void revalidate(runtime);
    return () => window.removeEventListener("online", onOnline);
  }, [revalidate, runtime, state.kind]);

  useEffect(() => {
    if (runtime.status !== "ready") return;
    if (nativeComposition) return;
    if (state.kind !== "ready_online" && state.kind !== "ready_offline") return;
    let active = true;
    const version = ++intentProjection.current, owner = stateRef.current;
    void runtime.loadPendingIntent().then((intent) => {
      if (active && (!nativeComposition || (version === intentProjection.current && stateRef.current === owner))) setPendingIntent(intent);
    });
    return () => {
      active = false;
    };
  }, [runtime, state.kind, nativeComposition]);

  useEffect(() => {
    if (!nativeComposition || !["ready_online", "ready_offline", "signed_out", "locked", "quarantined_locked", "storage_unavailable_locked", "identity_unconfirmed", "recoverable_error", "onboarding_required", "awaiting_otp"].includes(state.kind)) return;
    let active = true;
    void refreshNativeIntent(() => active);
    return () => { active = false; };
  }, [nativeComposition, state, refreshNativeIntent]);

  const session = readySession(state);
  // Export has its own exact ready owner. This does not replace/reparent the
  // already-mounted inner Tracker binding retained during Q1.
  const nativeExportBinding = useMemo(() => nativeComposition && session ? nativeComposition.bindProfile(session.profileId) : null, [nativeComposition, session]);

  const value = useMemo<IdentityContextValue>(() => {
    const coordinator = runtime.status === "ready" ? runtime.coordinator : null;
    const nativeFacadeCurrent = () => !nativeComposition || (nativeActive.current && stateRef.current === state);
    async function denyPending(pending: AccountDeletionState) {
      const current = readySession(stateRef.current);
      if (!coordinator || !current || current.profileId !== pending.profileId) return;
      try {
        const denied = await coordinator.invalidateIdentity();
        commit({ type: "transition_settled", outcome: denied });
      } catch {
        commit({ type: "transition_settled", outcome: { kind: "durable_denial_unavailable",
          denial: "durable_denial_unavailable", outstanding: ["durable_barrier", "trusted_state"] } });
      }
    }
    function pendingMonitor() {
      const owner = stateRef.current;
      let observed = false;
      let denial = Promise.resolve();
      return {
        onPending(pending: AccountDeletionState) {
          if (nativeComposition && !nativeActive.current) return false;
          if (stateRef.current !== owner) return false;
          const admitted = readySession(owner);
          if (admitted && admitted.profileId !== pending.profileId) return false;
          observed = true;
          denial = denyPending(pending);
          return true;
        },
        async settle(pending: AccountDeletionState) {
          if (!observed && !this.onPending(pending)) return false;
          await denial;
          if (nativeComposition && !nativeActive.current) return false;
          return true;
        },
      };
    }

    return {
      state,
      session,
      pendingIntent,
      emailForOtp,
      beginAccountDeletion() {
        if (!nativeFacadeCurrent()) return;
        const current = readySession(stateRef.current);
        if (current !== null) setDeletionOwner(current);
      },
      ...(runtime.status === "ready" && runtime.accountDeletion ? {
        accountDeletion: {
          ...runtime.accountDeletion,
          ...(nativeComposition ? {
            captureNativeExportRetirement(expectedProfileId: string) {
              const original = session, binding = nativeExportBinding;
              let retired = false;
              const isRetired = () => {
                if (retired) return true;
                try {
                  retired = !nativeFacadeCurrent() || !original || original.profileId !== expectedProfileId ||
                    readySession(stateRef.current) !== original || !binding || nativeComposition.bindProfile(expectedProfileId) !== binding;
                } catch { retired = true; }
                return retired;
              };
              isRetired();
              return Object.freeze({ isRetired });
            },
          } : {}),
          async exportCloud(expectedProfileId: string) {
            const owner = readySession(stateRef.current);
            if (nativeComposition && (!nativeFacadeCurrent() || owner !== session || owner?.profileId !== expectedProfileId)) return { ok: false as const, error: "account_changed" as const };
            const result = await runtime.accountDeletion!.exportCloud(expectedProfileId);
            if (nativeComposition && (!nativeActive.current || readySession(stateRef.current) !== owner)) return { ok: false as const, error: "account_changed" as const };
            return result;
          },
          async cancel(expectedRequestId: string, onCurrentResult?: (result: AccountDeletionResult<boolean>) => void) {
            if (!nativeFacadeCurrent()) return { ok: false as const, error: "account_changed" as const };
            const owner = stateRef.current;
            const result = await runtime.accountDeletion!.cancel(expectedRequestId);
            // Server completion may stand, but it cannot start a foreground
            // continuation after another identity transition took ownership.
            if ((nativeComposition && !nativeActive.current) || stateRef.current !== owner) return { ok: false as const, error: "account_changed" as const };
            try { onCurrentResult?.(result); } catch { /* Presentation cannot change server completion. */ }
            if ((nativeComposition && !nativeActive.current) || stateRef.current !== owner) return { ok: false as const, error: "account_changed" as const };
            if (result.ok && result.value) {
              // Invoke under the same proof, before yielding: a UI continuation
              // after another awaited Promise would reopen an ownership gap.
              const continuation = runtime.coordinator.retryTrustedStateEstablishment();
              const outcome = await continuation;
              commit({ type: "transition_settled", outcome });
            }
            return result;
          },
          async getState() {
            if (!nativeFacadeCurrent()) return { ok: false as const, error: "account_changed" as const };
            const pending = pendingMonitor();
            const result = await runtime.accountDeletion!.getState(pending.onPending);
            if (result.ok && result.value !== null) {
              if (!await pending.settle(result.value)) return { ok: false as const, error: "account_changed" as const };
              const current = readySession(stateRef.current);
              if (current && current.profileId !== result.value.profileId) return { ok: false as const, error: "account_changed" as const };
            }
            return result;
          },
          async request(expectedProfileId: string) {
            if (!nativeFacadeCurrent()) return { ok: false as const, error: "account_changed" as const };
            const current = readySession(stateRef.current);
            if (!current || current.profileId !== expectedProfileId) return { ok: false as const, error: "account_changed" as const };
            // The service persists its subject guard before this transition and
            // before HTTP. Ordinary authentication cannot resolve that guard.
            const pending = pendingMonitor();
            let mutationBegun = false;
            const result = await runtime.accountDeletion!.request(expectedProfileId, async () => {
              if ((nativeComposition && !nativeActive.current) || readySession(stateRef.current) !== current) return false;
              const denied = await runtime.coordinator.invalidateIdentity();
              commit({ type: "transition_settled", outcome: denied });
              if (nativeComposition && !nativeActive.current) return false;
              mutationBegun = denied.kind === "identity_invalidated";
              return mutationBegun;
            }, pending.onPending);
            if (nativeComposition && !nativeActive.current) return { ok: false as const, error: "account_changed" as const };
            if (result.ok && !mutationBegun && !await pending.settle(result.value)) return { ok: false as const, error: "account_changed" as const };
            return result;
          },
          async exportPersonal(expectedProfileId: string) {
            if (!nativeFacadeCurrent()) return { ok: false as const, error: "account_changed" as const };
            const owner = readySession(stateRef.current);
            if (owner?.profileId !== expectedProfileId) return { ok: false as const, error: "account_changed" as const };
            if (nativeComposition && owner !== session) return { ok: false as const, error: "account_changed" as const };
            if (nativeComposition && !nativeExportBinding) return { ok: false as const, error: "unavailable" as const };
            const local = nativeComposition ? await nativeExportBinding!.application.readPersonalExport()
              : await readProfileSportingExport(expectedProfileId, sportingStorage.createSportingSyncStateAdapter(expectedProfileId));
            if (!local.ok) return { ok: false as const, error: "unavailable" as const };
            if (nativeComposition && (!nativeActive.current || readySession(stateRef.current) !== owner)) return { ok: false as const, error: "account_changed" as const };
            const cloud = await runtime.accountDeletion!.exportCloud(expectedProfileId);
            if (!cloud.ok) return cloud;
            if ((nativeComposition && !nativeActive.current) || readySession(stateRef.current) !== owner) return { ok: false as const, error: "account_changed" as const };
            return { ok: true as const, value: JSON.stringify({ schemaVersion: 1, format: "personal-data-export",
              scope: "cloud-and-this-device; local-only-work-on-other-devices-is-not-included",
              cloud: cloud.value, local: local.records }, null, 2) };
          },
        },
      } : {}),
      async startGoogleSignIn() {
        if (coordinator === null) return;
        const outcome = await coordinator.startGoogleSignIn();
        commit({ type: "transition_settled", outcome });
      },
      async requestEmailOtp(email: string) {
        if (coordinator === null) return;
        setEmailForOtp(email);
        const outcome = await coordinator.requestEmailOtp(email);
        commit({ type: "transition_settled", outcome });
      },
      async verifyEmailOtp(token: string) {
        if (coordinator === null || emailForOtp.length === 0) return;
        const outcome = await coordinator.verifyEmailOtp(emailForOtp, token);
        commit({ type: "transition_settled", outcome });
      },
      async submitOnboarding(input) {
        if (coordinator === null) return;
        const current = stateRef.current;
        if (current.kind !== "onboarding_required") return;
        if (!input.termsAccepted || !input.privacyAcknowledged) return;
        if (current.legal.terms === null || current.legal.privacy === null) return;
        const outcome = await coordinator.submitOnboarding({
          displayName: input.displayName,
          terms: current.legal.terms,
          privacy: current.legal.privacy,
        });
        commit({ type: "onboarding_settled", outcome });
      },
      async refreshLegalSnapshot() {
        if (coordinator === null) return;
        const outcome = await coordinator.refreshLegalSnapshot();
        commit({ type: "legal_refreshed", outcome });
      },
      async retryTrustedState() {
        if (coordinator === null) return;
        const outcome = await coordinator.retryTrustedStateEstablishment();
        commit({ type: "transition_settled", outcome });
      },
      async signOut() {
        if (coordinator === null) return;
        deliberateSignOutRef.current = true;
        try {
          const outcome = await coordinator.signOut();
          commit({ type: "transition_settled", outcome });
          if (outcomeProvesIntentRemoval(outcome)) { if (nativeComposition) await refreshNativeIntent(); else setPendingIntent(null); }
        } finally {
          deliberateSignOutRef.current = false;
        }
      },
      async recoverInvitationAccount() {
        if (coordinator === null || pendingIntent?.kind !== "invitation") return;
        if (!nativeFacadeCurrent()) return;
        // The coordinator has already persisted this deliberate recovery denial
        // before provider SIGNED_OUT. A second denial would erase its one
        // approved surviving invitation and supersede the recovery transition.
        deliberateSignOutRef.current = true;
        try {
          const outcome = nativeComposition ? await nativeComposition.recoverInvitationAccount(pendingIntent) : await coordinator.recoverInvitationAccount(pendingIntent);
          if (outcome === null) return;
          commit({ type: "transition_settled", outcome });
        } finally {
          deliberateSignOutRef.current = false;
        }
      },
      async discardPendingIntent() {
        if (coordinator === null) return false;
        if (nativeComposition) {
          if (!pendingIntent || !nativeFacadeCurrent()) return false;
          const removed = await nativeComposition.discardPendingIntent(pendingIntent);
          if (removed && nativeFacadeCurrent()) await refreshNativeIntent();
          return removed;
        }
        const outcome = await coordinator.discardPendingIntent();
        if (outcome.kind !== "applied" && outcome.kind !== "not_required") return false;
        setPendingIntent(null);
        return true;
      },
    };
  }, [commit, emailForOtp, pendingIntent, runtime, session, state, sportingStorage, nativeComposition, nativeExportBinding, refreshNativeIntent]);

  return (
    <IdentityContext.Provider value={value}>
      <AccountDeletionFlow owner={nativeComposition && deletionOwner !== session ? null : deletionOwner} onClose={() => setDeletionOwner(null)}>
        {session === null ? <IdentityGateScreen /> : children}
      </AccountDeletionFlow>
      {accessRecovery}
    </IdentityContext.Provider>
  );
}
