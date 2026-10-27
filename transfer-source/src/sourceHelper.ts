// Isolated observation only; never an original-container/frozen-source proof.
import { createInstallationTransferWebViewSource } from "../../src/lib/persistence/localStorageAdapter";
import { observePlatformWork, drainObservedPlatformWork } from "../../src/lib/persistence/platformSha256";

type Code = "unavailable" | "wrong_host" | "closed" | "source_changed" | "source_unhealthy" | "source_unsupported";
type Fn = (...args: never[]) => unknown;
type Source = ReturnType<typeof createInstallationTransferWebViewSource>;
type Capture = Awaited<ReturnType<Source["capture"]>>;
type Result = Readonly<({ ok: true; kind: "source_observation"; counts: Extract<Capture, { ok: true }>["counts"] } | { ok: false; code: Code }) & typeof grants>;
type Port = Readonly<{ core: object; app: object; native: Fn; platform: Fn; available: Fn; add: Fn; state: Fn; info: Fn }>;
const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor, nativeThen = Promise.prototype.then;
const seal = <T extends object>(value: T): Readonly<T> => Object.freeze(Object.assign(Object.create(null), value));
const grants = { mayIssue: false as const, mayPublish: false as const, mayMount: false as const };
const refused = (code: Code): Result => seal({ ok: false as const, code, ...grants });
const label = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function createInstallationTransferSourceHelper() {
  let notifyRevoked!: (code: Code) => void;
  // Logical revocation only; this signal never acknowledges joined cleanup.
  const whenRevoked = new Promise<Code>(resolve => { notifyRevoked = resolve; });
  let closed = false, closeWork: Promise<void> | null = null;
  let active: Promise<Result> | null = null, callback: Promise<void> | null = null;
  let source: Source | null = null, sourceClose: Promise<void> | null = null;
  let port: Port | null = null, binding: string | null = null;
  let remove: { receiver: object; fn: Fn } | null = null;
  const inert = new WeakSet<object>();
  const ownWork = (value: unknown) => value === whenRevoked || closeWork !== null && value === closeWork || active !== null && value === active || callback !== null && value === callback;
  const owned = (value: unknown) => ownWork(value) ||
    value !== null && typeof value === "object" && inert.has(value);

  function context(current: () => boolean) {
    let code: Code = "unavailable";
    const roots = new Set<unknown>(), watched = new Map<unknown, ReturnType<typeof observePlatformWork>>();
    function keep<T>(value: T): T {
      if (value !== null && (typeof value === "object" || typeof value === "function")) roots.add(value);
      return value;
    }
    function stop(next: Code = "unavailable"): never { code = next; throw null; }
    function ensure() { if (!current()) stop(closed ? "closed" : "unavailable"); }
    function read<T>(operation: () => T): T { ensure(); const value = keep(operation()); ensure(); return value; }
    function watch(value: unknown) {
      keep(value); let result = watched.get(value);
      if (!result) { result = observePlatformWork(value, owned); watched.set(value, result); }
      return result;
    }
    async function value(input: unknown) {
      const result = await watch(input);
      if (result.kind !== "value") stop();
      return result;
    }
    async function sync(input: unknown) {
      const result = await value(input);
      if (result.value !== input) stop();
      return result;
    }
    function field(target: object, name: string): unknown {
      ensure(); const found = descriptor(target, name);
      if (found) {
        if (Object.hasOwn(found, "value")) keep(found.value);
        if (Object.hasOwn(found, "get")) keep(found.get);
        if (Object.hasOwn(found, "set")) keep(found.set);
      }
      ensure(); if (!found || !Object.hasOwn(found, "value")) stop();
      return found.value;
    }
    async function finish() {
      await Promise.all([...roots].map(root => {
        const held = watched.get(root);
        return held ? held.then(() => {}, () => {}) : drainObservedPlatformWork(root, owned);
      }));
    }
    return { keep, read, watch, value, sync, field, stop, ensure, finish, code: () => code };
  }
  type Context = ReturnType<typeof context>;
  const object = (ctx: Context, value: unknown): object => {
    if (!value || typeof value !== "object") ctx.stop(); return value as object;
  };
  const fn = (ctx: Context, value: unknown): Fn => {
    if (typeof value !== "function") ctx.stop(); return value as Fn;
  };
  async function data(ctx: Context, target: object, name: string) {
    const value = (await ctx.sync(ctx.field(target, name))).value; ctx.ensure(); return seal({ value });
  }
  function appReceiver(ctx: Context, input: unknown): object {
    const receiver = object(ctx, input);
    if (ownWork(receiver)) ctx.stop();
    if (inert.has(receiver)) return receiver;
    let probe: unknown;
    try {
      // An actual App Proxy manufactures App.then. Probe only the native brand.
      probe = apply(nativeThen, receiver, [(value: unknown) => ctx.watch(value), () => {}]);
    } catch {
      inert.add(receiver); ctx.keep(receiver); return receiver;
    }
    ctx.keep(receiver); ctx.keep(probe); return ctx.stop();
  }
  async function capture(ctx: Context): Promise<Port> {
    const coreModule = object(ctx, (await ctx.value(ctx.read(() => import("@capacitor/core")))).value); ctx.ensure();
    const core = object(ctx, (await data(ctx, coreModule, "Capacitor")).value);
    const native = fn(ctx, (await data(ctx, core, "isNativePlatform")).value);
    if ((await ctx.sync(ctx.read(() => apply(native, core, [])))).value !== true) ctx.stop("wrong_host"); ctx.ensure();
    const platform = fn(ctx, (await data(ctx, core, "getPlatform")).value);
    if ((await ctx.sync(ctx.read(() => apply(platform, core, [])))).value !== "ios") ctx.stop("wrong_host"); ctx.ensure();
    const available = fn(ctx, (await data(ctx, core, "isPluginAvailable")).value);
    if ((await ctx.sync(ctx.read(() => apply(available, core, ["App"])))).value !== true) ctx.stop("wrong_host"); ctx.ensure();
    const appModule = object(ctx, (await ctx.value(ctx.read(() => import("@capacitor/app")))).value); ctx.ensure();
    const app = appReceiver(ctx, ctx.field(appModule, "App")); ctx.ensure();
    if (port) {
      if (core !== port.core || app !== port.app || native !== port.native || platform !== port.platform || available !== port.available) ctx.stop();
      return port;
    }
    // Exact known Proxy properties; descriptors would reject the actual API.
    const method = async (name: "addListener" | "getState" | "getInfo") => fn(ctx, (await ctx.sync(ctx.read(() => (app as Record<string, unknown>)[name]))).value);
    const add = await method("addListener"), state = await method("getState"), info = await method("getInfo");
    ctx.ensure(); return seal({ core, app, native, platform, available, add, state, info });
  }
  async function foreground(ctx: Context, held: Port) {
    const result = object(ctx, (await ctx.value(ctx.read(() => apply(held.state, held.app, [])))).value); ctx.ensure();
    if ((await data(ctx, result, "isActive")).value !== true) ctx.stop("wrong_host"); ctx.ensure();
  }
  async function identity(ctx: Context, held: Port) {
    const result = object(ctx, (await ctx.value(ctx.read(() => apply(held.info, held.app, [])))).value); ctx.ensure();
    if ((await data(ctx, result, "id")).value !== "local.dev.curlingperformance") ctx.stop("wrong_host");
    const version = (await data(ctx, result, "version")).value;
    if (typeof version !== "string" || version.length > 64 || !label.test(version)) return ctx.stop();
    const build = (await data(ctx, result, "build")).value;
    if (typeof build !== "string" || build.length > 64 || !label.test(build)) return ctx.stop();
    const observed = version + ":" + build;
    if (binding !== null && binding !== observed) ctx.stop("wrong_host"); ctx.ensure(); binding ??= observed;
  }
  function onState(payload: unknown): void {
    if (closed) return;
    if (callback) { void close(); return; }
    let done!: () => void;
    const work = new Promise<void>(resolve => { done = resolve; }); callback = work;
    const ctx = context(() => !closed);
    try {
      const result = object(ctx, ctx.keep(payload));
      if (ctx.field(result, "isActive") !== true) void close();
    } catch { void close(); }
    void ctx.finish().then(() => { if (callback === work) callback = null; done(); });
  }
  function close(): Promise<void> { return revoke("closed"); }
  function revoke(code: Code): Promise<void> {
    if (closeWork) return closeWork;
    closed = true;
    let done!: () => void;
    closeWork = new Promise<void>(resolve => { done = resolve; });
    notifyRevoked(code);
    // Revoke S6d immediately. Its unchanged C4 boundary still excludes only its
    // own work, not malformed cyclic parent work returned by a source provider.
    if (source) sourceClose = source.close();
    const held = active, heldCallback = callback;
    void (async () => {
      await Promise.all([held, heldCallback]);
      const ctx = context(() => true);
      if (remove) {
        const removal = remove; remove = null;
        try { await ctx.value(ctx.keep(apply(removal.fn, removal.receiver, []))); } catch { /* Opaque JS receipt failure, no physical ACK. */ }
      }
      await ctx.finish(); await sourceClose; done();
    })();
    return closeWork;
  }
  function inspect(): Promise<Result> {
    if (closed) return Promise.resolve(refused("closed"));
    if (active || callback) return Promise.resolve(refused("unavailable"));
    let done!: (result: Result) => void;
    const work = new Promise<Result>(resolve => { done = resolve; }); active = work;
    const ctx = context(() => !closed && active === work && !callback);
    void (async () => {
      let result: Result;
      try {
        const held = await capture(ctx); ctx.ensure();
        if (!port) {
          port = held;
          // Capture late handles even after revocation; close joins this work.
          ctx.ensure();
          const returned = ctx.keep(apply(held.add, held.app, ["appStateChange", onState]));
          const handle = object(ctx, (await ctx.value(returned)).value);
          const cleanup = descriptor(handle, "remove");
          if (cleanup) {
            if (Object.hasOwn(cleanup, "value")) ctx.keep(cleanup.value);
            if (Object.hasOwn(cleanup, "get")) ctx.keep(cleanup.get);
            if (Object.hasOwn(cleanup, "set")) ctx.keep(cleanup.set);
          }
          if (!cleanup || !Object.hasOwn(cleanup, "value")) return ctx.stop();
          const observed = await ctx.sync(cleanup.value);
          remove = { receiver: handle, fn: fn(ctx, observed.value) }; ctx.ensure();
        }
        await foreground(ctx, held); await identity(ctx, held); ctx.ensure();
        source ??= createInstallationTransferWebViewSource();
        const observation = await source.capture(); ctx.ensure();
        if (!observation.ok) return ctx.stop(observation.code === "closed" ? "closed" : observation.code);
        await foreground(ctx, held); await identity(ctx, held); ctx.ensure();
        const fence = await source.fence(observation.proof); ctx.ensure();
        if (fence !== "unchanged") ctx.stop(fence === "changed" ? "source_changed" : fence === "closed" ? "closed" : "unavailable");
        result = seal({ ok: true as const, kind: "source_observation" as const, counts: observation.counts, ...grants });
      } catch {
        const code = closed ? "closed" : ctx.code();
        result = refused(code); void revoke(code);
      }
      await ctx.finish();
      if (closed && result.ok) result = refused("closed");
      if (active === work) active = null;
      done(result);
    })();
    return work;
  }
  return seal({ inspect, close, whenRevoked });
}
