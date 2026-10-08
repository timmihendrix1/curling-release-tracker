// The one invariant that makes "a write this build accepts is a read this build can
// perform" true by construction, rather than by maintaining a list of special-case
// guards that drifts away from what migration actually does.
//
// The cloud reader accepts a training record only when `migrateSession(parsed)`
// deep-equals `parsed` (src/lib/cloudSporting/records.ts) — anything migration would
// change makes the stored payload and the restored value disagree, so the record is
// unrestorable. For a measurement-aware session that condition is therefore also the
// WRITE condition: if migration would repair, default, renumber or discard any part of
// it, the session is not in canonical new-format shape and must be rejected rather
// than silently repaired into something else.
//
// Legacy sessions are deliberately exempt. Their field-by-field repair rules
// (ADR-0005) are long-standing behaviour, their stored bytes must not change, and
// their records were written by a build that produced exactly what it read back.
import type { Session } from "../../types";
import { migrateSession } from "../sessionMigration";
import { usesBlockMeasurementConfiguration } from "./validation";

/**
 * Structural deep equality that ignores keys whose value is `undefined`, matching how
 * JSON serialization and the cloud record comparison already treat them.
 */
function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return Object.is(left, right);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => sameJsonValue(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined).sort();
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) => key === rightKeys[index] && sameJsonValue(leftRecord[key], rightRecord[key])
  );
}

/**
 * Whether a measurement-aware session is already in the exact shape migration would
 * produce — i.e. whether reading it back changes nothing at all.
 *
 * This is the TERMINAL-RECORD condition. It is deliberately stricter than what local
 * training needs, because the cloud reader accepts a record only when the stored
 * payload and the migrated value are identical; a record that would come back altered
 * is unrestorable.
 *
 * `true` for every session that is not measurement-aware: those keep their existing
 * repair behaviour untouched.
 */
export function sessionMeasurementStateIsCanonical(raw: unknown): boolean {
  if (!usesBlockMeasurementConfiguration(raw)) return true;

  try {
    return sameJsonValue(raw, migrateSession(raw));
  } catch {
    // Migration throwing on this input is itself proof it cannot be read back.
    return false;
  }
}

/**
 * Applies ONLY the documented recovery transitions migration performs on load — the
 * ones that change valid state on purpose rather than repairing malformed state.
 *
 * Today there is exactly one: a Capture Sequence still `running` when the app last
 * closed is forced to `paused`, with a fresh `pausedAt`, so automatic capture can
 * never silently keep listening after a reload (ADR-0006; see `migrateCaptureSequence`).
 * That is a lifecycle decision about a perfectly valid sequence, not evidence that the
 * stored data was wrong.
 *
 * The replacement `pausedAt` is taken from the migrated value rather than invented
 * here: it is a timestamp of the load itself, so it carries no information to verify.
 */
function withRecoveryTransitions(raw: unknown, migrated: Session): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;

  const sequence = record.captureSequence;
  if (
    typeof sequence !== "object" ||
    sequence === null ||
    Array.isArray(sequence) ||
    (sequence as Record<string, unknown>).status !== "running"
  ) {
    return raw;
  }

  return {
    ...record,
    captureSequence: {
      ...(sequence as Record<string, unknown>),
      status: "paused",
      pausedAt: migrated.captureSequence?.pausedAt,
    },
  };
}

/**
 * Whether a measurement-aware session can be stored and read back WITHOUT losing or
 * altering anything the athlete recorded — allowing for the recovery transitions
 * above, which are intentional.
 *
 * This is the LOCAL condition. An accepted timing result must be persisted
 * immediately, while capture is still running; refusing to save a running sequence
 * would mean either losing stones or deferring their persistence until capture
 * pauses, and neither is acceptable. Everything else — malformed measurements,
 * identities, references, counts or execution state — is still rejected exactly as
 * strictly as before, because only this one transition is tolerated.
 */
export function sessionMeasurementStateIsRestorable(raw: unknown): boolean {
  if (!usesBlockMeasurementConfiguration(raw)) return true;

  try {
    const migrated = migrateSession(raw);
    return sameJsonValue(withRecoveryTransitions(raw, migrated), migrated);
  } catch {
    return false;
  }
}


// --- Preserving the persisted property ORDER ------------------------------------
//
// Property order is part of the terminal-record contract, not cosmetics: a cloud
// record is identified by the SHA-256 of its exact payload bytes, and `reconcile`
// compares both the payload string and the digest. A Session that serializes
// differently after a local reload therefore reports a conflict the athlete never
// caused — and, for a record that is already authoritative, rewriting those bytes at
// all would break the immutability the record store depends on.
//
// Two guarantees are needed, and they pull in opposite directions:
//
//   1. A NEW record must stay stable through every later domain transition. Ordering
//      inside each constructor is not enough, because transitions reorder too:
//      `addTrainingBlock` appends `completedAt` to the outgoing block, attaching a
//      plan puts `planExecution` before `captureSequence`, and
//      `pauseCaptureSequenceWithError` adds `lastError` before `cancelledAt`.
//
//   2. An EXISTING authoritative payload — one already in the record store, possibly
//      written by an earlier producer whose field order differed — must come back
//      byte-for-byte identical, with its digest intact.
//
// Both follow from one rule: **the persisted representation is the authority on its
// own property order.** Whatever order a Session was stored in is the order it is
// restored in, so re-serializing it reproduces exactly the bytes it came from. A
// brand-new Session simply has no stored representation yet, so the order its
// producers chose becomes authoritative on first write and is preserved from then on.
//
// Nothing is rewritten, re-sorted or re-hashed, and no value is ever taken from the
// stored shape: the values always come from migration, so a genuine edit, a legacy
// repair or a recovery transition still changes the content — and is still detected as
// a conflict — exactly as before.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rebuilds `value` with its keys in `template`'s order, recursively.
 *
 * Only ORDER comes from the template. Every value comes from `value`, and keys the
 * template does not mention are kept, in their existing relative order, afterwards —
 * so a field migration added (a repair, a recovery transition) is never dropped.
 */
function reorderLike(value: unknown, template: unknown): unknown {
  if (Array.isArray(value)) {
    if (!Array.isArray(template)) return value;
    return value.map((item, index) => reorderLike(item, alignedTemplate(item, template, index)));
  }

  if (!isPlainObject(value) || !isPlainObject(template)) return value;

  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(template)) {
    if (key in value) ordered[key] = reorderLike(value[key], template[key]);
  }
  for (const key of Object.keys(value)) {
    if (!(key in ordered)) ordered[key] = value[key];
  }
  return ordered;
}

/**
 * The template entry that genuinely corresponds to `item`.
 *
 * Matched on identity first, so a reordered, inserted or removed element can never
 * take its order from an unrelated record; the positional entry is used only when
 * neither side carries an id.
 */
function alignedTemplate(item: unknown, template: unknown[], index: number): unknown {
  if (isPlainObject(item) && typeof item.id === "string") {
    const byId = template.find(
      (candidate) => isPlainObject(candidate) && candidate.id === item.id
    );
    return byId;
  }
  const positional = template[index];
  return isPlainObject(positional) && typeof positional.id === "string"
    ? undefined
    : positional;
}

/**
 * Restores `migrated` in the property order it was stored in.
 *
 * `stored` is the raw parsed value the migrated Session came from. It supplies order
 * only, and only when it is unmistakably the same record — same `id` — so one
 * session's layout can never be imposed on another's.
 */
export function preserveStoredSessionOrder(
  migrated: Session,
  stored: unknown
): Session {
  if (!isPlainObject(stored) || stored.id !== migrated.id) return migrated;
  return reorderLike(migrated, stored) as Session;
}

/** The history counterpart: each Session takes its order from its own stored entry. */
export function preserveStoredSessionHistoryOrder(
  migrated: Session[],
  stored: unknown
): Session[] {
  if (!Array.isArray(stored)) return migrated;
  return migrated.map((session) => {
    const entry = stored.find(
      (candidate) => isPlainObject(candidate) && candidate.id === session.id
    );
    return preserveStoredSessionOrder(session, entry);
  });
}
