// Explicit destination UI owner. No shipped root selects this workflow.
import { createConfiguredInstallationTransferApplicationHost, createConfiguredPublishedInstallationIdentityHost,
  type NativeConfiguredInstallationTransferIdentityHostOptions, type NativeIdentityBootstrapHost,
  type NativeInstallationTransferApplicationHost, type NativeSportingIdentityRuntimeReady,
  type NativeAuthCleanup } from "./supabaseAuthService";
import { resolveNativeProviderConfiguration } from "./nativeProviderConfiguration";
import { createQuarantineWork, isQuarantineProtectedWire } from "../persistence/installationTransferQuarantineWork";
type IdentityRuntimeReady = Extract<Awaited<ReturnType<NativeIdentityBootstrapHost["start"]>>, { outcome: "ready" }>["runtime"];
import type { AccountDeletionState } from "../identity/accountDeletion";

type Options = Omit<NativeConfiguredInstallationTransferIdentityHostOptions, "installationTransfer">;
export type InstallationTransferApplicationSnapshot = Readonly<{
  phase: "select" | "reading" | "preparing" | "access" | "workspace" | "closing" | "restart" | "blocked" | "closed";
  runtime: IdentityRuntimeReady | null;
  busy: boolean;
  notice: string | null;
  pendingDeletion: AccountDeletionState | null;
  accountStatus: "unchecked" | "clear" | "pending" | "unavailable" | "cancelled";
  dataStored: boolean;
  cleanupPending: boolean;
  publication: Awaited<ReturnType<NativeInstallationTransferApplicationHost["completeImport"]>> | null;
}>;
const maximumFileSize = "curling-protected-installation-v1\nAES-256-GCM-V3ASCII\n".length + 17 + Math.ceil((25165824 + 16) * 4 / 3);
const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn, nativeThen = Promise.prototype.then;
const unavailable = "The import could not be completed. Existing data has not been removed.";
const signInAgain = "Check account recovery, then sign out and sign in again before retrying the import.";

/** Construct once outside React. Presentation snapshots never authorize storage. */
export function createInstallationTransferApplication(binding: unknown, input: Options) {
  const configured = resolveNativeProviderConfiguration(binding);
  let snapshot: InstallationTransferApplicationSnapshot = Object.freeze({ phase: configured ? "select" : "blocked", runtime: null,
    busy: false, notice: configured ? null : "Import configuration is unavailable.", pendingDeletion: null, accountStatus: "unchecked", dataStored: false, cleanupPending: false, publication: null });
  const listeners = new Set<() => void>();
  let options: Options | null = null, supplied: unknown = input;
  input = undefined as unknown as Options;
  let host: NativeIdentityBootstrapHost | null = null, transfer: NativeInstallationTransferApplicationHost | null = null;
  let terminal = !configured, flight: Promise<void> | null = null, lastClose: Promise<NativeAuthCleanup> | null = null;
  let cleanup: NativeAuthCleanup | null = null;
  const current = () => !terminal;
  const owns = (value: unknown) => value === flight || value === lastClose;
  function update(fields: Partial<InstallationTransferApplicationSnapshot>) {
    snapshot = Object.freeze({ ...snapshot, ...fields });
    for (const listener of [...listeners]) { try { listener(); } catch { /* Presentation cannot grant or undo work. */ } }
  }
  function ensure() { if (!current()) throw null; }
  async function capture(): Promise<Options> {
    if (options) return options;
    const work = createQuarantineWork(owns);
    const keep = (value: unknown) => {
      work.field({ value }, "value");
      // Intrinsic native-Promise detection precedes copying any own fields.
      // A masked .then must not turn asynchronous metadata into plain options.
      let observed: unknown;
      try { observed = apply(nativeThen, value, [() => {}, () => {}]); }
      catch { return value; }
      work.field({ value: observed }, "value");
      throw null;
    };
    function field(receiver: unknown, name: string, optional = false): unknown {
      ensure(); keep(receiver);
      if (!receiver || typeof receiver !== "object" && typeof receiver !== "function") throw null;
      const item = descriptor(receiver, name);
      if (item) { keep(item.value); keep(item.get); keep(item.set); }
      ensure();
      if (!item) { if (optional) return undefined; throw null; }
      if (!hasOwn(item, "value")) throw null;
      return item.value;
    }
    const fn = (value: unknown) => { if (typeof value !== "function") throw null; return value; };
    try {
      const root = keep(supplied); ensure();
      const migration = field(root, "migration"), sqlite = field(migration, "sqlite");
      const databaseName = field(sqlite, "databaseName"); if (typeof databaseName !== "string" || !databaseName) throw null;
      const engine = field(sqlite, "engine", true); if (engine !== undefined && (!engine || typeof engine !== "object")) throw null;
      const sqlPlatform = field(sqlite, "detectPlatform", true); if (sqlPlatform !== undefined) fn(sqlPlatform);
      const bounds = field(migration, "limits"), limits: Record<string, number> = {};
      for (const name of ["checkpointBatchKeyLimit", "latchWriteAttemptLimit", "maxPlansPerRun", "protocolStepLimit", "faultWriteAttemptLimit"]) {
        const value = field(bounds, name); if (!Number.isSafeInteger(value) || (value as number) <= 0) throw null; limits[name] = value as number;
      }
      const protectedBinding = field(migration, "protectedBinding", true); if (protectedBinding !== undefined && (!protectedBinding || typeof protectedBinding !== "object")) throw null;
      const detectPlatform = field(migration, "detectPlatform", true); if (detectPlatform !== undefined) fn(detectPlatform);
      const generateUuid = fn(field(migration, "generateUuid")), now = fn(field(migration, "now"));
      const fetch = fn(field(root, "fetch"));
      const resolveAppOrigin = field(root, "resolveAppOrigin", true); if (resolveAppOrigin !== undefined) fn(resolveAppOrigin);
      const navigate = field(root, "navigate", true); if (navigate !== undefined) fn(navigate);
      const url = field(root, "callbackUrlAccess"), readCurrentUrl = fn(field(url, "readCurrentUrl")), replaceCurrentUrl = fn(field(url, "replaceCurrentUrl"));
      const captured = Object.freeze({ migration: Object.freeze({ sqlite: Object.freeze({ databaseName, engine, detectPlatform: sqlPlatform }),
        limits: Object.freeze(limits), protectedBinding, detectPlatform, generateUuid, now }), fetch, resolveAppOrigin, navigate,
        callbackUrlAccess: Object.freeze({ readCurrentUrl: () => apply(readCurrentUrl, url, []), replaceCurrentUrl: (...args: unknown[]) => apply(replaceCurrentUrl, url, args) }) }) as unknown as Options;
      await work.finish(); ensure(); options = captured; return captured;
    } finally { supplied = undefined; await work.finish(); }
  }
  async function readFile(file: unknown): Promise<string> {
    const work = createQuarantineWork(owns), keep = (value: unknown) => work.field({ value }, "value");
    let bytes: Uint8Array | null = null;
    function getter(receiver: object, name: string): (...args: never[]) => unknown {
      ensure(); keep(receiver); const item = descriptor(receiver, name); if (item) { keep(item.get); keep(item.set); keep(item.value); }
      ensure(); if (typeof item?.get !== "function") throw null; return item.get;
    }
    try {
      keep(file); ensure();
      const FileType = keep(work.field(globalThis, "File")); ensure(); if (typeof FileType !== "function") throw null;
      const filePrototype = keep(work.field(FileType, "prototype")); ensure(); if (!filePrototype || typeof filePrototype !== "object") throw null;
      const fileName = keep(apply(getter(filePrototype, "name"), file, [])); ensure(); if (typeof fileName !== "string") throw null;
      const BlobType = keep(work.field(globalThis, "Blob")); ensure(); if (typeof BlobType !== "function") throw null;
      const blobPrototype = keep(work.field(BlobType, "prototype")); ensure(); if (!blobPrototype || typeof blobPrototype !== "object") throw null;
      const size = keep(apply(getter(blobPrototype, "size"), file, [])); ensure();
      if (!Number.isSafeInteger(size) || (size as number) <= 0 || (size as number) > maximumFileSize) throw null;
      const Reader = keep(work.field(globalThis, "FileReader")); ensure(); if (typeof Reader !== "function") throw null;
      const readerPrototype = keep(work.field(Reader, "prototype")); ensure(); if (!readerPrototype || typeof readerPrototype !== "object") throw null;
      const read = keep(work.field(readerPrototype, "readAsArrayBuffer")); ensure(); if (typeof read !== "function") throw null;
      const result = getter(readerPrototype, "result"), readyState = getter(readerPrototype, "readyState");
      const reader = keep(Reflect.construct(Reader, [])) as FileReader; ensure();
      let settle!: (value: { ok: boolean; value?: unknown }) => void;
      const loaded = new Promise<{ ok: boolean; value?: unknown }>(resolve => { settle = resolve; });
      reader.onload = () => { if (!current()) { settle({ ok: false }); return; } try { settle({ ok: true, value: keep(apply(result, reader, [])) }); } catch { settle({ ok: false }); } };
      reader.onerror = reader.onabort = () => { settle({ ok: false }); };
      let returned: unknown, metadataValid = true, readAttempted = false;
      try {
        ensure(); readAttempted = true; returned = keep(apply(read, reader, [file]));
      } catch { metadataValid = false; if (!readAttempted) settle({ ok: false }); }
      if (readAttempted && current()) {
        try {
          const issuedState = keep(apply(readyState, reader, []));
          // Only an actual EMPTY observation establishes that no read issued.
          // Invalid/throwing metadata cannot replace an issued read's delivery.
          if (issuedState === 0) settle({ ok: false });
          else if (issuedState !== 1 && issuedState !== 2) metadataValid = false;
        } catch { metadataValid = false; }
      }
      const loadedValue = await loaded;
      reader.onload = reader.onerror = reader.onabort = null;
      ensure(); if (!metadataValid || returned !== undefined || !loadedValue.ok) throw null;
      const lengthGetter = getter(ArrayBuffer.prototype, "byteLength"), length = keep(apply(lengthGetter, loadedValue.value, [])); ensure();
      bytes = new Uint8Array(loadedValue.value as ArrayBuffer);
      if (length !== size) throw null;
      const chunks: string[] = [];
      for (let index = 0; index < bytes.length; index += 4096) {
        const chunk = bytes.subarray(index, index + 4096); if (chunk.some(value => value > 127)) throw null;
        chunks.push(String.fromCharCode(...chunk));
      }
      const wire = chunks.join(""); if (!isQuarantineProtectedWire(wire)) throw null;
      await work.finish(); ensure(); return wire;
    } finally { await work.finish(); bytes?.fill(0); }
  }
  function showCleanup(value: NativeAuthCleanup) {
    if (terminal) update({ cleanupPending: !value.ok, phase: value.ok ? snapshot.dataStored ? "restart" : "closed" : "blocked", runtime: null, busy: false,
      notice: value.ok ? snapshot.dataStored ? "Import saved. Close and reopen the app to open your training data." : "The import has ended." : "The import has stopped. Cleanup could not be confirmed. Keep the original app and data." });
  }
  function observeClose(actual: Promise<NativeAuthCleanup>) {
    if (lastClose === actual) { if (cleanup) showCleanup(cleanup); return; }
    lastClose = actual; cleanup = null;
    void actual.then(value => { cleanup = value; showCleanup(value); });
  }
  function close(): Promise<NativeAuthCleanup> | void {
    terminal = true; update({ phase: "closing", busy: true });
    if (host) { const actual = host.dispose(); observeClose(actual); return actual; }
    // No outward promise can be returned to a constructor that this flight owns.
    if (!flight) { supplied = undefined; update({ phase: "closed", busy: false, runtime: null, notice: "The import has ended." }); }
  }
  async function retireAttempt(): Promise<boolean> {
    if (!host) return true;
    const actual = host.dispose(); const value = await actual;
    cleanup = value;
    if (!value.ok) { terminal = true; observeClose(actual); update({ phase: "blocked", busy: false, runtime: null, cleanupPending: true, notice: unavailable }); return false; }
    host = transfer = null; cleanup = null; return true;
  }
  function issue(operation: () => Promise<void>) {
    if (terminal || flight) return;
    const whole = Promise.resolve().then(operation).catch(async () => { if (!terminal) { if (!await retireAttempt()) return; update({ phase: "select", runtime: null, busy: false, notice: unavailable }); } });
    flight = whole;
    void whole.then(async () => {
      if (flight === whole) flight = null;
      if (terminal && host && !cleanup) { const actual = host.dispose(); observeClose(actual); await actual; }
      else if (terminal && !host) update({ phase: "closed", busy: false, runtime: null, notice: "The import has ended." });
    });
  }
  function openPublished() {
    if (snapshot.phase !== "select") return;
    issue(async () => {
      update({ phase: "preparing", busy: true, notice: null }); const captured = await capture(); ensure();
      const made = await createConfiguredPublishedInstallationIdentityHost(binding, captured);
      if (!made.ok) { ensure(); update({ phase: "select", busy: false, notice: unavailable }); return; }
      host = made.host;
      if (!current()) { const actual = host.dispose(); observeClose(actual); await actual; return; }
      const started = await host.start(); ensure();
      if (started.outcome === "ready") update({ phase: "workspace", runtime: started.runtime, busy: false, notice: null });
      else if (await retireAttempt()) { ensure(); update({ phase: "select", busy: false, notice: "Imported training could not be opened. Select an import file only if you need to transfer existing data." }); }
    });
  }
  function importFile(file: unknown, code: string) {
    if (snapshot.phase !== "select") return;
    let selected = file, recovery: string | null = code; file = undefined; code = "";
    issue(async () => {
      try {
        update({ phase: "reading", busy: true, notice: null });
        if (typeof recovery !== "string" || !/^ct1-[A-Za-z0-9_-]{43}$/.test(recovery)) throw null;
        const captured = await capture(); ensure();
        let wire: string | null = await readFile(selected); selected = undefined; ensure();
        update({ phase: "preparing" });
        const constructing = createConfiguredInstallationTransferApplicationHost(binding, { ...captured, installationTransfer: { protectedWire: wire, recoveryCode: recovery } });
        wire = recovery = null;
        const made = await constructing;
        if (!made.ok) { ensure(); update({ phase: "select", busy: false, notice: unavailable }); return; }
        host = transfer = made.host;
        if (!current()) { const actual = host.dispose(); observeClose(actual); await actual; return; }
        const started = await host.start(); ensure();
        if (started.outcome === "ready") update({ phase: "access", runtime: started.runtime, busy: false, notice: null });
        else if (await retireAttempt()) { ensure(); update({ phase: "select", busy: false, notice: "The file or recovery code could not be verified. Check both and try again." }); }
      } finally { selected = undefined; recovery = null; }
    });
  }
  function checkAccountDeletion() {
    if (snapshot.phase !== "access" || !transfer) return;
    issue(async () => {
      update({ busy: true }); const value = await transfer!.checkAccountDeletion(); ensure();
      update({ busy: false, pendingDeletion: value.ok ? value.value : null, accountStatus: value.ok ? value.value ? "pending" : "clear" : "unavailable",
        notice: value.ok ? value.value ? "Account deletion is pending. Resolve it before importing training." : "Account check complete. If access is still locked, sign out and sign in again." : "Account status could not be checked. Sign in and try again." });
    });
  }
  function cancelAccountDeletion(requestId: string) {
    if (snapshot.phase !== "access" || !transfer) return;
    issue(async () => {
      update({ busy: true }); const value = await transfer!.cancelAccountDeletion(requestId); ensure();
      update({ busy: false, pendingDeletion: value.ok && value.value ? null : snapshot.pendingDeletion, accountStatus: value.ok && value.value ? "cancelled" : "unavailable",
        notice: value.ok && value.value ? "Account deletion cancelled. Sign out and sign in again before importing training." : "Account deletion could not be cancelled. Sign in with a new email code and try again." });
    });
  }
  function completeImport() {
    if (snapshot.phase !== "access" || !transfer) return;
    issue(async () => {
      update({ busy: true, notice: "Checking your account before importing…" });
      const account = await transfer!.checkAccountDeletion(); ensure();
      if (!account.ok || account.value !== null) { update({ busy: false, pendingDeletion: account.ok ? account.value : null, notice: "Resolve account recovery before importing training." }); return; }
      const prepared = await transfer!.prepareImport(); ensure();
      if (prepared.code !== "publication_intent") { update({ busy: false, notice: signInAgain }); return; }
      const outcome = await transfer!.completeImport();
      const stored = outcome.code === "publication_confirmed" && outcome.observedLayout === "desired11";
      update({ publication: outcome, dataStored: stored || snapshot.dataStored }); // Factual SQL outcome survives Close/auth loss.
      if (!current()) return;
      if (!stored && outcome.code === "publication_refused") { update({ busy: false, notice: signInAgain }); return; }
      terminal = true; update({ phase: "closing", busy: true, notice: stored ? "Import saved. Finishing access checks…" : unavailable });
      const actual = host!.dispose(); observeClose(actual); await actual;
    });
  }
  return Object.freeze({ getSnapshot: () => snapshot, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    openPublished, importFile, checkAccountDeletion, cancelAccountDeletion, completeImport, close });
}
export type InstallationTransferApplication = ReturnType<typeof createInstallationTransferApplication>;
export type PublishedInstallationApplicationRuntime = NativeSportingIdentityRuntimeReady;
