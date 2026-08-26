// Lifecycle semantics of the page-scoped, single-use callback capture cell
// (supabaseCallbackCapture.ts; ADR-0025 Decision 11).
//
// These are the PURE lifecycle semantics: idempotent initialization, a
// non-consuming peek, a single claim, and no import-time or render-time
// history mutation. React Strict Mode *mounting* behaviour is exercised later
// in Stage B0.2e, when there is a component to mount; what is proven here is
// the property that makes it safe — a replayed initialization reads the cell,
// never the cleaned URL.
//
// Nothing here asserts anything about barriers, attempts, resolutions, or
// whether an exchange may occur: the cell knows none of that.
import { describe, expect, it, vi } from "vitest";
import { createCallbackCaptureCell, type CallbackUrlAccess } from "../supabaseCallbackCapture";
import { OWNED_CALLBACK_QUERY_FIELDS } from "../supabaseCallbackClassifier";

const BASE = "https://app.example.test/";
const FLOW_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const CODE = "authorization-code-must-never-leak";

/** A controllable stand-in for the one window seam, counting reads so that
 * "does not reread the cleaned URL" is a measured fact, not an assumption. */
function fakeAccess(initialUrl: string | null) {
  let current = initialUrl;
  const readCurrentUrl = vi.fn(() => current);
  const replaceCurrentUrl = vi.fn((url: string) => {
    current = url;
  });
  const access: CallbackUrlAccess = { readCurrentUrl, replaceCurrentUrl };
  return { access, readCurrentUrl, replaceCurrentUrl, currentUrl: () => current };
}

function successUrl(extra = ""): string {
  return `${BASE}?code=${CODE}&sb_flow_id=${FLOW_ID}${extra ? `&${extra}` : ""}`;
}

describe("createCallbackCaptureCell — initialization and idempotency", () => {
  it("reads, classifies and cleans the URL on the first initialization", () => {
    const { access, readCurrentUrl, replaceCurrentUrl, currentUrl } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);

    expect(cell.initializeCallbackCapture()).toEqual({
      kind: "success_candidate",
      flowId: FLOW_ID,
    });
    expect(readCurrentUrl).toHaveBeenCalledTimes(1);
    expect(replaceCurrentUrl).toHaveBeenCalledTimes(1);
    expect(currentUrl()).toBe(BASE);
  });

  it("returns the same captured candidate on repeated initialization and never rereads the cleaned URL", () => {
    const { access, readCurrentUrl, replaceCurrentUrl } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);

    const first = cell.initializeCallbackCapture();
    const second = cell.initializeCallbackCapture();
    const third = cell.initializeCallbackCapture();

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // This is the property that keeps a legitimate user from being locked out
    // by React Strict Mode's replayed setup: the second reader sees the cell,
    // not the now-clean URL.
    expect(readCurrentUrl).toHaveBeenCalledTimes(1);
    expect(replaceCurrentUrl).toHaveBeenCalledTimes(1);
  });

  it("cleans the URL synchronously, before initialization returns and therefore before any asynchronous work", async () => {
    const { access, currentUrl } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    const observed: string[] = [];

    // A microtask queued before capture would run after the synchronous body;
    // recording the URL immediately after the synchronous call proves cleanup
    // already happened with no await in between.
    const pending = Promise.resolve().then(() => observed.push(`async:${currentUrl()}`));
    cell.initializeCallbackCapture();
    observed.push(`sync:${currentUrl()}`);
    await pending;

    expect(observed[0]).toBe(`sync:${BASE}`);
    expect(observed[1]).toBe(`async:${BASE}`);
  });

  it("cleans the URL for every classified shape, not only the successful one", () => {
    const cases: Array<[string, string]> = [
      ["success", successUrl()],
      ["provider error", `${BASE}?error=access_denied&sb_flow_id=${FLOW_ID}`],
      ["ambiguous", `${BASE}?code=${CODE}&sb_flow_id=${FLOW_ID}&error=access_denied`],
      ["malformed (selector only)", `${BASE}?sb_flow_id=${FLOW_ID}`],
      ["malformed (implicit fragment)", `${BASE}#access_token=secret`],
    ];
    for (const [label, initial] of cases) {
      const { access, replaceCurrentUrl, currentUrl } = fakeAccess(initial);
      createCallbackCaptureCell(access).initializeCallbackCapture();
      expect(replaceCurrentUrl, label).toHaveBeenCalledTimes(1);
      expect(currentUrl(), label).toBe(BASE);
    }
  });

  it("preserves unrelated query parameters through capture", () => {
    const { access, currentUrl } = fakeAccess(
      successUrl("state=abc&inviteToken=tok&adminRequestId=req-1")
    );
    createCallbackCaptureCell(access).initializeCallbackCapture();

    const params = new URL(currentUrl()!).searchParams;
    expect(params.get("state")).toBe("abc");
    expect(params.get("inviteToken")).toBe("tok");
    expect(params.get("adminRequestId")).toBe("req-1");
    for (const field of OWNED_CALLBACK_QUERY_FIELDS) expect(params.has(field), field).toBe(false);
  });

  it("performs no history mutation when nothing owned arrived", () => {
    const { access, replaceCurrentUrl } = fakeAccess(`${BASE}?state=abc#warmup`);
    const cell = createCallbackCaptureCell(access);

    expect(cell.initializeCallbackCapture()).toEqual({ kind: "no_return" });
    expect(replaceCurrentUrl).not.toHaveBeenCalled();
  });

  it("captures no_return when there is no document to read", () => {
    const { access, replaceCurrentUrl } = fakeAccess(null);
    const cell = createCallbackCaptureCell(access);

    expect(cell.initializeCallbackCapture()).toEqual({ kind: "no_return" });
    expect(replaceCurrentUrl).not.toHaveBeenCalled();
  });

});

describe("createCallbackCaptureCell — cleanup failure fails closed", () => {
  // If the owned OAuth material could not be removed from the visible URL, a
  // claim must NOT be handed out: the authorization code would otherwise be
  // exchanged while still sitting in the address bar, in session history, and in
  // anything that reads the URL. The capture therefore fails closed and the code
  // is discarded on the same synchronous path, before any caller can reach it.
  const thrownValues: Array<[string, unknown]> = [
    ["an Error", new Error("SecurityError: refused")],
    ["a non-Error string", "refused"],
    ["a Symbol", Symbol("refused")],
    ["null", null],
    ["undefined", undefined],
  ];

  function refusingReplaceAccess(thrown: unknown, initialUrl = successUrl()) {
    const readCurrentUrl = vi.fn(() => initialUrl);
    const replaceCurrentUrl = vi.fn(() => {
      throw thrown;
    });
    const access: CallbackUrlAccess = { readCurrentUrl, replaceCurrentUrl };
    return { access, readCurrentUrl, replaceCurrentUrl };
  }

  it("reports the fail-closed shape and refuses a claim when replaceCurrentUrl throws", () => {
    for (const [label, thrown] of thrownValues) {
      const { access } = refusingReplaceAccess(thrown);
      const cell = createCallbackCaptureCell(access);

      // The existing fail-closed shape, not a new product outcome: ADR-0025 §D
      // already defines this branch as "no exchange, no identity".
      expect(cell.initializeCallbackCapture(), label).toEqual({ kind: "malformed_callback" });
      expect(cell.peekCallbackCandidate(), label).toEqual({ kind: "malformed_callback" });
      expect(cell.claimCallbackForExchange(), label).toEqual({ kind: "no_claim" });
    }
  });

  it("performs zero provider exchanges after a cleanup failure", async () => {
    const exchange = vi.fn(async () => ({ kind: "exchanged" }));
    const { access } = refusingReplaceAccess(new Error("refused"));
    const cell = createCallbackCaptureCell(access);

    cell.initializeCallbackCapture();
    // Exactly the shape a caller uses: claim, and only exchange if claimed.
    const claim = cell.claimCallbackForExchange();
    if (claim.kind === "claimed") await exchange();

    expect(claim.kind).toBe("no_claim");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("discards the authorization code immediately, so nothing can retrieve it later", () => {
    const { access } = refusingReplaceAccess(new Error("refused"));
    const cell = createCallbackCaptureCell(access);

    const candidate = cell.initializeCallbackCapture();

    // Neither the code nor the selector is anywhere in the exposed state, and
    // repeated claiming never yields either.
    for (const value of [JSON.stringify(candidate), JSON.stringify(cell.peekCallbackCandidate())]) {
      expect(value).not.toContain(CODE);
      expect(value).not.toContain(FLOW_ID);
    }
    expect(cell.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
    expect(cell.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
  });

  it("stays stable on repeated initialization and never rereads the URL after a cleanup failure", () => {
    const { access, readCurrentUrl, replaceCurrentUrl } = refusingReplaceAccess(new Error("refused"));
    const cell = createCallbackCaptureCell(access);

    const first = cell.initializeCallbackCapture();
    const second = cell.initializeCallbackCapture();
    const third = cell.initializeCallbackCapture();

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(readCurrentUrl).toHaveBeenCalledTimes(1);
    // No retry either: one refused attempt is not repeated behind the caller's
    // back on a later initialization.
    expect(replaceCurrentUrl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when readCurrentUrl itself throws, without attempting a history mutation", () => {
    for (const [label, thrown] of thrownValues) {
      const replaceCurrentUrl = vi.fn();
      const access: CallbackUrlAccess = {
        readCurrentUrl: () => {
          throw thrown;
        },
        replaceCurrentUrl,
      };
      const cell = createCallbackCaptureCell(access);

      // Whether owned material is present is unknowable, so this is a failure,
      // NOT the definite absence that `no_return` asserts.
      expect(cell.initializeCallbackCapture(), label).toEqual({ kind: "malformed_callback" });
      expect(cell.claimCallbackForExchange(), label).toEqual({ kind: "no_claim" });
      expect(replaceCurrentUrl, label).not.toHaveBeenCalled();
    }
  });

  it("stays stable and rereads nothing when readCurrentUrl throws", () => {
    const readCurrentUrl = vi.fn(() => {
      throw new Error("refused");
    });
    const cell = createCallbackCaptureCell({ readCurrentUrl, replaceCurrentUrl: vi.fn() });

    const first = cell.initializeCallbackCapture();
    expect(cell.initializeCallbackCapture()).toEqual(first);
    expect(cell.initializeCallbackCapture()).toEqual(first);
    expect(readCurrentUrl).toHaveBeenCalledTimes(1);
  });

  it("lets no thrown value, exception text, URL, code, or selector escape into state or logs", () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {})
    );
    const secret = "thrown-detail-must-never-escape";

    for (const failing of ["read", "replace"] as const) {
      const cell = createCallbackCaptureCell({
        readCurrentUrl:
          failing === "read"
            ? () => {
                throw new Error(secret);
              }
            : () => successUrl(),
        replaceCurrentUrl:
          failing === "replace"
            ? () => {
                throw new Error(secret);
              }
            : () => {},
      });

      const candidate = cell.initializeCallbackCapture();
      const claim = cell.claimCallbackForExchange();
      const serialized = JSON.stringify({ candidate, claim });
      for (const forbidden of [secret, CODE, FLOW_ID, BASE]) {
        expect(serialized, failing).not.toContain(forbidden);
      }
      expect(Object.keys(candidate), failing).toEqual(["kind"]);
    }

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });
});

describe("createCallbackCaptureCell — peek and claim", () => {
  it("returns null from peek before capture has been initialized", () => {
    const { access, readCurrentUrl } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);

    expect(cell.peekCallbackCandidate()).toBeNull();
    // Peeking is not a back door into capture: the URL is untouched.
    expect(readCurrentUrl).not.toHaveBeenCalled();
  });

  it("does not consume the candidate — peeking repeatedly still leaves it claimable", () => {
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();

    expect(cell.peekCallbackCandidate()).toEqual({ kind: "success_candidate", flowId: FLOW_ID });
    expect(cell.peekCallbackCandidate()).toEqual({ kind: "success_candidate", flowId: FLOW_ID });
    expect(cell.claimCallbackForExchange().kind).toBe("claimed");
  });

  it("claims a success candidate exactly once", () => {
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();

    const first = cell.claimCallbackForExchange();
    expect(first.kind).toBe("claimed");
    if (first.kind === "claimed") {
      expect(first.claim.flowId).toBe(FLOW_ID);
      expect(first.claim.readAuthorizationCode()).toBe(CODE);
    }

    expect(cell.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
    expect(cell.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
  });

  it("hands the authorization code out exactly once, so a second exchange has nothing to send", () => {
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();
    const claim = cell.claimCallbackForExchange();
    if (claim.kind !== "claimed") throw new Error("expected a claim");

    expect(claim.claim.readAuthorizationCode()).toBe(CODE);
    expect(claim.claim.readAuthorizationCode()).toBeNull();
  });

  it("still reports the candidate after it has been claimed, without making it claimable again", () => {
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();
    cell.claimCallbackForExchange();

    expect(cell.peekCallbackCandidate()).toEqual({ kind: "success_candidate", flowId: FLOW_ID });
    expect(cell.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
  });

  it("refuses to claim any non-success shape", () => {
    const shapes: Array<[string, string]> = [
      ["no_return", BASE],
      ["provider_error_candidate", `${BASE}?error=access_denied&sb_flow_id=${FLOW_ID}`],
      ["ambiguous_callback", `${BASE}?code=${CODE}&code=${CODE}&sb_flow_id=${FLOW_ID}`],
      ["malformed_callback", `${BASE}#access_token=secret`],
    ];
    for (const [label, initial] of shapes) {
      const { access } = fakeAccess(initial);
      const cell = createCallbackCaptureCell(access);
      expect(cell.initializeCallbackCapture().kind, label).toBe(label);
      expect(cell.claimCallbackForExchange(), label).toEqual({ kind: "no_claim" });
    }
  });
});

describe("createCallbackCaptureCell — page scope", () => {
  it("treats a fresh instance as a genuinely new page scope", () => {
    const shared = fakeAccess(successUrl());

    const firstPage = createCallbackCaptureCell(shared.access);
    expect(firstPage.initializeCallbackCapture().kind).toBe("success_candidate");
    expect(firstPage.claimCallbackForExchange().kind).toBe("claimed");

    // A real reload lands on the cleaned URL, so the new scope correctly finds
    // nothing — the captured candidate was never durable.
    const secondPage = createCallbackCaptureCell(shared.access);
    expect(secondPage.peekCallbackCandidate()).toBeNull();
    expect(secondPage.initializeCallbackCapture()).toEqual({ kind: "no_return" });
    expect(secondPage.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
  });

  it("gives each instance its own independent single claim", () => {
    const first = createCallbackCaptureCell(fakeAccess(successUrl()).access);
    const second = createCallbackCaptureCell(fakeAccess(successUrl()).access);
    first.initializeCallbackCapture();
    second.initializeCallbackCapture();

    expect(first.claimCallbackForExchange().kind).toBe("claimed");
    expect(second.claimCallbackForExchange().kind).toBe("claimed");
  });
});

describe("createCallbackCaptureCell — explicit terminal finalization is not React effect disposal", () => {
  it("offers exactly one way to end the capture, and it is not named like effect cleanup", () => {
    const cell = createCallbackCaptureCell(fakeAccess(successUrl()).access);

    expect(Object.keys(cell).sort()).toEqual([
      "claimCallbackForExchange",
      "finalizeTerminalCallbackOutcome",
      "initializeCallbackCapture",
      "peekCallbackCandidate",
    ]);
    // React-effect disposal has NO automatic access to the ending operation:
    // there is no member an abandoned Strict Mode setup pass could be wired to
    // by convention, so the committed pass can still claim the candidate. Ending
    // the capture requires calling the explicitly named terminal operation on
    // purpose.
    for (const disposalName of ["dispose", "destroy", "reset", "clear", "cleanup", "unmount"]) {
      expect(cell, disposalName).not.toHaveProperty(disposalName);
    }
    expect(typeof cell.finalizeTerminalCallbackOutcome).toBe("function");
  });

  it("keeps a terminal outcome stable rather than re-deriving it from the cleaned URL", () => {
    // A terminal shape is nothing to claim, so it needs no invalidation step —
    // and re-deriving it would read the cleaned URL and silently become
    // `no_return`, which is a different fact.
    const { access, readCurrentUrl } = fakeAccess(`${BASE}?error=access_denied&sb_flow_id=${FLOW_ID}`);
    const cell = createCallbackCaptureCell(access);

    expect(cell.initializeCallbackCapture()).toEqual({
      kind: "provider_error_candidate",
      flowId: FLOW_ID,
    });
    expect(cell.initializeCallbackCapture()).toEqual({
      kind: "provider_error_candidate",
      flowId: FLOW_ID,
    });
    expect(cell.peekCallbackCandidate()).toEqual({
      kind: "provider_error_candidate",
      flowId: FLOW_ID,
    });
    expect(readCurrentUrl).toHaveBeenCalledTimes(1);
  });
});

describe("createCallbackCaptureCell — claiming transfers the code; only finalization revokes it", () => {
  // The distinction that the lifecycle prose in supabaseCallbackCapture.ts now
  // states exactly, pinned here so neither side can drift: claiming must NOT
  // revoke the claim it just issued (or the exchange could never happen), and
  // finalizing MUST.
  it("claiming alone leaves the issued claim able to yield the code exactly once", () => {
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();

    const claim = cell.claimCallbackForExchange();
    if (claim.kind !== "claimed") throw new Error("expected a claim");

    // The cell is NOT finalized by claiming: it still reports what arrived...
    expect(cell.peekCallbackCandidate()).toEqual({
      kind: "success_candidate",
      flowId: FLOW_ID,
    });
    // ...its own slot is empty, so no second claim can ever produce the code...
    expect(cell.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
    // ...and the already-issued claim is still usable, exactly once.
    expect(claim.claim.readAuthorizationCode()).toBe(CODE);
    expect(claim.claim.readAuthorizationCode()).toBeNull();
  });

  it("side-by-side: claiming does not revoke, finalizing does", () => {
    function issueClaim() {
      const cell = createCallbackCaptureCell(fakeAccess(successUrl()).access);
      cell.initializeCallbackCapture();
      const claim = cell.claimCallbackForExchange();
      if (claim.kind !== "claimed") throw new Error("expected a claim");
      return { cell, claim: claim.claim };
    }

    // Claim, then do nothing else: the code is still available.
    const notFinalized = issueClaim();
    expect(notFinalized.claim.readAuthorizationCode()).toBe(CODE);

    // Claim, then finalize before reading: the code is gone.
    const finalized = issueClaim();
    finalized.cell.finalizeTerminalCallbackOutcome();
    expect(finalized.claim.readAuthorizationCode()).toBeNull();
  });

  it("a second claim is refused even though the first claim is still unread", () => {
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();
    const first = cell.claimCallbackForExchange();

    expect(cell.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
    expect(cell.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
    // The single-use guarantee is about the CELL issuing one claim, not about
    // the issued claim being pre-emptively emptied.
    if (first.kind !== "claimed") throw new Error("expected a claim");
    expect(first.claim.readAuthorizationCode()).toBe(CODE);
  });
});

describe("createCallbackCaptureCell — explicit terminal finalization behaviour", () => {
  it("removes the retained candidate and refuses every later claim", () => {
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();

    cell.finalizeTerminalCallbackOutcome();

    expect(cell.peekCallbackCandidate()).toBeNull();
    expect(cell.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
  });

  it("is idempotent", () => {
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();

    expect(() => {
      cell.finalizeTerminalCallbackOutcome();
      cell.finalizeTerminalCallbackOutcome();
      cell.finalizeTerminalCallbackOutcome();
    }).not.toThrow();
    expect(cell.peekCallbackCandidate()).toBeNull();
    expect(cell.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
  });

  it("does not reread the already-cleaned URL, before or after finalization", () => {
    const { access, readCurrentUrl } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();

    cell.finalizeTerminalCallbackOutcome();
    // A late or replayed caller gets the neutral shape from the spent scope, not
    // a fresh read that would find the clean URL and look like a new page load.
    expect(cell.initializeCallbackCapture()).toEqual({ kind: "no_return" });
    expect(cell.initializeCallbackCapture()).toEqual({ kind: "no_return" });
    expect(cell.peekCallbackCandidate()).toBeNull();
    expect(readCurrentUrl).toHaveBeenCalledTimes(1);
  });

  it("can be called before initialization without rereading or capturing anything", () => {
    const { access, readCurrentUrl, replaceCurrentUrl } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);

    cell.finalizeTerminalCallbackOutcome();

    expect(cell.initializeCallbackCapture()).toEqual({ kind: "no_return" });
    expect(cell.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
    expect(readCurrentUrl).not.toHaveBeenCalled();
    expect(replaceCurrentUrl).not.toHaveBeenCalled();
  });

  it("revokes an authorization code still readable through an already-issued claim", () => {
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();
    const claim = cell.claimCallbackForExchange();
    if (claim.kind !== "claimed") throw new Error("expected a claim");

    // The claim was issued but its code never read; finalization must still
    // leave no callback secret anywhere in this scope.
    cell.finalizeTerminalCallbackOutcome();

    expect(claim.claim.readAuthorizationCode()).toBeNull();
  });

  it("leaves a claim issued and already consumed exactly as spent", () => {
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();
    const claim = cell.claimCallbackForExchange();
    if (claim.kind !== "claimed") throw new Error("expected a claim");

    expect(claim.claim.readAuthorizationCode()).toBe(CODE);
    cell.finalizeTerminalCallbackOutcome();
    expect(claim.claim.readAuthorizationCode()).toBeNull();
  });

  it("performs zero provider exchanges for a claim revoked by finalization", async () => {
    const exchange = vi.fn(async () => ({ kind: "exchanged" }));
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();
    const claim = cell.claimCallbackForExchange();
    if (claim.kind !== "claimed") throw new Error("expected a claim");
    cell.finalizeTerminalCallbackOutcome();

    // Exactly what the exchange boundary does: read the code, and only call the
    // provider if there is one.
    const code = claim.claim.readAuthorizationCode();
    if (code !== null) await exchange();

    expect(code).toBeNull();
    expect(exchange).not.toHaveBeenCalled();
  });

  it("finalizes a terminal shape as readily as a success candidate", () => {
    for (const initial of [
      BASE,
      `${BASE}?error=access_denied&sb_flow_id=${FLOW_ID}`,
      `${BASE}#access_token=secret`,
    ]) {
      const { access } = fakeAccess(initial);
      const cell = createCallbackCaptureCell(access);
      cell.initializeCallbackCapture();

      cell.finalizeTerminalCallbackOutcome();

      expect(cell.peekCallbackCandidate(), initial).toBeNull();
      expect(cell.claimCallbackForExchange(), initial).toEqual({ kind: "no_claim" });
    }
  });

  it("finalizing one page scope cannot affect another instance", () => {
    const first = createCallbackCaptureCell(fakeAccess(successUrl()).access);
    const second = createCallbackCaptureCell(fakeAccess(successUrl()).access);
    first.initializeCallbackCapture();
    second.initializeCallbackCapture();

    first.finalizeTerminalCallbackOutcome();

    expect(first.claimCallbackForExchange()).toEqual({ kind: "no_claim" });
    // The other scope is untouched and still has its own single claim.
    expect(second.peekCallbackCandidate()).toEqual({
      kind: "success_candidate",
      flowId: FLOW_ID,
    });
    const claim = second.claimCallbackForExchange();
    expect(claim.kind).toBe("claimed");
    if (claim.kind === "claimed") expect(claim.claim.readAuthorizationCode()).toBe(CODE);
  });

  it("logs nothing and exposes nothing sensitive when finalizing", () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {})
    );
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();
    cell.claimCallbackForExchange();

    cell.finalizeTerminalCallbackOutcome();

    expect(JSON.stringify(cell.peekCallbackCandidate())).toBe("null");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });

  it("records nothing a caller could mistake for a barrier, attempt, resolution, or admission decision", () => {
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();

    // Provider-mechanics lifecycle only: it returns nothing at all.
    expect(cell.finalizeTerminalCallbackOutcome()).toBeUndefined();
  });
});

describe("createCallbackCaptureCell — nothing sensitive escapes", () => {
  it("keeps the authorization code out of the public candidate", () => {
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);

    const candidate = cell.initializeCallbackCapture();
    expect(JSON.stringify(candidate)).not.toContain(CODE);
    expect(JSON.stringify(cell.peekCallbackCandidate())).not.toContain(CODE);
  });

  it("serializes a claimed callback with NEITHER the authorization code nor the flow selector", () => {
    // The selector is non-secret, but ADR-0025 §G still says it is "compared and
    // discarded; never logged or rendered". Making it log-friendly would put a
    // correlatable identifier into every snapshot and structured log that ever
    // touches a claim.
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);
    cell.initializeCallbackCapture();
    const claim = cell.claimCallbackForExchange();
    if (claim.kind !== "claimed") throw new Error("expected a claim");

    expect(JSON.stringify(claim.claim)).toBe("{}");
    expect(JSON.stringify({ wrapped: claim.claim })).toBe('{"wrapped":{}}');
    // Not merely `toJSON`: neither value is an own enumerable property either,
    // so a spread, `Object.entries`, or a logger that walks own keys finds
    // nothing.
    expect(Object.keys(claim.claim)).toEqual([]);
    expect(Object.entries(claim.claim)).toEqual([]);
    expect(JSON.stringify({ ...claim.claim })).toBe("{}");
    for (const rendered of [
      JSON.stringify(claim.claim),
      JSON.stringify({ ...claim.claim }),
      String(Object.keys(claim.claim)),
    ]) {
      expect(rendered).not.toContain(CODE);
      expect(rendered).not.toContain(FLOW_ID);
      expect(rendered).not.toContain("sb_flow_id");
    }
    // The coordinator can still read the selector directly for its deliberate
    // comparison — that is the only intended access path.
    expect(claim.claim.flowId).toBe(FLOW_ID);
  });

  it("keeps raw provider error values out of a provider-error candidate", () => {
    const { access } = fakeAccess(
      `${BASE}?error=server_error&error_description=Something%20leaky&sb_flow_id=${FLOW_ID}`
    );
    const candidate = createCallbackCaptureCell(access).initializeCallbackCapture();

    expect(candidate).toEqual({ kind: "provider_error_candidate", flowId: FLOW_ID });
    expect(JSON.stringify(candidate)).not.toContain("Something leaky");
    expect(JSON.stringify(candidate)).not.toContain("server_error");
  });

  it("logs nothing at all during capture and claim", () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {})
    );
    const { access } = fakeAccess(successUrl());
    const cell = createCallbackCaptureCell(access);

    cell.initializeCallbackCapture();
    cell.peekCallbackCandidate();
    cell.claimCallbackForExchange();
    cell.claimCallbackForExchange();

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });
});

describe("createCallbackCaptureCell — no import-time or construction-time side effect", () => {
  it("mutates no history and reads no URL until capture is explicitly invoked", () => {
    const { access, readCurrentUrl, replaceCurrentUrl } = fakeAccess(successUrl());

    // Constructing the cell is what a render body or a module top level would
    // do; neither may rewrite history as a side effect.
    const cell = createCallbackCaptureCell(access);
    cell.peekCallbackCandidate();

    expect(readCurrentUrl).not.toHaveBeenCalled();
    expect(replaceCurrentUrl).not.toHaveBeenCalled();
  });

  it("is free of a module-level capture call in its own source (no import-time history mutation)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "src", "lib", "supabase", "supabaseCallbackCapture.ts"),
      "utf8"
    );
    // `initializeCallbackCapture()` followed by `:` is a declaration (a type
    // member or the function signature), not a call. Anything else that calls
    // it — at the module top level or from a constructor body — would rewrite
    // history as a side effect of loading or constructing, which is exactly
    // what ADR-0025 Decision 11 forbids. Comment lines are prose.
    const calls = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .filter((line) => /initializeCallbackCapture\s*\(\s*\)\s*(?!:)/.test(line));
    expect(calls).toEqual([]);
  });
});
