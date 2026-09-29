/**
 * Home's honest current-state device summary. Manual Timing is the only
 * timing source this app has today — no connection status is simulated, and no
 * production timing-device integration exists. (A development-only Brower TCi
 * BLE diagnostic does exist under Settings, but it is a hardware-discovery
 * instrument that never produces a TimingResult and is absent from production
 * builds, so it is deliberately not reflected here.) The supporting copy
 * deliberately says "will be supported" rather than "will appear ... when
 * connected", so it never reads as though an external timing connection is
 * already possible. See docs/BROWER_INTEGRATION_STATUS.md and
 * docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md.
 */
import { surfaceClass } from "./Surface";

type DeviceStatusCardProps = {
  /** "bare" strips the outer surface — see TrainingOverview's identical variant. */
  variant?: "card" | "bare";
};

export default function DeviceStatusCard({ variant = "card" }: DeviceStatusCardProps) {
  return (
    <div className={variant === "card" ? surfaceClass("secondary") : ""}>
      <h3 className="text-sm font-semibold text-slate-700">Devices</h3>
      <p className="mt-1 text-sm text-slate-900">Manual Timing</p>
      <p className="mt-1 text-xs text-slate-500">
        External timing systems will be supported here.
      </p>
    </div>
  );
}
