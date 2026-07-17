/**
 * Home's honest current-state device summary. Manual Timing is the only
 * timing source this app has today — no connection status is simulated, no
 * hardware integration exists yet. The supporting copy deliberately says
 * "will be supported" rather than "will appear ... when connected", so it
 * never reads as though an external timing connection is already possible.
 * See docs/BROWER_INTEGRATION_STATUS.md and
 * docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md.
 */
import { surfaceClass } from "./Surface";

export default function DeviceStatusCard() {
  return (
    // Secondary Surface (Epic 1) — compact and visually lighter than
    // Today's Plan, matching its supporting role on Home.
    <div className={surfaceClass("secondary")}>
      <h3 className="text-sm font-semibold text-slate-700">Devices</h3>
      <p className="mt-1 text-sm text-slate-900">Manual Timing</p>
      <p className="mt-1 text-xs text-slate-500">
        External timing systems will be supported here.
      </p>
    </div>
  );
}
