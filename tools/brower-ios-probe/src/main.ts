// Composition root.
//
// This is the ONLY place the real native implementations are constructed, and each is
// constructed only behind the native-iOS check. That is what makes the "no silent
// fallback" rule structural rather than a promise: on a browser there is no transport
// object at all, so there is nothing that could quietly become Web Bluetooth or
// synthetic data — the controller reports an unsupported platform and offers nothing.
import { Capacitor } from "@capacitor/core";
import { createCapacitorAppLifecycle } from "./probe/appLifecycle";
import { createCapacitorBleTransport } from "./probe/capacitorTransport";
import { createCapacitorExportTarget } from "./probe/capacitorExportTarget";
import { createProbeController } from "./probe/probeController";
import type { ProbeController } from "./probe/probeController";
import { resolveProbePlatform } from "./probe/transport";
import type { ProbeExportTarget } from "./probe/exportTarget";
import { renderProbe } from "./ui/render";
import { buildProbeViewModel } from "./ui/viewModel";
import "./styles.css";

/**
 * Off-device stand-in for the export target. It writes nothing anywhere — notably not
 * to WebView storage, which the Capacitor Filesystem web implementation would use.
 */
const unsupportedExportTarget: ProbeExportTarget = {
  exportJson(): Promise<{ kind: "failed"; reason: string }> {
    return Promise.resolve({
      kind: "failed",
      reason: "Exporting needs the native iOS share sheet, which is not available here.",
    });
  },
};

function mount(): void {
  const root = document.getElementById("app");
  if (root === null) throw new Error("The probe could not find its mount element.");

  const platform = resolveProbePlatform(Capacitor);
  const controller: ProbeController = createProbeController({
    platform,
    transport: platform.supported ? createCapacitorBleTransport() : null,
    exportTarget: platform.supported
      ? createCapacitorExportTarget()
      : unsupportedExportTarget,
    ...(platform.supported ? { lifecycle: createCapacitorAppLifecycle() } : {}),
  });

  function handleAction(id: string): void {
    if (id.startsWith("read:")) {
      void controller.readCharacteristic(id.slice("read:".length));
      return;
    }
    switch (id) {
      case "initialize":
        void controller.initializeBluetooth();
        return;
      case "connect-filtered":
        void controller.connect("timing-service-filter");
        return;
      case "connect-all":
        void controller.connect("all-nearby");
        return;
      case "disconnect":
        void controller.disconnect();
        return;
      case "start-listening":
        void controller.startListening();
        return;
      case "stop-listening":
        void controller.stopListening();
        return;
      case "export-log":
        void controller.exportLog();
        return;
      case "clear-log": {
        const first = controller.clearLog();
        if (first.cleared) return;
        // The warning names the actual consequence rather than asking "are you sure":
        // these observations exist nowhere else, and this is the step that destroys
        // them.
        const confirmed = window.confirm(
          `${first.reason}\n\nClear the log anyway?`
        );
        if (confirmed) controller.clearLog({ confirmed: true });
        return;
      }
      default:
        return;
    }
  }

  function paint(): void {
    renderProbe(root as HTMLElement, buildProbeViewModel(controller.getSnapshot()), {
      onAction: handleAction,
    });
  }

  controller.subscribe(paint);
  paint();

  window.addEventListener("pagehide", () => {
    void controller.release();
  });
}

mount();
