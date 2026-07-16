/**
 * Home's honest current-state device summary. Manual Timing is the only
 * timing source this app has today — no connection status is simulated, no
 * hardware integration exists yet. The supporting copy deliberately says
 * "will be supported" rather than "will appear ... when connected", so it
 * never reads as though an external timing connection is already possible.
 * See docs/BROWER_INTEGRATION_STATUS.md and
 * docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md.
 */
export default function DeviceStatusCard() {
  return (
    // Subtle surface (DESIGN_SYSTEM.md §8.2) — compact and visually lighter
    // than Today's Plan, matching its tertiary role on Home.
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-700">Devices</h3>
      <p className="mt-1 text-sm text-slate-900">Manual Timing</p>
      <p className="mt-1 text-xs text-slate-500">
        External timing systems will be supported here.
      </p>
    </div>
  );
}
