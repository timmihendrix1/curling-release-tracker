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
} from "../../lib/identity/identityRuntime";
import IdentityGateScreen from "./IdentityGateScreen";

export type GateSession = RuntimeGateSession;

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
  /** Test-only composition seam. Production always uses the page-scoped runtime. */
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
  // Explicit sign-out removes the ordinary intent before trusted-state removal.
  return outcome.kind === "signed_out_locked" || outcome.kind === "trusted_state_not_invalidated";
}

/**
 * The application-level identity owner from ADR-0025. It renders the sporting
 * application only after the reducer has accepted a ready verdict. Every other
 * state renders the gate, so sporting repositories cannot hydrate behind it.
 */
export default function IdentityProvider({ children, runtime: injectedRuntime }: IdentityProviderProps) {
  const [runtime] = useState<IdentityRuntime>(() => injectedRuntime ?? getIdentityRuntime());
  const [state, setState] = useState<GateState>(() =>
    runtime.status === "ready" ? { kind: "intaking_oauth_return" } : { kind: "cloud_unavailable" }
  );
  const stateRef = useRef(state);
  const [emailForOtp, setEmailForOtp] = useState("");
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null);
  const deliberateSignOutRef = useRef(false);
  const revalidationRef = useRef<Promise<void> | null>(null);

  const commit = useCallback((event: GateEvent) => {
    setState((current) => {
      // Imported lazily below through the ordinary static module binding; this
      // helper keeps every state write on the pure reducer.
      const next = reduceGateState(current, event);
      stateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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
      const captureOutcome = await runtime.captureCurrentDeepLinkIntent();
      if (!active) return;
      if (captureOutcome.kind === "blocked") {
        commit({
          type: "transition_settled",
          outcome: { kind: "intent_state_not_persisted" },
        });
        return;
      }
      if (captureOutcome.kind === "captured") setPendingIntent(captureOutcome.intent);

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
  }, [commit, runtime]);

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
        void runtime.coordinator.invalidateIdentity().then((outcome) => {
          if (!active) return;
          commit({ type: "transition_settled", outcome });
          if (outcomeProvesIntentRemoval(outcome)) setPendingIntent(null);
        });
      });
    } catch {
      // Without the sole provider-event subscription, a later server sign-out
      // could not revoke an already-mounted shell. Deny through the coordinator
      // so the failure cannot degrade into an unmonitored ready state.
      void runtime.coordinator.invalidateIdentity().then((outcome) => {
        if (!active) return;
        commit({ type: "transition_settled", outcome });
        if (outcomeProvesIntentRemoval(outcome)) setPendingIntent(null);
      });
    }
    return () => {
      active = false;
      unsubscribe();
    };
  }, [commit, runtime]);

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
      const work = readyRuntime.coordinator.revalidateGateFacts().then((outcome) => {
        commit({ type: "transition_settled", outcome });
        if (outcomeProvesIntentRemoval(outcome)) setPendingIntent(null);
      });
      revalidationRef.current = work.finally(() => {
        revalidationRef.current = null;
      });
      return revalidationRef.current;
    },
    [commit]
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
    if (state.kind !== "ready_online" && state.kind !== "ready_offline") return;
    let active = true;
    void runtime.loadPendingIntent().then((intent) => {
      if (active) setPendingIntent(intent);
    });
    return () => {
      active = false;
    };
  }, [runtime, state.kind]);

  const session = readySession(state);

  const value = useMemo<IdentityContextValue>(() => {
    const coordinator = runtime.status === "ready" ? runtime.coordinator : null;

    return {
      state,
      session,
      pendingIntent,
      emailForOtp,
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
          if (outcomeProvesIntentRemoval(outcome)) setPendingIntent(null);
        } finally {
          deliberateSignOutRef.current = false;
        }
      },
      async recoverInvitationAccount() {
        if (coordinator === null || pendingIntent?.kind !== "invitation") return;
        const outcome = await coordinator.recoverInvitationAccount(pendingIntent);
        commit({ type: "transition_settled", outcome });
      },
      async discardPendingIntent() {
        if (coordinator === null) return false;
        const outcome = await coordinator.discardPendingIntent();
        if (outcome.kind !== "applied" && outcome.kind !== "not_required") return false;
        setPendingIntent(null);
        return true;
      },
    };
  }, [commit, emailForOtp, pendingIntent, runtime, session, state]);

  return (
    <IdentityContext.Provider value={value}>
      {session === null ? <IdentityGateScreen /> : children}
    </IdentityContext.Provider>
  );
}
