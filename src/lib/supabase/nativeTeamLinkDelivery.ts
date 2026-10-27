// Internal dormant App source. No SDK, storage, identity authority or React.
import { selectDeepLinkIntent, isValidIntentValue, type PendingIntent, type IntentMutationOutcome } from "../identity/pendingIntentRepository";
import type { NativeTeamLinkDeliverySnapshot } from "../persistence/nativeApplicationTypes";
import { drainObservedPlatformWork, observePlatformWork } from "../persistence/platformSha256";
import { OWNED_CALLBACK_QUERY_FIELDS, hasWhitespaceOrControl } from "./supabaseCallbackClassifier";
export type NativeTeamLinkPort = Readonly<{
  addListener(event: "appUrlOpen", callback: (event: unknown) => void): unknown;
  getLaunchUrl(): unknown;
}>;
type InitialCaptureOutcome = Readonly<{ kind: "captured"; intent: PendingIntent } | { kind: "not_present" } | { kind: "not_captured" } | { kind: "blocked" }>;
type Options = Readonly<{
  origin: string; port?: NativeTeamLinkPort;
  current(): boolean; isOwnDisposal(value: unknown): boolean; now(): string;
  capture(intent: PendingIntent): Promise<IntentMutationOutcome>; changed(): void;
}>;
export type NativeTeamLinkDelivery = ReturnType<typeof createNativeTeamLinkDelivery>;
const apply = Reflect.apply, prototype = Object.getPrototypeOf, descriptor = Object.getOwnPropertyDescriptor, then = Promise.prototype.then;
export function isCanonicalNativeTeamLinkOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.origin === value && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash; }
  catch { return false; }
}
export function createNativeTeamLinkDelivery(options: Options) {
  let closed = false, initFailed = false, cleanupFailed = false, eventSeen = false;
  let startFlight: Promise<boolean> | null = null, closeFlight: Promise<Readonly<{ ok: boolean }>> | null = null;
  let remove: (() => unknown) | null = null, removalIssued = false;
  let eventOrder = 0;
  const classifying = new Set<{ order: number; active: boolean }>();
  let arrival = 0, latest: Promise<InitialCaptureOutcome> | null = null;
  let inFlight: { kind: PendingIntent["kind"]; value: string; work: Promise<InitialCaptureOutcome> } | null = null;
  let initial: InitialCaptureOutcome = Object.freeze({ kind: "not_present" });
  let snapshot: NativeTeamLinkDeliverySnapshot = Object.freeze({ kind: "listening" });
  const work = new Set<Promise<unknown>>();
  const alive = () => !closed && options.current();
  const current = () => alive() && !initFailed;
  function status(kind: NativeTeamLinkDeliverySnapshot["kind"]) {
    if (snapshot.kind === kind) return;
    snapshot = Object.freeze({ kind });
    try { options.changed(); } catch { /* advisory only */ }
  }
  function own<T>(pending: Promise<T>): Promise<T> {
    work.add(pending); void pending.then(() => { work.delete(pending); }, () => { work.delete(pending); }); return pending;
  }
  function retain(value: unknown) { own(drainObservedPlatformWork(value, options.isOwnDisposal)); }
  function plain(value: unknown, cleanupOnly = false, fence = current, invalid = retain): value is object {
    const allowed = () => cleanupOnly || fence();
    if (!allowed()) return false;
    if (!value || typeof value !== "object") { invalid(value); return false; }
    try {
      const parent = prototype(value);
      if (!allowed() || (parent !== Object.prototype && parent !== null)) { invalid(parent); invalid(value); return false; }
      const constructor = descriptor(value, "constructor");
      if (!allowed() || constructor) { invalid(value); return false; }
      const ownThen = descriptor(value, "then");
      if (!allowed() || ownThen) { invalid(value); return false; }
      let native = false;
      try { apply(then, value, [() => {}, () => {}]); native = true; } catch { /* supported data shape; C4 still applies */ }
      if (!allowed() || native) { invalid(value); return false; }
      return true;
    } catch { invalid(value); return false; }
  }
  async function nativePort(): Promise<NativeTeamLinkPort> {
    function refuse(value: unknown): never {
      // Retirement precedes assimilation of any malformed directly observed work.
      initFailed = true; retain(value); throw null;
    }
    function read(receiver: object, key: string): unknown {
      if (!current()) throw null;
      const value: unknown = Reflect.get(receiver, key);
      if (!current()) refuse(value);
      return value;
    }
    function root(value: unknown): object {
      if (!plain(value, false, current, value => { initFailed = true; retain(value); })) throw null;
      return value;
    }
    function operation(receiver: object, key: string): (...args: unknown[]) => unknown {
      const value = read(receiver, key);
      if (typeof value !== "function") refuse(value);
      return value as (...args: unknown[]) => unknown;
    }
    function proof(receiver: object, key: string, args: unknown[]) {
      const fn = operation(receiver, key);
      if (!current()) throw null;
      const value: unknown = apply(fn, receiver, args);
      if (!current() || value !== true) refuse(value);
    }
    const core = await import("@capacitor/core");
    if (!current()) throw null;
    const capacitor = root(read(core, "Capacitor"));
    proof(capacitor, "isNativePlatform", []);
    proof(capacitor, "isPluginAvailable", ["App"]);
    if (!current()) throw null;
    const appModule = await import("@capacitor/app");
    if (!current()) throw null;
    const app = root(read(appModule, "App"));
    const add = operation(app, "addListener");
    const launch = operation(app, "getLaunchUrl");
    if (!current()) throw null;
    return Object.freeze({ addListener: (event: "appUrlOpen", callback: (event: unknown) => void) => apply(add, app, [event, callback]),
      getLaunchUrl: () => apply(launch, app, []) });
  }
  function urlField(value: unknown, launch: boolean, fence = current): Readonly<{ valid: true; url: string | null }> | Readonly<{ valid: false }> {
    if (launch && value === undefined) return { valid: true, url: null };
    if (!plain(value, false, fence)) return { valid: false };
    try {
      const field = descriptor(value, "url");
      if (!fence()) { if (field && "value" in field) retain(field.value); return { valid: false }; }
      if (!field) {
        // Only the installed empty native launch result is absence. Ignore no metadata.
        if (launch && Reflect.ownKeys(value).length === 0 && fence()) return { valid: true, url: null };
        return { valid: false };
      }
      if (!("value" in field) || typeof field.value !== "string") { if ("value" in field) retain(field.value); return { valid: false }; }
      return { valid: true, url: field.value };
    } catch { return { valid: false }; }
  }
  function classify(raw: string, fence = current): PendingIntent | null {
    try {
      if (hasWhitespaceOrControl(raw)) return null;
      const url = new URL(raw);
      if (!fence() || url.protocol !== "https:" || url.origin !== options.origin || url.pathname !== "/" || url.username || url.password || url.hash) return null;
      if (OWNED_CALLBACK_QUERY_FIELDS.some(key => url.searchParams.has(key))) return null;
      if (["inviteToken", "adminRequestId"].some(key => url.searchParams.getAll(key).length > 1)) return null;
      const params = { inviteToken: url.searchParams.get("inviteToken"), adminRequestId: url.searchParams.get("adminRequestId") };
      if (!isValidIntentValue("admin_request", params.adminRequestId) && !isValidIntentValue("invitation", params.inviteToken)) return null;
      if (!fence()) return null;
      const timestamp = options.now();
      if (!fence()) { retain(timestamp); return null; }
      const selected = selectDeepLinkIntent(params, timestamp);
      return fence() ? selected : null;
    } catch { return null; }
  }
  function capture(intent: PendingIntent): Promise<InitialCaptureOutcome> {
    const sequence = ++arrival;
    let pending: Promise<InitialCaptureOutcome>;
    if (inFlight?.kind === intent.kind && inFlight.value === intent.value) pending = inFlight.work;
    else {
      pending = own((async (): Promise<InitialCaptureOutcome> => {
        if (!current()) return { kind: "blocked" };
        try {
          const outcome = await options.capture(intent);
          if (!current()) return { kind: "blocked" };
          return outcome.kind === "applied" ? Object.freeze({ kind: "captured", intent: Object.freeze({ ...intent }) }) : Object.freeze({ kind: "not_captured" });
        } catch { return { kind: "not_captured" }; }
      })());
      inFlight = { kind: intent.kind, value: intent.value, work: pending };
      void pending.then(() => { if (inFlight?.work === pending) inFlight = null; });
    }
    latest = pending;
    void pending.then(outcome => {
      if (!current() || arrival !== sequence) return;
      status(outcome.kind === "captured" ? "listening" : "capture_failed");
    });
    return pending;
  }
  function event(value: unknown): void {
    if (!current()) return;
    const frame = { order: ++eventOrder, active: true };
    classifying.add(frame);
    const fence = () => current() && frame.active;
    try {
      const field = urlField(value, false, fence);
      if (!fence() || !field.valid || field.url === null) return;
      const intent = classify(field.url, fence);
      if (!fence() || !intent) return;
      // Eligibility, not merely callback entry, retires older classification work.
      for (const older of classifying) if (older.order < frame.order) older.active = false;
      eventSeen = true; capture(intent);
    } finally { classifying.delete(frame); }
  }
  function issueRemove(): void {
    if (!remove || removalIssued) return;
    removalIssued = true;
    try {
      own(observePlatformWork(remove(), options.isOwnDisposal).then(result => {
        if (result.kind !== "value" || result.value !== undefined) cleanupFailed = true;
      }, () => { cleanupFailed = true; }));
    } catch { cleanupFailed = true; }
  }
  function registration(value: unknown): void {
    // Late handles have cleanup-only ownership, even after delivery retirement.
    if (!plain(value, true)) { cleanupFailed = true; initFailed = true; return; }
    try {
      const field = descriptor(value, "remove");
      if (!field || !("value" in field) || typeof field.value !== "function") {
        if (field && "value" in field) retain(field.value);
        cleanupFailed = true; initFailed = true; return;
      }
      const operation = field.value;
      remove = () => apply(operation, value, []);
      if (closed) issueRemove();
    } catch { cleanupFailed = true; initFailed = true; }
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    initialCapture: (): Promise<InitialCaptureOutcome> => Promise.resolve(initial),
    start(): Promise<boolean> {
      if (closed) return Promise.resolve(false);
      if (startFlight) return startFlight;
      let finish!: (value: boolean) => void;
      startFlight = new Promise(resolve => { finish = resolve; });
      void (async () => {
        try {
          const port = options.port ?? await nativePort();
          if (!current()) return false;
          // Both calls occur before the first source await; no registration ACK claim.
          let registered: Promise<void>;
          try {
            const returned = port.addListener("appUrlOpen", event);
            registered = own(observePlatformWork(returned, options.isOwnDisposal).then(result => {
              if (result.kind !== "value") { initFailed = true; cleanupFailed = true; return; }
              registration(result.value);
            }, () => { initFailed = true; cleanupFailed = true; }));
          } catch { initFailed = true; cleanupFailed = true; return false; }
          let launched = Promise.resolve();
          if (current()) {
            try {
              const returned = port.getLaunchUrl();
              launched = own(observePlatformWork(returned, options.isOwnDisposal).then(result => {
                if (!current()) return;
                if (result.kind !== "value") { initFailed = true; return; }
                const field = urlField(result.value, true);
                if (!current()) return;
                if (!field.valid) { initFailed = true; return; }
                if (field.url === null || eventSeen) return;
                const intent = classify(field.url);
                if (current() && intent && !eventSeen) capture(intent);
              }, () => { initFailed = true; }));
            } catch { initFailed = true; }
          }
          await Promise.all([registered, launched]);
          // This exact barrier includes the latest capture already observed now.
          const boundary = latest;
          if (boundary) initial = await boundary;
          if (!alive()) return false;
          if (initFailed) { status("unavailable"); return false; }
          return true;
        } catch { initFailed = true; return false; }
      })().then(value => { if (initFailed && alive()) status("unavailable"); finish(value); },
        () => { initFailed = true; if (alive()) status("unavailable"); finish(false); });
      return startFlight;
    },
    close(): Promise<Readonly<{ ok: boolean }>> {
      if (closeFlight) return closeFlight;
      closed = true;
      closeFlight = Promise.resolve().then(async () => {
        if (startFlight) await startFlight;
        issueRemove();
        while (work.size) await Promise.all([...work]);
        return Object.freeze({ ok: !cleanupFailed });
      });
      status("closed");
      return closeFlight;
    },
  });
}
