/**
 * The synthetic CHECKPOINT dataset and its classification rules.
 *
 * A checkpoint is the shape Stage M3b4's migration is specified to use
 * (`docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §5.1): a batch of payload rows and
 * the progress record describing them, committed TOGETHER, so that an
 * interrupted migration either has a whole checkpoint or has the previous one —
 * never half of either. This module supplies the synthetic stand-in for that
 * shape so the property can be observed before the migration exists.
 *
 * Nothing here is a real record, a real key shape or a real Profile id, and the
 * keys live in their own namespace, so a checkpoint exercise can never disturb
 * the restart fixtures in `syntheticFixtures.ts`.
 *
 * ## Why the payloads are NOT deterministic across attempts
 *
 * `syntheticFixtures.ts` is deliberately byte-identical between runs, because
 * its question is "did these exact bytes survive a restart". The question here
 * is the opposite one — "did THIS attempt commit" — and deterministic payloads
 * answer it wrongly: an earlier successful attempt leaves rows that are
 * byte-identical to the ones the current attempt meant to write, so reading them
 * back would certify an attempt that never committed anything. Every payload is
 * therefore a pure function of the attempt id and the checkpoint number, and
 * verification REGENERATES the expected bytes rather than comparing against
 * anything stored. No digest, checksum or signature is invented: the comparison
 * is exact equality against a value derived from the identity being claimed.
 */

/** Keys live under the existing synthetic namespace, in their own subtree. */
const CHECKPOINT_KEY_PREFIX = "diagnostic.synthetic.checkpoint.";

/**
 * The progress record. One key, rewritten by each committed checkpoint — exactly
 * like the migration's own progress record, which is what makes "rows and
 * progress commit together" a meaningful thing to exercise.
 */
export const CHECKPOINT_PROGRESS_KEY = `${CHECKPOINT_KEY_PREFIX}progress.v1`;

/**
 * Payload rows use FIXED slot keys rather than attempt-scoped ones, on purpose.
 * A new attempt therefore OVERWRITES the previous checkpoint's rows inside its
 * transaction, so "the previous checkpoint survived a rollback" means the engine
 * actually restored the earlier values — a stronger claim than merely finding
 * that no new keys appeared.
 */
export const CHECKPOINT_ROW_COUNT = 3;

export function checkpointRowKey(index: number): string {
  return `${CHECKPOINT_KEY_PREFIX}row.${index}.v1`;
}

export function checkpointRowKeys(): string[] {
  return Array.from({ length: CHECKPOINT_ROW_COUNT }, (_unused, index) =>
    checkpointRowKey(index)
  );
}

/** Every key this module may ever address. Used by cleanup and by the isolation
 * test that pins the namespace. */
export function allCheckpointKeys(): string[] {
  return [CHECKPOINT_PROGRESS_KEY, ...checkpointRowKeys()];
}

import { byteLength } from "./syntheticFixtures";

export { byteLength };

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function filler(length: number, seed: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += ALPHABET[(index * 17 + seed * 11 + 5) % ALPHABET.length];
  }
  return out;
}

/**
 * The payload for one row of one checkpoint of one attempt.
 *
 * Pure in its three inputs, and every input appears in the output. Two different
 * attempts, or two different checkpoints of the same attempt, cannot produce the
 * same bytes — which is the whole reason a stale row cannot certify a fresh
 * attempt.
 */
export function buildCheckpointRow(
  attemptId: string,
  checkpointNumber: number,
  index: number
): string {
  return JSON.stringify({
    schema: 1,
    kind: "synthetic-checkpoint-row",
    attemptId,
    checkpointNumber,
    index,
    filler: filler(512, checkpointNumber * 31 + index),
  });
}

export const CHECKPOINT_PROGRESS_SCHEMA = 1;

/**
 * The progress record written INSIDE the same transaction as the rows it
 * describes.
 *
 * `attemptId` is the generation identity. A record naming a different attempt
 * describes a different generation of data and can never certify this one, which
 * is checked rather than assumed.
 */
export interface CheckpointProgress {
  schema: typeof CHECKPOINT_PROGRESS_SCHEMA;
  attemptId: string;
  /** The document session that wrote it. */
  sessionId: string;
  checkpointNumber: number;
  writtenAtIso: string;
  /** The keys this checkpoint claims to have written, and their sizes. Sizes are
   * for reporting; correctness is decided by regenerating the payload. */
  rows: { key: string; bytes: number }[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Strict validation of every field attribution depends on. Anything that cannot
 * be fully validated is rejected, and a rejected record certifies nothing — it
 * is reported, and nothing is rewritten in response.
 */
export function parseCheckpointProgress(raw: string): CheckpointProgress | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  try {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (candidate.schema !== CHECKPOINT_PROGRESS_SCHEMA) return null;
    if (!isNonEmptyString(candidate.attemptId)) return null;
    if (!isNonEmptyString(candidate.sessionId)) return null;
    if (!isNonEmptyString(candidate.writtenAtIso)) return null;
    if (
      typeof candidate.checkpointNumber !== "number" ||
      !Number.isInteger(candidate.checkpointNumber) ||
      candidate.checkpointNumber < 1
    ) {
      return null;
    }
    if (!Array.isArray(candidate.rows)) return null;
    const rows: { key: string; bytes: number }[] = [];
    for (const entry of candidate.rows) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      if (!isNonEmptyString(record.key)) return null;
      if (
        typeof record.bytes !== "number" ||
        !Number.isFinite(record.bytes) ||
        record.bytes < 0
      ) {
        return null;
      }
      rows.push({ key: record.key, bytes: record.bytes });
    }
    // The record must describe exactly THIS build's row set. One naming a
    // different set describes different data and attributes none of these rows.
    const recorded = rows.map((row) => row.key).sort().join(",");
    const current = checkpointRowKeys().sort().join(",");
    if (recorded !== current) return null;

    return {
      schema: CHECKPOINT_PROGRESS_SCHEMA,
      attemptId: candidate.attemptId,
      sessionId: candidate.sessionId,
      checkpointNumber: candidate.checkpointNumber,
      writtenAtIso: candidate.writtenAtIso,
      rows,
    };
  } catch {
    // A hostile or proxied object whose property reads throw.
    return null;
  }
}

export function buildCheckpointProgress(input: {
  attemptId: string;
  sessionId: string;
  checkpointNumber: number;
  writtenAtIso: string;
}): CheckpointProgress {
  return {
    schema: CHECKPOINT_PROGRESS_SCHEMA,
    attemptId: input.attemptId,
    sessionId: input.sessionId,
    checkpointNumber: input.checkpointNumber,
    writtenAtIso: input.writtenAtIso,
    rows: checkpointRowKeys().map((key, index) => ({
      key,
      bytes: byteLength(buildCheckpointRow(input.attemptId, input.checkpointNumber, index)),
    })),
  };
}

/** Every row and the progress record of one checkpoint, ready to be staged. */
export function buildCheckpointEntries(input: {
  attemptId: string;
  sessionId: string;
  checkpointNumber: number;
  writtenAtIso: string;
}): { key: string; value: string }[] {
  const rows = checkpointRowKeys().map((key, index) => ({
    key,
    value: buildCheckpointRow(input.attemptId, input.checkpointNumber, index),
  }));
  // The progress record is staged LAST, but that ordering carries no meaning:
  // the transaction is what makes them one unit. If ordering ever mattered here,
  // the transaction would not be doing its job.
  return [...rows, { key: CHECKPOINT_PROGRESS_KEY, value: JSON.stringify(
    buildCheckpointProgress(input)
  ) }];
}

/* ==========================================================================
 * Classification
 * ========================================================================== */

/**
 * What a read of one key produced. Deliberately four outcomes: a FAILED read
 * says nothing about whether the key exists, and treating it as absence is the
 * exact mistake that would let an unresolved attempt be called "not committed".
 */
export type CheckpointRead =
  | { status: "value"; value: string }
  | { status: "absent" }
  | { status: "read_failed" };

export interface CheckpointEvidence {
  progress: CheckpointRead;
  /** Indexed as `checkpointRowKeys()`. */
  rows: CheckpointRead[];
}

/**
 * The verdict about ONE attempt, read from a store whose connection was
 * positively closed, released and reopened (the caller establishes that; this
 * module only classifies what it is given).
 *
 *   - `committed` — the progress record names this attempt AND every row matches
 *     its regenerated expected value exactly.
 *   - `not_committed` — no checkpoint for this attempt exists, and the
 *     previously committed checkpoint (if there was one) is intact.
 *   - `unresolved` — partial, mismatched, malformed or unreadable evidence.
 *     NOT a failure verdict and NOT a success one: it means the observation
 *     cannot decide, which is a real outcome a migration must handle.
 *
 * There is deliberately no fourth "probably" value, and no verdict is ever
 * derived from what the commit call returned.
 */
export type CheckpointVerdict =
  | { kind: "committed"; progress: CheckpointProgress; detail: string[] }
  | { kind: "not_committed"; previous: CheckpointProgress | null; detail: string[] }
  | { kind: "unresolved"; detail: string[] };

/**
 * What a store with NO progress record says about the payload rows.
 *
 *   - `empty` — every expected row was read SUCCESSFULLY and is absent. The only
 *     outcome that establishes "nothing is stored".
 *   - `partial` — at least one row is present without a progress record to
 *     attribute it. Not empty, and not attributable to any attempt.
 *   - `undetermined` — at least one row could not be read, or the evidence does
 *     not cover the complete row set. Says nothing either way.
 *
 * A failed read is never counted as an absence, and an incomplete row set is
 * never read as "the rest are absent".
 */
export type ProgresslessRows =
  | { kind: "empty" }
  | { kind: "partial"; present: number; unreadable: number }
  | { kind: "undetermined"; unreadable: number; missingEvidence: number };

export function classifyProgresslessRows(rows: readonly CheckpointRead[]): ProgresslessRows {
  const missingEvidence = Math.max(0, CHECKPOINT_ROW_COUNT - rows.length);
  let present = 0;
  let unreadable = 0;
  for (let index = 0; index < CHECKPOINT_ROW_COUNT; index += 1) {
    const read = rows[index];
    if (read === undefined) continue;
    if (read.status === "value") present += 1;
    else if (read.status === "read_failed") unreadable += 1;
  }
  // Evidence for rows beyond the expected set is not evidence about this set.
  if (rows.length > CHECKPOINT_ROW_COUNT) {
    return { kind: "undetermined", unreadable, missingEvidence: 0 };
  }
  if (present > 0) return { kind: "partial", present, unreadable };
  if (unreadable > 0 || missingEvidence > 0) {
    return { kind: "undetermined", unreadable, missingEvidence };
  }
  return { kind: "empty" };
}

/** Field-by-field equality of two VALIDATED progress records, including the
 * attribution metadata. Matching attempt id and checkpoint number alone is not
 * "the same record": a changed session, timestamp or row manifest means the
 * record that was observed before is not the one standing now. */
export function sameCheckpointProgress(a: CheckpointProgress, b: CheckpointProgress): boolean {
  if (
    a.schema !== b.schema ||
    a.attemptId !== b.attemptId ||
    a.sessionId !== b.sessionId ||
    a.checkpointNumber !== b.checkpointNumber ||
    a.writtenAtIso !== b.writtenAtIso ||
    a.rows.length !== b.rows.length
  ) {
    return false;
  }
  return a.rows.every(
    (row, index) => row.key === b.rows[index].key && row.bytes === b.rows[index].bytes
  );
}

/**
 * Classifies evidence about `expectedAttemptId`, given the progress record
 * observed BEFORE the attempt (`baseline`, `null` if there was none).
 *
 * Only a COMPLETE, successfully read evidence set can produce `committed` or
 * `not_committed`. In particular "no new commit" (`not_committed`) requires
 * either the baseline record standing unchanged with every one of its rows, or
 * — when there was no baseline — successful absence reads for the progress
 * record AND every payload row. Anything less is `unresolved`, because "the
 * reads did not find it" and "it is not there" are different facts.
 *
 * This function performs no I/O and can therefore never repair, replay or
 * rewrite anything as a side effect of looking.
 */
export function classifyCheckpoint(input: {
  expectedAttemptId: string;
  expectedCheckpointNumber: number;
  baseline: CheckpointProgress | null;
  evidence: CheckpointEvidence;
}): CheckpointVerdict {
  const { expectedAttemptId, expectedCheckpointNumber, baseline, evidence } = input;
  const detail: string[] = [];

  if (evidence.rows.length !== CHECKPOINT_ROW_COUNT) {
    return {
      kind: "unresolved",
      detail: [
        `The evidence covers ${evidence.rows.length} payload row(s), not the expected ${CHECKPOINT_ROW_COUNT}, so nothing can be concluded.`,
      ],
    };
  }

  if (evidence.progress.status === "read_failed") {
    return {
      kind: "unresolved",
      detail: ["The progress record could not be read, so nothing can be concluded."],
    };
  }

  if (evidence.progress.status === "absent") {
    if (baseline !== null) {
      // A previously committed checkpoint has disappeared. That is not "this
      // attempt did not commit" — something removed committed data.
      return {
        kind: "unresolved",
        detail: [
          `A checkpoint for attempt ${baseline.attemptId} existed before this attempt and the progress record is now absent.`,
        ],
      };
    }
    const rows = classifyProgresslessRows(evidence.rows);
    if (rows.kind === "partial") {
      return {
        kind: "unresolved",
        detail: [
          `No progress record exists, but ${rows.present} payload row(s) are present. That is a partial state, not an empty one.`,
        ],
      };
    }
    if (rows.kind === "undetermined") {
      return {
        kind: "unresolved",
        detail: [
          `No progress record exists, but ${rows.unreadable + rows.missingEvidence} payload row(s) could not be read, so whether anything is stored cannot be determined.`,
        ],
      };
    }
    detail.push(
      "No progress record and no payload row exists, and none existed before this attempt. Every key was read successfully."
    );
    return { kind: "not_committed", previous: null, detail };
  }

  const progress = parseCheckpointProgress(evidence.progress.value);
  if (progress === null) {
    return {
      kind: "unresolved",
      detail: ["A progress record exists but failed validation, so it attributes nothing."],
    };
  }

  if (progress.attemptId === expectedAttemptId) {
    if (progress.checkpointNumber !== expectedCheckpointNumber) {
      return {
        kind: "unresolved",
        detail: [
          `The progress record names this attempt but checkpoint ${progress.checkpointNumber}, not ${expectedCheckpointNumber}.`,
        ],
      };
    }
    const rows = verifyRows(progress, evidence, detail);
    if (!rows.ok) {
      // Progress says the checkpoint committed; the rows say otherwise. A
      // transaction is supposed to make this unreachable, so observing it is a
      // finding, not a tidy failure.
      return {
        kind: "unresolved",
        detail: [
          "The progress record names this attempt but its rows do not all match — a partial checkpoint.",
          ...detail,
        ],
      };
    }
    detail.unshift(
      `Progress record: attempt ${progress.attemptId}, checkpoint ${progress.checkpointNumber}, written ${progress.writtenAtIso}.`
    );
    return { kind: "committed", progress, detail };
  }

  if (baseline !== null && progress.attemptId === baseline.attemptId) {
    if (!sameCheckpointProgress(progress, baseline)) {
      return {
        kind: "unresolved",
        detail: [
          `The progress record still names the previous attempt ${baseline.attemptId}, but it is not the record observed before this attempt (its checkpoint number, session, timestamp or row manifest changed).`,
        ],
      };
    }
    const rows = verifyRows(progress, evidence, detail);
    if (!rows.ok) {
      return {
        kind: "unresolved",
        detail: [
          "This attempt did not commit, but the PREVIOUS checkpoint no longer matches — rows were left behind.",
          ...detail,
        ],
      };
    }
    detail.unshift(
      `No checkpoint for attempt ${expectedAttemptId}. The previous checkpoint (attempt ${progress.attemptId}, checkpoint ${progress.checkpointNumber}) is intact: its progress record is unchanged and every row matches.`
    );
    return { kind: "not_committed", previous: progress, detail };
  }

  return {
    kind: "unresolved",
    detail: [
      `The progress record names attempt ${progress.attemptId}, which is neither this attempt nor the one observed before it.`,
    ],
  };
}

/**
 * Checks a stored checkpoint against its OWN claimed identity, with no
 * expectation from this session — for inspection after a relaunch, and for
 * capturing the baseline before an attempt. `consistent` requires a valid record
 * and every row matching it exactly; `empty` requires successful absence reads
 * for the record and every row.
 */
export type StoredCheckpointState =
  | { kind: "empty" }
  | { kind: "consistent"; progress: CheckpointProgress; detail: string[] }
  | {
      kind: "unresolved";
      /** `rows_without_progress`: rows present, no record to attribute them.
       * `inconsistent`: a valid record whose rows do not all match it. */
      reason: "unreadable" | "invalid" | "rows_without_progress" | "inconsistent";
      detail: string[];
    };

export function classifyStoredCheckpoint(evidence: CheckpointEvidence): StoredCheckpointState {
  if (evidence.progress.status === "read_failed") {
    return {
      kind: "unresolved",
      reason: "unreadable",
      detail: ["The progress record could not be read, so nothing can be concluded."],
    };
  }
  if (evidence.progress.status === "absent") {
    const rows = classifyProgresslessRows(evidence.rows);
    if (rows.kind === "empty") return { kind: "empty" };
    return rows.kind === "partial"
      ? {
          kind: "unresolved",
          reason: "rows_without_progress",
          detail: [
            `No progress record is stored, but ${rows.present} payload row(s) are present. That is a partial state, not an empty one.`,
          ],
        }
      : {
          kind: "unresolved",
          reason: "unreadable",
          detail: [
            `No progress record is stored, but ${rows.unreadable + rows.missingEvidence} payload row(s) could not be read, so whether anything is stored cannot be determined.`,
          ],
        };
  }
  const progress = parseCheckpointProgress(evidence.progress.value);
  if (progress === null) {
    return {
      kind: "unresolved",
      reason: "invalid",
      detail: ["A progress record is stored but failed validation, so it attributes nothing."],
    };
  }
  const verdict = classifyCheckpoint({
    expectedAttemptId: progress.attemptId,
    expectedCheckpointNumber: progress.checkpointNumber,
    baseline: null,
    evidence,
  });
  return verdict.kind === "committed"
    ? { kind: "consistent", progress, detail: verdict.detail }
    : { kind: "unresolved", reason: "inconsistent", detail: verdict.detail };
}

/** Compares every row against the value regenerated from the progress record's
 * OWN claimed identity. Appends per-row detail; never writes. */
function verifyRows(
  progress: CheckpointProgress,
  evidence: CheckpointEvidence,
  detail: string[]
): { ok: boolean } {
  let ok = true;
  const keys = checkpointRowKeys();
  for (let index = 0; index < keys.length; index += 1) {
    const read = evidence.rows[index];
    const expected = buildCheckpointRow(
      progress.attemptId,
      progress.checkpointNumber,
      index
    );
    if (read === undefined || read.status === "read_failed") {
      ok = false;
      detail.push(`Row ${index}: could not be read.`);
      continue;
    }
    if (read.status === "absent") {
      ok = false;
      detail.push(`Row ${index}: absent, though the progress record names it.`);
      continue;
    }
    if (read.value !== expected) {
      ok = false;
      detail.push(
        `Row ${index}: MISMATCH — stored ${byteLength(read.value)} B, expected ${byteLength(expected)} B for this attempt.`
      );
      continue;
    }
    const recorded = progress.rows.find((row) => row.key === keys[index]);
    if (recorded === undefined || recorded.bytes !== byteLength(expected)) {
      ok = false;
      detail.push(
        `Row ${index}: the progress record's byte count does not describe this row, so the record does not match its own data.`
      );
      continue;
    }
    detail.push(`Row ${index}: matches this attempt exactly (${byteLength(expected)} B).`);
  }
  return { ok };
}
