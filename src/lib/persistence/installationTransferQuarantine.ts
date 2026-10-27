// Dormant encrypted quarantine. No app callers, publication or identity grants.
import { openInstallationTransferV3 } from "./installationTransferProtection";
import { createQuarantineWork, isQuarantineProtectedWire } from "./installationTransferQuarantineWork";
import type { NativeSqliteStoreOptions, NativeTransferQuarantineContext, NativeTransferQuarantineCode } from "./nativeSqliteAdapter";

type Code = NativeTransferQuarantineCode | "busy" | "invalid_input" | "archive_refused";
type Result = Readonly<{ code: Code; mayIssue: false; mayPublish: false; mayMount: false }>;
const result = (code: Code): Result => Object.freeze(Object.assign(Object.create(null), { code, mayIssue: false, mayPublish: false, mayMount: false }));
export function createInstallationTransferQuarantine(options: NativeSqliteStoreOptions) {
  let context: NativeTransferQuarantineContext | null = null;
  let revoked = false;
  let pending: Promise<Result> | null = null;
  let closing: Promise<Result> | null = null;
  const own = (value: unknown) => value === pending || value === closing;
  const proceed = () => !revoked;
  async function target(): Promise<NativeTransferQuarantineContext> {
    if (!context) {
      const { createInstallationTransferQuarantineSql } = await import("./installationTransferQuarantineSql");
      if (!proceed()) throw null;
      context = createInstallationTransferQuarantineSql(options, own);
    }
    return context;
  }
  function command(stage: boolean, wire?: unknown, code?: unknown): Promise<Result> {
    if (revoked) return Promise.resolve(result("closed"));
    if (pending || closing) return Promise.resolve(result("busy"));
    let settle!: (value: Result) => void;
    const whole = new Promise<Result>(resolve => { settle = resolve; });
    pending = whole;
    void (async () => {
      const work = createQuarantineWork(own);
      let answer: Code = "unavailable";
      try {
        if (stage) {
          if (!isQuarantineProtectedWire(wire) || typeof code !== "string" || code.length !== 47 || !/^ct1-[A-Za-z0-9_-]{43}$/.test(code)) answer = "invalid_input";
          else {
            const opened = await openInstallationTransferV3(wire, code);
            if (!opened.ok) answer = "archive_refused";
            else if (proceed()) {
              const sql = await target();
              if (proceed()) answer = (await work.value(sql.stage(wire, opened.packageDigest, proceed))).value as NativeTransferQuarantineCode;
            }
          }
        } else {
          const sql = await target();
          if (proceed()) answer = (await work.value(sql.inspect(proceed))).value as NativeTransferQuarantineCode;
        }
      } catch { /* Opaque native/provider failures never escape. */ }
      await work.finish();
      pending = null;
      settle(result(revoked ? "closed" : answer));
    })();
    return whole;
  }
  function close(): Promise<Result> {
    revoked = true;
    if (closing) return closing;
    const operation = pending;
    let settle!: (value: Result) => void;
    const whole = new Promise<Result>(resolve => { settle = resolve; });
    closing = whole;
    void (async () => {
      if (operation) await operation;
      let code: Code = "closed";
      if (context) {
        try { code = await context.close(); } catch { code = "cleanup_held"; }
      }
      closing = null;
      settle(result(code));
    })();
    return whole;
  }
  return Object.freeze(Object.assign(Object.create(null), {
    inspect: () => command(false), stage: (wire: unknown, code: unknown) => command(true, wire, code), close,
  })) as Readonly<{ inspect(): Promise<Result>; stage(wire: unknown, code: unknown): Promise<Result>; close(): Promise<Result> }>;
}
