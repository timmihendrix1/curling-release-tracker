// Completion ownership for the dormant quarantine and preparation modules only.
import { observePlatformWork, drainObservedPlatformWork } from "./platformSha256";
export type QuarantineWork = ReturnType<typeof createQuarantineWork>;
export function createQuarantineWork(own: (value: unknown) => boolean = () => false, invalid?: () => void) {
  const broken = (): never => { invalid?.(); throw null; };
  const roots = new Set<unknown>();
  const drained = new Map<unknown, Promise<void>>();
  const observations = new Set<ReturnType<typeof observePlatformWork>>();
  const watched = new Map<unknown, ReturnType<typeof observePlatformWork>>();
  function keep(value: unknown): void {
    if (value !== null && (typeof value === "object" || typeof value === "function")) roots.add(value);
  }
  function field(value: unknown, name: string): unknown {
    keep(value);
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return broken();
    const d = Object.getOwnPropertyDescriptor(value, name);
    if (d) { keep(d.value); keep(d.get); keep(d.set); }
    if (!d || !Object.hasOwn(d, "value")) return broken();
    return d.value;
  }
  async function value(input: unknown): Promise<Readonly<{ value: unknown }>> {
    keep(input);
    // A new native issuance always gets a fresh observation, even when its
    // returned object was an earlier fulfillment. Completion deduplication below
    // never provides another call's value or acknowledgement.
    const work = observePlatformWork(input, own, invalid);
    observations.add(work); watched.set(input, work);
    const box = await work;
    if (box.kind !== "value" || own(box.value)) return broken();
    watched.set(box.value, work); // Already observed fulfillment: never assimilate it again during drain.
    return { value: box.value };
  }
  function keys(input: unknown, expected: readonly string[]): void {
    keep(input);
    if (!input || typeof input !== "object") return broken();
    const names = Reflect.ownKeys(input);
    if (names.length !== expected.length || names.some(n => typeof n !== "string" || !expected.includes(n))) return broken();
  }
  function rows(input: unknown, names: readonly string[], limit: number, validate: (name: string, value: unknown, index: number) => void = () => {}): Record<string, unknown>[] {
    keys(input, ["values"]);
    const list = field(input, "values");
    if (!Array.isArray(list)) return broken();
    const length = field(list, "length");
    if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > limit) return broken();
    keys(list, ["length", ...Array.from({ length: length as number }, (_, i) => String(i))]);
    return Array.from({ length: length as number }, (_, i) => {
      const row = field(list, String(i)); keys(row, names);
      const copy: Record<string, unknown> = Object.create(null);
      for (const name of names) {
        const value = field(row, name); validate(name, value, i); copy[name] = value;
      }
      return copy;
    });
  }
  function ack(input: unknown, count = 0, expectedLastId = 1): void {
    keys(input, ["changes"]); const changes = field(input, "changes");
    keys(changes, count === 1 ? ["changes", "lastId", "values"] : ["changes"]);
    if (field(changes, "changes") !== count) return broken();
    if (count === 1) {
      // Installed iOS Database.runSQL -> ReturnHandler.rChanges contract.
      if (field(changes, "lastId") !== expectedLastId) return broken();
      const values = field(changes, "values");
      if (!Array.isArray(values) || field(values, "length") !== 0) return broken();
      keys(values, ["length"]);
    }
  }
  // UPDATE/DELETE lastId reflects SQLite's last insertion, not an addressed row.
  function mutationAck(input: unknown, count: number): void {
    keys(input, ["changes"]); const changes = field(input, "changes");
    keys(changes, ["changes", "lastId", "values"]);
    if (field(changes, "changes") !== count || !Number.isSafeInteger(field(changes, "lastId"))) return broken();
    const values = field(changes, "values");
    if (!Array.isArray(values) || field(values, "length") !== 0) return broken();
    keys(values, ["length"]);
  }
  async function finish(): Promise<void> {
    await Promise.all([...observations].map(work => work.then(() => {}, () => {})));
    await Promise.all([...roots].map(root => {
      let completion = drained.get(root);
      if (!completion) {
        const work = watched.get(root);
        completion = work ? work.then(() => {}, () => {}) : drainObservedPlatformWork(root, own);
        drained.set(root, completion);
      }
      return completion;
    }));
  }
  return { value, field, rows, ack, mutationAck, finish };
}

/** Structural ASCII envelope check only; never authentication. */
export function isQuarantineProtectedWire(input: unknown): input is string {
  // Pinned to S6e's existing 25,165,824-byte V3 wire bound in architecture tests.
  const header = "curling-protected-installation-v1\nAES-256-GCM-V3ASCII\n";
  const maximum = header.length + 17 + Math.ceil((25165824 + 16) * 4 / 3);
  if (typeof input !== "string" || input.length > maximum || !input.startsWith(header)) return false;
  const parts = input.slice(header.length).split("\n");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]{16}$/.test(parts[0])) return false;
  const body = parts[1];
  if (body.length < 23 || body.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(body)) return false;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(body.at(-1)!);
  return body.length % 4 === 2 ? last % 16 === 0 : body.length % 4 === 3 ? last % 4 === 0 : true;
}
