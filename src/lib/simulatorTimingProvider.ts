// A development/test-only `TimingProvider` that lets a human stand in for real timing
// hardware. It implements exactly the same contract a future real adapter would —
// nothing in this file, or in anything that consumes it, is simulator-specific beyond
// this one file existing. See docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md.
import type { MeasurementMode, TimingMeasurement, TimingResult } from "../types";
import type { TimingProvider } from "./timingProvider";

export type SimulateResultOptions = {
  id?: string;
  deviceId?: string;
  laneId?: string;
};

export interface SimulatorTimingProvider extends TimingProvider {
  type: "simulator";
  /** Emits one normalized result with a single measurement. */
  simulateResult(
    measurementMode: MeasurementMode,
    value: number,
    options?: SimulateResultOptions
  ): TimingResult;
  /** Emits one result carrying several measurements at once (see types.ts). */
  simulateMultiMeasurementResult(
    measurements: TimingMeasurement[],
    options?: SimulateResultOptions
  ): TimingResult;
  /** Re-emits a previous result verbatim (same id) — for duplicate-handling tests. */
  simulateDuplicate(previousResult: TimingResult): TimingResult;
  /** Emits a result after a delay, to exercise "result arrives late" scenarios. */
  simulateDelayed(
    measurementMode: MeasurementMode,
    value: number,
    delayMs: number,
    options?: SimulateResultOptions
  ): void;
  /** Emits a syntactically-normalized but empty/invalid result, for negative tests. */
  simulateInvalidResult(value: number, options?: SimulateResultOptions): TimingResult;
}

export function createSimulatorTimingProvider(): SimulatorTimingProvider {
  const listeners = new Set<(result: TimingResult) => void>();
  let running = false;

  function emit(result: TimingResult): TimingResult {
    if (running) {
      listeners.forEach((listener) => listener(result));
    }
    return result;
  }

  function buildResult(
    measurements: TimingMeasurement[],
    options?: SimulateResultOptions
  ): TimingResult {
    return {
      id: options?.id ?? crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      source: "simulator",
      measurements,
      deviceId: options?.deviceId,
      laneId: options?.laneId,
    };
  }

  return {
    type: "simulator",

    start() {
      running = true;
    },

    stop() {
      running = false;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    simulateResult(measurementMode, value, options) {
      return emit(buildResult([{ measurementMode, value }], options));
    },

    simulateMultiMeasurementResult(measurements, options) {
      return emit(buildResult(measurements, options));
    },

    simulateDuplicate(previousResult) {
      return emit(previousResult);
    },

    simulateDelayed(measurementMode, value, delayMs, options) {
      setTimeout(() => {
        emit(buildResult([{ measurementMode, value }], options));
      }, delayMs);
    },

    simulateInvalidResult(value, options) {
      // A value that is syntactically a result but fails plausibility validation
      // downstream (0, negative, or NaN all reach processTimingResult unchanged —
      // rejection is captureSequence.ts's job, not this provider's).
      return emit(buildResult([{ measurementMode: "back-hog", value }], options));
    },
  };
}
