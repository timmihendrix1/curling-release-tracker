// Handle Strategy resolution for a plan step's shots. Deliberately mirrors, rather
// than duplicates the intent of, captureSequence.ts's computeNextCaptureHandle —
// same parity math (shots-saved % 2), applied to classic manual entry
// (ShotEntry/BlindShotEntry) instead of a Capture Sequence's capturedShotCount.
import type { CaptureHandleMode, Handle, HandleStrategy } from "../../types";

/**
 * The handle expected for the next shot, given how many valid shots have already
 * been saved in this step's block. `undefined` means Free — no preselect, the
 * athlete picks per shot exactly like today's classic manual entry. The athlete may
 * always override the preselected handle for one shot; the *next* shot's preselect
 * still follows the sequence, since it's derived from the saved-shot count, not from
 * any prior override — see docs/TRAINING_SYSTEM_AND_PLANS.md section 13.
 */
export function resolveExpectedHandle(
  strategy: HandleStrategy,
  shotsSavedInBlock: number
): Handle | undefined {
  switch (strategy.type) {
    case "free":
      return undefined;
    case "fixed":
      return strategy.handle;
    case "alternating": {
      const isFirstOfPair = shotsSavedInBlock % 2 === 0;
      const opposite: Handle = strategy.startingHandle === "in" ? "out" : "in";
      return isFirstOfPair ? strategy.startingHandle : opposite;
    }
  }
}

/**
 * Maps a Handle Strategy onto the shape Auto Capture already understands
 * (CaptureHandleMode + startHandle), so a plan-driven block's Capture Sequence setup
 * can be pre-filled. The Auto Capture setup UI remains fully overridable — this is a
 * preset, not a lock, consistent with resolveExpectedHandle's manual-entry behavior.
 */
export function handleStrategyToCaptureHandleMode(strategy: HandleStrategy): {
  handleMode: CaptureHandleMode;
  startHandle: Handle;
} {
  switch (strategy.type) {
    case "free":
      return { handleMode: "manual", startHandle: "in" };
    case "fixed":
      return {
        handleMode: strategy.handle === "in" ? "fixed-in" : "fixed-out",
        startHandle: strategy.handle,
      };
    case "alternating":
      return { handleMode: "alternate", startHandle: strategy.startingHandle };
  }
}
