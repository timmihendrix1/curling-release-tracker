"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  exportFile,
  type FileExportDependencies,
  type FileExportOutcome,
  type FileExportRequest,
} from "../lib/platform/fileExport";

/**
 * The one way a component triggers a file export.
 *
 * It exists so no caller has to remember to `await`, to catch, or to guard
 * against a late result arriving after the screen is gone — the three mistakes
 * that turn an export into either an unhandled rejection or a false "saved".
 */
export type FileExportStatus =
  | { state: "idle" }
  | { state: "working" }
  | { state: "done"; message: string; tone: "neutral" | "error" };

/**
 * User-facing copy for every outcome.
 *
 * Deliberately separate facts from guesses (UX Writing Guidelines, "Separate
 * facts from interpretation"):
 *
 *  - a completed share says the file was HANDED OVER, never that the receiving
 *    app saved it — the platform does not report that and neither may we;
 *  - a Web download says it "started", which is the whole truth available;
 *  - a cancellation is only ever shown when the plugin explicitly said so.
 */
function describeOutcome(outcome: FileExportOutcome): {
  message: string;
  tone: "neutral" | "error";
} {
  switch (outcome.kind) {
    case "shared":
      return { message: "Export handed to the share sheet.", tone: "neutral" };
    case "unconfirmed":
      return { message: "Download started.", tone: "neutral" };
    case "cancelled":
      return { message: "Export cancelled. Nothing was saved.", tone: "neutral" };
    case "busy":
      return { message: "An export is already open. Finish it first.", tone: "neutral" };
    case "retired":
      // The attempt was abandoned before anything reached the operating system.
      // Nothing to report to a screen that is gone or now shows another Profile.
      return { message: "Export stopped.", tone: "neutral" };
    case "write_failed":
      return {
        message: "The file could not be created on this device. Try again.",
        tone: "error",
      };
    case "share_unavailable":
      return { message: "Sharing is not available on this device.", tone: "error" };
    case "share_failed":
      return { message: "The export could not be shared. Try again.", tone: "error" };
    case "unsupported_platform":
      return { message: "Export is not supported on this platform.", tone: "error" };
  }
}

export type UseFileExportOptions = {
  /**
   * Bump this whenever the owning identity changes (a Profile switch). A result
   * that arrives for a previous value is discarded rather than shown, so one
   * Profile's export can never write into another Profile's screen.
   */
  ownerKey?: string;
  dependencies?: FileExportDependencies;
};

export type UseFileExport = {
  status: FileExportStatus;
  /** Never rejects. Returns the outcome for callers that want it. */
  runExport: (request: FileExportRequest, retirement?: Readonly<{ isRetired(): boolean }>) => Promise<FileExportOutcome>;
  dismiss: () => void;
};

export function useFileExport(options: UseFileExportOptions = {}): UseFileExport {
  const { ownerKey, dependencies } = options;
  const [status, setStatus] = useState<FileExportStatus>({ state: "idle" });

  /**
   * One attempt's ownership identity.
   *
   * Retirement is ONE-WAY and the token is created fresh per attempt, so
   * owner A → B → A cannot revive A's earlier attempt: that attempt holds its
   * own already-retired token forever.
   */
  const attemptRef = useRef<{ retired: boolean; unmounted: boolean } | null>(null);
  /**
   * Monotonic owner generation.
   *
   * Deliberately a counter rather than the owner value: comparing owner VALUES
   * would revive an attempt on A → B → A, because the value matches again. A
   * generation only ever increases, so an attempt started at generation 0 stays
   * retired forever.
   */
  const generationRef = useRef(0);

  // A Profile switch retires the live attempt AND the on-screen claim, adjusted
  // DURING RENDER rather than from an effect — this project's lint forbids
  // `setState` in an effect body, and React's adjust-during-render is the
  // sanctioned form. Deriving the generation here rather than mutating a ref
  // keeps the render body free of ref writes (`react-hooks/refs`).
  //
  // HONEST LIMIT: retirement stops an attempt only BEFORE `share()` is invoked.
  // A share sheet the operating system has already presented cannot be revoked
  // — no plugin exposes that — so an attempt past that point runs to completion
  // and only its UI claim is dropped.
  const [ownerState, setOwnerState] = useState({ key: ownerKey, generation: 0 });
  const ownerChanged = ownerState.key !== ownerKey;
  if (ownerChanged) {
    setOwnerState({ key: ownerKey, generation: ownerState.generation + 1 });
    if (status.state !== "idle") setStatus({ state: "idle" });
  }
  const ownerGeneration = ownerState.generation + (ownerChanged ? 1 : 0);

  // Unmount retires the live attempt. This is what callers that never pass an
  // `ownerKey` rely on — the Profile-keyed remount unmounts them, and that
  // alone must stop the native operation, not merely silence its message.
  useEffect(() => {
    return () => {
      if (attemptRef.current !== null) {
        attemptRef.current.retired = true;
        attemptRef.current.unmounted = true;
      }
    };
  }, []);

  // Refs are synced in an effect, never mutated during render (CLAUDE.md's
  // `react-hooks/refs` note).
  useEffect(() => {
    generationRef.current = ownerGeneration;
  }, [ownerGeneration]);

  const runExport = useCallback(
    async (request: FileExportRequest, retirement?: Readonly<{ isRetired(): boolean }>): Promise<FileExportOutcome> => {
      const live = attemptRef.current;
      if (live !== null && !live.retired) return { kind: "busy" };

      const attempt = { retired: false, unmounted: false };
      attemptRef.current = attempt;
      const startedGeneration = ownerGeneration;
      setStatus({ state: "working" });

      // Retired by an explicit unmount flag OR by the owner generation having
      // moved on. Both are read at call time, so the boundary sees a retirement
      // that happened while it was awaiting.
      const retired = () => {
        if (attempt.retired || generationRef.current !== startedGeneration) return true;
        try { if (retirement?.isRetired()) attempt.retired = true; }
        catch { attempt.retired = true; }
        return attempt.retired;
      };

      let outcome: FileExportOutcome;
      try {
        outcome = await exportFile(request, {
          ...(dependencies ?? {}),
          // The boundary revalidates this after every asynchronous preparation
          // step and once more immediately before the irreversible share.
          isRetired: retired,
        });
      } catch {
        // `exportFile` is contracted never to reject; this is the belt that
        // guarantees the guard below is released even if that contract breaks.
        outcome = { kind: "share_failed" };
      } finally {
        // Only this attempt releases its own guard — a stale completion must
        // not clear a newer attempt's claim.
        if (attemptRef.current === attempt) attemptRef.current = null;
      }

      // Late completion must not touch a screen that is gone, nor one that now
      // belongs to a different Profile.
      if (!retired() && attemptRef.current === null) {
        setStatus({ state: "done", ...describeOutcome(outcome) });
      } else if (!attempt.unmounted && generationRef.current === startedGeneration && attemptRef.current === null) {
        // A synchronous retirement witness can close the attempt before a
        // rendered Profile change. Release its visible working claim, while
        // never overwriting a newer attempt or an unmounted owner's screen.
        setStatus({ state: "idle" });
      }
      return outcome;
    },
    [dependencies, ownerGeneration]
  );

  const dismiss = useCallback(() => {
    setStatus({ state: "idle" });
  }, []);

  return { status, runExport, dismiss };
}
