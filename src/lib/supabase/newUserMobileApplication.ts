// The explicit beta root owns one genuine host outside React. Construction is inert.
import { detectRuntimePlatform } from "../platform/runtimePlatform";
import { resolveNativeApiOriginConfig } from "../platform/nativeApiOrigin";
import { NATIVE_APPLICATION_DATABASE_NAME } from "../persistence/storageComposition";
import { resolveCloudConfig } from "./config";
import { prepareNativeProviderConfiguration } from "./nativeProviderConfiguration";
import { browserCallbackUrlAccess } from "./supabaseCallbackCapture";
import { createConfiguredNewUserNativeSportingIdentityHost, type NativeSportingIdentityHost,
  type NativeSportingIdentityRuntimeReady, type NativeAuthCleanup } from "./supabaseAuthService";

type Snapshot = Readonly<{
  phase: "idle" | "preparing" | "ready" | "blocked" | "closing" | "closed";
  runtime: NativeSportingIdentityRuntimeReady | null;
  retry: boolean;
  cleanupPending: boolean;
  cleanup: NativeAuthCleanup | null;
  notice: string;
}>;
const unavailable = "Athlete access could not be prepared. Existing data has been preserved.";
const reopen = "Close and reopen the app to check athlete access again.";

/** No dependency/Ready injection. Tests substitute only actual platform edges. */
export function createNewUserMobileApplication() {
  let snapshot: Snapshot = Object.freeze({ phase: "idle", runtime: null, retry: false,
    cleanupPending: false, cleanup: null, notice: "Preparing athlete access…" });
  const listeners = new Set<() => void>();
  let host: NativeSportingIdentityHost | null = null;
  let flight = false, terminal = false, references = 0, releaseGeneration = 0;
  let closing: Promise<NativeAuthCleanup> | null = null;
  function update(fields: Partial<Snapshot>) {
    snapshot = Object.freeze({ ...snapshot, ...fields });
    for (const listener of [...listeners]) { try { listener(); } catch { /* Presentation cannot authorize work. */ } }
  }
  function observeClose(actual: Promise<NativeAuthCleanup>) {
    if (closing === actual) return;
    closing = actual;
    void actual.then(value => update({ phase: value.ok ? "closed" : "blocked", runtime: null,
      retry: false, cleanupPending: !value.ok, cleanup: value, notice: value.ok ? reopen : "Athlete access has stopped. Storage cleanup could not be confirmed. Close and reopen the app." }));
  }
  function close(): void {
    if (terminal) return;
    terminal = true;
    // Genuine revocation precedes presentation callbacks. Keep its completion
    // private: a platform callback returning Close must never hand that promise
    // back to an operation that disposal itself needs to drain.
    const actual = host?.dispose();
    if (actual) observeClose(actual);
    update({ phase: actual || flight ? "closing" : "closed", runtime: null, retry: false,
      cleanupPending: Boolean(actual || flight), notice: actual || flight ? "Finishing athlete access…" : reopen });
  }
  async function run() {
    try {
      if (terminal) return;
      update({ phase: "preparing", retry: false, notice: "Preparing athlete access…" });
      if (terminal) return;
      if (!host) {
        if (detectRuntimePlatform() !== "ios") {
          if (!terminal) update({ phase: "blocked", notice: "This beta build requires the iOS app." }); return;
        }
        const config = resolveCloudConfig();
        if (terminal) return;
        // The shared Web resolver permits local HTTP. An installable native beta
        // must never hand OTPs or bearer credentials to a cleartext transport.
        if (config.status !== "configured" || new URL(config.url).protocol !== "https:" || resolveNativeApiOriginConfig().status !== "configured") {
          if (!terminal) update({ phase: "blocked", notice: "Athlete sign-in is unavailable in this build. The training application remains locked." }); return;
        }
        if (terminal) return;
        const prepared = await prepareNativeProviderConfiguration(config);
        if (terminal) return;
        if (!prepared.ok) { update({ phase: "blocked", notice: unavailable }); return; }
        const made = await createConfiguredNewUserNativeSportingIdentityHost(prepared.value, {
          migration: { sqlite: { databaseName: NATIVE_APPLICATION_DATABASE_NAME },
            generateUuid: () => globalThis.crypto.randomUUID(), now: () => new Date().toISOString(),
            limits: { checkpointBatchKeyLimit: 20, latchWriteAttemptLimit: 1, maxPlansPerRun: 100,
              protocolStepLimit: 100, faultWriteAttemptLimit: 1 } },
          fetch: (input, init) => globalThis.fetch(input, init), callbackUrlAccess: browserCallbackUrlAccess(),
        });
        if (!made.ok) { if (!terminal) update({ phase: "blocked", notice: unavailable }); return; }
        host = made.host;
        if (terminal) { const actual = host.dispose(); observeClose(actual); await actual; return; }
      }
      const result = await host.start();
      if (terminal) return;
      if (result.outcome === "ready") update({ phase: "ready", runtime: result.runtime, notice: "", retry: false });
      else update({ phase: "blocked", runtime: null, notice: unavailable,
        retry: result.outcome === "waiting" && result.code !== "restart_required" });
    } catch {
      if (!terminal) update({ phase: "blocked", runtime: null, retry: false, notice: unavailable });
    } finally {
      flight = false;
      if (terminal && !host) update({ phase: "closed", runtime: null, retry: false, cleanupPending: false, notice: reopen });
    }
  }
  function start() {
    if (terminal || flight || snapshot.phase === "ready") return;
    flight = true; // private: never return this flight to a callback it owns
    void Promise.resolve().then(run);
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start, close,
    retain() {
      references++; releaseGeneration++; start();
      let released = false;
      return () => {
        if (released) return; released = true; references--;
        const generation = ++releaseGeneration;
        // StrictMode immediately reacquires in the same task. A real final
        // unmount closes in this microtask; no timeout can resurrect an owner.
        queueMicrotask(() => { if (references === 0 && generation === releaseGeneration) close(); });
      };
    },
  });
}
