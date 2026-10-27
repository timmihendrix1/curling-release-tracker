// Dormant actual sporting preparation. Reversible sporting encoding is not encryption. No app callers, publication or identity grants.
import { admitTransferPreparation } from "./installationTransferAdmission";
import type { NativeTransferPreparationContext } from "./installationTransferQuarantineSql";
import { createQuarantineWork } from "./installationTransferQuarantineWork";
import type { NativeSqliteStoreOptions, NativeTransferQuarantineCode } from "./nativeSqliteAdapter";

type Code = NativeTransferQuarantineCode | "busy" | "invalid_input" | "archive_refused" | "domain_refused" | "history_refused" | "prepared_recovery_required";
type Result = Readonly<{ code: Code; mayIssue: false; mayPublish: false; mayMount: false }>;
const result = (code: Code): Result => Object.freeze(Object.assign(Object.create(null), { code, mayIssue: false, mayPublish: false, mayMount: false }));
export function createInstallationTransferPreparation(options: NativeSqliteStoreOptions) {
  let recoveryRequired = false;
  let context: NativeTransferPreparationContext | null = null;
  let revoked = false;
  let pending: Promise<Result> | null = null;
  let closing: Promise<Result> | null = null;
  const own = (value: unknown) => value === pending || value === closing;
  const proceed = () => !revoked;
  async function target(): Promise<NativeTransferPreparationContext> {
    if (!context) {
      const { createInstallationTransferPreparationSql } = await import("./installationTransferQuarantineSql");
      if (!proceed()) throw null;
      context = createInstallationTransferPreparationSql(options, own);
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
          const admission = await admitTransferPreparation(wire, code, proceed);
          if (!admission.ok) answer = admission.code;
          else if (proceed()) {
            const sql = await target();
            if (proceed()) {
              const staged = (await work.value(sql.stage(admission.wire, admission.digest, proceed))).value;
              if (staged !== "quarantined" && staged !== "already_quarantined") answer = staged as NativeTransferQuarantineCode;
              else if (proceed()) {
                answer = (await work.value(sql.prepare(admission.wire, admission.digest, admission.rows, proceed))).value as NativeTransferQuarantineCode;
                if (answer === "prepared" || answer === "already_prepared") {
                  recoveryRequired = admission.recoveryRequired;
                  if (recoveryRequired) answer = "prepared_recovery_required";
                }
              }
            }
          }
        } else {
          const sql = await target();
          if (proceed()) answer = (await work.value(sql.inspect(proceed))).value as NativeTransferQuarantineCode;
        }
      } catch { /* Opaque native/provider failures never escape. */ }
      await work.finish();
      if (answer === "prepared" && recoveryRequired) answer = "prepared_recovery_required";
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
    inspect: () => command(false), prepare: (wire: unknown, code: unknown) => command(true, wire, code), close,
  })) as Readonly<{ inspect(): Promise<Result>; prepare(wire: unknown, code: unknown): Promise<Result>; close(): Promise<Result> }>;
}
