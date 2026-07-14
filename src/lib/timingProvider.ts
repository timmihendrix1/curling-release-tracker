// The provider-neutral timing boundary. A `TimingProvider` is anything that can
// eventually produce a `TimingResult` — the Simulator today, a manual fallback entry,
// and (later) real hardware, all through the exact same shape. Nothing downstream of
// this file (capture sequence processing, shot saving, analytics, export) knows or
// needs to know which provider produced a given result.
//
// Deliberately NOT a large plugin framework: one small interface, no registry, no
// dynamic loading, no per-manufacturer configuration. A future real adapter is just
// another implementation of `TimingProvider` — see docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md.
import type { MeasurementMode, TimingMeasurement, TimingProviderType, TimingResult } from "../types";

/**
 * The contract every timing source implements. `start`/`stop` govern whether the
 * provider is actively listening (a paused Capture Sequence does NOT stop the
 * provider — pausing is a sequence-level concern; see captureSequence.ts). `subscribe`
 * returns an unsubscribe function, matching the common DOM/event-emitter convention
 * already familiar from this codebase's React effect cleanup pattern.
 */
export interface TimingProvider {
  type: TimingProviderType;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  subscribe(listener: (result: TimingResult) => void): () => void;
}

/**
 * Builds a normalized TimingResult for a manually-entered value — the fallback path
 * used both when there is no simulator/external provider running at all, and as the
 * "Add Result Manually" escape hatch inside an active Capture Sequence. This is the
 * ONLY function the manual-fallback UI needs to call; the resulting TimingResult then
 * flows through the exact same `processTimingResult` as every other provider.
 */
export function createManualTimingResult(
  measurementMode: MeasurementMode,
  value: number
): TimingResult {
  const measurement: TimingMeasurement = { measurementMode, value };

  return {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    source: "manual",
    measurements: [measurement],
  };
}
