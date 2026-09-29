// The injected app-foreground boundary.
//
// iOS suspends a foreground app's JavaScript shortly after it leaves the screen, and
// CoreBluetooth delivers nothing to a suspended app unless the app declares a
// background Bluetooth mode. This probe deliberately declares none — it is a
// foreground-only experiment — so a session that continues across backgrounding is not
// a session that kept observing. It is a session whose observations stopped without
// anyone being told.
//
// The probe therefore treats backgrounding as the end of active observation: it
// records the transition, stops treating the connection as observed, attempts
// teardown, and requires an explicit user reconnect. It does not claim background
// reliability, and it does not silently resume.
import { App } from "@capacitor/app";

export interface AppLifecycleSource {
  /** Registers a foreground/background listener. Returns an idempotent unsubscribe. */
  onActiveStateChange(listener: (isActive: boolean) => void): () => void;
}

export function createCapacitorAppLifecycle(): AppLifecycleSource {
  return {
    onActiveStateChange(listener) {
      const handlePromise = App.addListener("appStateChange", ({ isActive }) => {
        listener(isActive);
      });
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        void handlePromise.then((handle) => handle.remove()).catch(() => undefined);
      };
    },
  };
}
