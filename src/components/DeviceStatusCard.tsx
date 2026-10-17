/** Device configuration entry, not a second source of connection status. */
import { surfaceClass } from "./Surface";

type DeviceStatusCardProps = {
  /** "bare" strips the outer surface — see TrainingOverview's identical variant. */
  variant?: "card" | "bare";
  onOpenSettings?: () => void;
};

export default function DeviceStatusCard({ variant = "card", onOpenSettings }: DeviceStatusCardProps) {
  return (
    <div className={variant === "card" ? surfaceClass("secondary") : ""}>
      <h3 className="text-sm font-semibold text-slate-700">Devices</h3>
      <p className="mt-1 text-xs text-slate-500">
        Manage timing devices in Settings.
      </p>
      {onOpenSettings && <button type="button" className="house-link text-sm" onClick={onOpenSettings}>Manage devices <span aria-hidden="true">→</span></button>}
    </div>
  );
}
