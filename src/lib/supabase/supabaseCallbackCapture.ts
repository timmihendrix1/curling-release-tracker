// The page-scoped, single-use OAuth callback capture cell (ADR-0025
// Decision 11). SDK-free: it reads and rewrites the current URL and holds one
// classified candidate for the lifetime of one document. It knows nothing of
// identity barriers, attempts, resolutions, Phase 0 admission, or correlation —
// all of that is coordinator-owned.
//
// Why a cell rather than "read window.location when needed": the first
// initialization CLEANS the URL, so every later reader — including React Strict
// Mode's replayed effect setup — would find a clean URL and conclude that no
// callback arrived, locking a legitimate user out. The cell is therefore the
// single source of truth for "what did this page load arrive with".
//
// **React effect disposal must not end the capture.** Disposing an abandoned
// Strict Mode setup pass prevents a stale state dispatch, but the committed pass
// must still be able to claim the candidate. Disposal therefore has no automatic
// access to any ending operation: there is no `dispose`/`destroy`/`reset`/
// `clear` member, and cleanup code would have to call the explicitly named
// terminal operation on purpose. Terminal finalization and effect disposal are
// separate things and must stay separate.
//
// **Where the authorization code lives, stated exactly, because getting this
// wrong in either direction breaks the flow.** There are four distinct steps,
// and claiming is NOT one of the ending ones:
//
//   1. **Captured, unclaimed.** The cell owns the code in its own internal slot.
//      Nothing outside this module can read it.
//   2. **Claimed — a one-time TRANSFER, not a drop.** The single claim moves the
//      code out of the cell's slot and into the issued `ClaimedCallback`'s
//      closure. The cell's slot is emptied and every later claim resolves
//      `no_claim`, but the issued claim REMAINS ABLE to yield the code once —
//      it must, or the exchange it was claimed for could never happen. Claiming
//      does not finalize the cell and does not revoke the claim it just issued.
//   3. **Consumed.** `readAuthorizationCode()` returns the code on its first
//      call and `null` on every later one, so the claim becomes spent by
//      ordinary use and a replayed exchange reaches no provider.
//   4. **Explicitly finalized.** `finalizeTerminalCallbackOutcome()` — and only
//      that call — ends the page scope: it drops the retained candidate AND
//      revokes an issued-but-unread claim, so afterwards there is no claim and
//      no callback secret anywhere in this scope. This is the only step that
//      takes the code away from a claim that has not used it yet, which is why
//      Stage B0.2c must call it only AFTER it is genuinely finished with the
//      callback — never before the exchange.
//
// Capture is invoked EXPLICITLY, from a guarded lifecycle boundary. It must
// never run during module import, during construction, or during React render
// — the first two would rewrite history as a side effect of loading a module,
// and the third would rewrite history as a render side effect.
import type { ClaimedCallback } from "./authService";
import { classifyCallbackUrl, cleanCallbackUrl } from "./supabaseCallbackClassifier";

/**
 * The publicly readable view of what this page load arrived with. It carries
 * the non-secret flow selector where one exists and **never** the
 * authorization code or any raw provider error value — those two never leave
 * this module except through a single claim, into the exchange boundary.
 */
export type CallbackCandidate =
  | { kind: "no_return" }
  | { kind: "success_candidate"; flowId: string }
  | { kind: "provider_error_candidate"; flowId: string }
  | { kind: "ambiguous_callback" }
  | { kind: "malformed_callback" };

export type CallbackClaim =
  | { kind: "claimed"; claim: ClaimedCallback }
  /** No candidate was captured, the candidate is not claimable (every shape
   * except a success candidate), it has already been claimed once, or the cell
   * has been explicitly finalized. */
  | { kind: "no_claim" };

/** The narrow window seam, injected so the pure lifecycle semantics are
 * testable without a real document and so no other module needs to touch
 * `history` directly. Either member may throw; the cell contains that. */
export type CallbackUrlAccess = {
  /** The current full URL, or `null` when there is no document (SSR). */
  readCurrentUrl(): string | null;
  /** Replaces the current history entry's URL. */
  replaceCurrentUrl(url: string): void;
};

export type CallbackCaptureCell = {
  /**
   * Reads, classifies and cleans the URL on the **first** call and returns the
   * captured candidate. Every later call returns that same candidate without
   * rereading the (now clean) URL — including React Strict Mode's replayed
   * setup, and including after a fail-closed capture or an explicit terminal
   * finalization.
   */
  initializeCallbackCapture(): CallbackCandidate;
  /** The captured candidate without consuming it. `null` when capture has not
   * been initialized in this page scope yet, and `null` again once the cell has
   * been explicitly finalized — in both cases there is nothing to act on. */
  peekCallbackCandidate(): CallbackCandidate | null;
  /**
   * Claims a success candidate for exactly one exchange, transferring the
   * authorization code into the returned claim. Every later call — and every
   * non-success shape, and any call after finalization — resolves `no_claim`.
   *
   * The issued claim stays usable: it yields the code once, on its own
   * `readAuthorizationCode()`. Claiming neither finalizes this cell nor revokes
   * the claim it just returned.
   */
  claimCallbackForExchange(): CallbackClaim;
  /**
   * Ends this page scope's capture **explicitly**. Named so it can never be
   * mistaken for, or wired up as, React effect cleanup: only a caller that has
   * genuinely finished with the callback (the future Phase 0 owner, after it has
   * acted on the candidate) calls this.
   *
   * Drops the retained candidate and revokes any authorization code still
   * readable through an already-issued claim, so after this call there is no
   * claim and no callback secret anywhere in this scope. Idempotent, rereads
   * nothing, and affects only this instance.
   *
   * This is provider-mechanics lifecycle only. It records no barrier, attempt,
   * resolution, or Phase 0 admission decision, and returns nothing a caller
   * could mistake for one.
   */
  finalizeTerminalCallbackOutcome(): void;
};

/** The production seam. `history.replaceState` (not a query wipe) is what
 * removes the owned material without adding a history entry the user could
 * navigate back into. */
export function browserCallbackUrlAccess(): CallbackUrlAccess {
  return {
    readCurrentUrl() {
      if (typeof window === "undefined") return null;
      return window.location.href;
    },
    replaceCurrentUrl(url: string) {
      if (typeof window === "undefined") return;
      window.history.replaceState(window.history.state, "", url);
    },
  };
}

/**
 * The cell's explicit lifecycle: `uncaptured` → `captured` → `finalized`.
 *
 * Only `captured` ever holds callback material, and it holds it only until the
 * single claim transfers it out — `authorizationCode` becomes `null` at that
 * point while the phase stays `captured`, because the candidate's non-secret
 * shape is still the honest answer to "what did this page load arrive with".
 * The phase becomes `finalized` only through an explicit
 * `finalizeTerminalCallbackOutcome()` call, never as a side effect of claiming.
 */
type CellState =
  | { phase: "uncaptured" }
  | {
      phase: "captured";
      candidate: CallbackCandidate;
      /** The cell's own copy: present until the single claim moves it into the
       * issued claim's closure, `null` from then on. */
      authorizationCode: string | null;
    }
  | { phase: "finalized" };

/** What a fail-closed capture reports. Deliberately the existing
 * `malformed_callback` shape rather than a new product outcome: ADR-0025 §D
 * already defines that branch as "no exchange, no identity", which is exactly
 * what an un-cleanable or unreadable URL must produce. It is non-claimable by
 * construction, and carries no code, no selector, and nothing about the
 * failure. */
const FAIL_CLOSED_CANDIDATE: CallbackCandidate = { kind: "malformed_callback" };

/**
 * Creates one capture cell. **A fresh instance represents a genuinely new
 * document/page scope** — a real new page load gets a new scope because the
 * module-level composition that owns the cell is re-evaluated. Nothing here is
 * durable: reloading the page and finding a clean URL correctly yields
 * `no_return`.
 */
export function createCallbackCaptureCell(
  access: CallbackUrlAccess = browserCallbackUrlAccess()
): CallbackCaptureCell {
  let state: CellState = { phase: "uncaptured" };
  let claimed = false;
  /** Revokes the code still readable through an already-issued claim, so
   * finalization can guarantee "no callback secret remains in this scope". */
  let revokeIssuedClaim: (() => void) | null = null;

  function capture(candidate: CallbackCandidate, authorizationCode: string | null): CallbackCandidate {
    state = { phase: "captured", candidate, authorizationCode };
    return candidate;
  }

  function initializeCallbackCapture(): CallbackCandidate {
    if (state.phase === "captured") return state.candidate;
    if (state.phase === "finalized") {
      // The page-scoped capture is spent. The neutral shape is returned WITHOUT
      // rereading the (already cleaned) URL, so a late or replayed caller can
      // neither resurrect the candidate nor mistake the clean URL for evidence
      // that a fresh callback arrived.
      return { kind: "no_return" };
    }

    let rawUrl: string | null;
    try {
      rawUrl = access.readCurrentUrl();
    } catch {
      // The current URL could not be read at all, so whether owned OAuth
      // material is present is unknowable. Failing closed is the only honest
      // answer: nothing is claimed to have been cleaned, and nothing is
      // claimable. The thrown value — Error or not — is discarded here and
      // never reaches a caller, a log, or an outcome.
      return capture(FAIL_CLOSED_CANDIDATE, null);
    }

    if (rawUrl === null) {
      // No document: nothing arrived and nothing can be cleaned. This is a
      // definite absence, not a failure.
      return capture({ kind: "no_return" }, null);
    }

    const shape = classifyCallbackUrl(rawUrl);

    // Cleanup runs here, synchronously, before this function returns — and
    // therefore strictly before any asynchronous provider, storage, session or
    // fetch work the caller goes on to do. It runs for EVERY classified shape,
    // not only the successful one.
    const cleanedUrl = cleanCallbackUrl(rawUrl);
    if (cleanedUrl !== rawUrl) {
      try {
        access.replaceCurrentUrl(cleanedUrl);
      } catch {
        // Owned OAuth material could NOT be removed from the visible URL. It
        // would be unsafe to hand out a claim now: the authorization code would
        // be exchanged while still sitting in the address bar, in history, and
        // in anything that reads the URL. So the capture fails closed and the
        // code is discarded immediately, on this synchronous path, before any
        // caller can reach it. Nothing here claims the URL was cleaned.
        return capture(FAIL_CLOSED_CANDIDATE, null);
      }
    }

    if (shape.shape === "success_candidate") {
      return capture(
        { kind: "success_candidate", flowId: shape.flowId },
        shape.authorizationCode
      );
    }
    if (shape.shape === "provider_error_candidate") {
      return capture({ kind: "provider_error_candidate", flowId: shape.flowId }, null);
    }
    return capture({ kind: shape.shape }, null);
  }

  function peekCallbackCandidate(): CallbackCandidate | null {
    return state.phase === "captured" ? state.candidate : null;
  }

  function claimCallbackForExchange(): CallbackClaim {
    if (state.phase !== "captured") return { kind: "no_claim" };
    if (state.candidate.kind !== "success_candidate") return { kind: "no_claim" };
    if (claimed) return { kind: "no_claim" };
    const code = state.authorizationCode;
    if (code === null) return { kind: "no_claim" };

    claimed = true;
    const flowId = state.candidate.flowId;
    // TRANSFERRED, not dropped: the cell's own slot is emptied here (so no later
    // claim can ever produce it again), and the sole remaining reference is the
    // issued claim's closure below — which hands it out exactly once, or gives
    // it up early if `finalizeTerminalCallbackOutcome()` revokes it first.
    state = { phase: "captured", candidate: state.candidate, authorizationCode: null };

    let remaining: string | null = code;
    revokeIssuedClaim = () => {
      remaining = null;
    };

    // Both members are non-enumerable and `toJSON` is empty, so neither the
    // authorization code nor the non-secret selector can be picked up by
    // `JSON.stringify`, a spread, `Object.entries`, a test snapshot, or a
    // structured logger walking own enumerable properties (ADR-0025 §G). The
    // coordinator still reads `claim.flowId` directly for its deliberate
    // comparison.
    const claim = {} as ClaimedCallback;
    Object.defineProperties(claim, {
      flowId: { value: flowId, enumerable: false, writable: false, configurable: false },
      readAuthorizationCode: {
        value: (): string | null => {
          const value = remaining;
          remaining = null;
          return value;
        },
        enumerable: false,
      },
      toJSON: { value: (): Record<string, never> => ({}), enumerable: false },
    });
    return { kind: "claimed", claim };
  }

  function finalizeTerminalCallbackOutcome(): void {
    // Idempotent: a second call has nothing left to drop.
    revokeIssuedClaim?.();
    revokeIssuedClaim = null;
    // `claimed` stays true so nothing can be claimed again even if a future
    // change reordered these assignments.
    claimed = true;
    state = { phase: "finalized" };
  }

  return {
    initializeCallbackCapture,
    peekCallbackCandidate,
    claimCallbackForExchange,
    finalizeTerminalCallbackOutcome,
  };
}
