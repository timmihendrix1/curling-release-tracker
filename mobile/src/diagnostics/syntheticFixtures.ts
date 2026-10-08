/**
 * The synthetic dataset the storage diagnostics panel writes.
 *
 * Every value here is GENERATED, deterministic and meaningless. No real record,
 * no real key shape and no real Profile id appears in this file, and the panel
 * never reads an application key — so nothing measured here can be confused with
 * user data, and re-running the panel reproduces byte-identical payloads.
 *
 * The sizes are a small documented set, chosen to bracket what the application
 * actually stores (docs/MOBILE_APP_MIGRATION.md §7.1: session history and the
 * Profile-scoped sync record are uncapped single values). They are measurement
 * points, NOT a claimed safe capacity — see the panel's own wording.
 */

/** The dedicated synthetic database. It is a fixed constant and is never derived
 * from configuration, a Profile or a user input, so the panel cannot be pointed
 * at an application database. Nothing else in this repository opens it. */
export const DIAGNOSTIC_DATABASE_NAME = "curling-storage-diagnostics-synthetic";

/** Key namespace, deliberately unlike the application's `curling.*` keys. */
const KEY_PREFIX = "diagnostic.synthetic.";

export function fixtureStorageKey(fixtureId: string): string {
  return `${KEY_PREFIX}fixture.${fixtureId}.v1`;
}

/** The manifest of the most recent deliberate write. Its own key, so a verify or
 * a mutation exercise never disturbs it. The `.v2` suffix moves with the record
 * shape below: a record left by an older diagnostics build lives under `.v1`, is
 * therefore never read, and so can certify nothing. It is orphaned synthetic data
 * that "Delete the synthetic data" clears. */
export const MANIFEST_STORAGE_KEY = `${KEY_PREFIX}manifest.v2`;

/** The one key the update/remove exercise touches. Separate from the fixtures on
 * purpose: mutating a fixture would destroy the restart evidence the manifest
 * describes. */
export const MUTABLE_STORAGE_KEY = `${KEY_PREFIX}mutable.v1`;

/** A key nothing ever writes, used to prove that genuine absence reads back as
 * absence rather than as a failure. */
export const NEVER_WRITTEN_STORAGE_KEY = `${KEY_PREFIX}neverWritten.v1`;

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Deterministic filler. Index-derived rather than random, so two runs — and two
 * app launches — produce exactly the same bytes and a comparison means something. */
function filler(length: number, seed: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += ALPHABET[(index * 31 + seed * 7 + 13) % ALPHABET.length];
  }
  return out;
}

export interface SyntheticFixture {
  id: string;
  label: string;
  /** What this fixture is evidence about. */
  purpose: string;
  build(): string;
}

/** Roughly 1 MiB of whole-document JSON — the shape the application actually
 * persists (one JSON document per key), not an artificial blob. */
function buildWholeDocument(): string {
  const entries: unknown[] = [];
  for (let index = 0; index < 900; index += 1) {
    entries.push({
      id: `synthetic-${index}`,
      index,
      label: filler(48, index),
      note: filler(900, index + 1),
      values: [index, index * 2, index * 3],
    });
  }
  return JSON.stringify({ schema: 1, kind: "synthetic-document", entries });
}

/** Text that is awkward for a naive implementation: characters outside the BMP,
 * a combining mark, and fragments that look like SQL and like bind placeholders.
 * Built from escapes rather than written literally so the file stays reviewable
 * in a plain diff. */
function buildAwkwardText(): string {
  return [
    "Zürich · Curling 🥌",
    "Århus — Łódź",
    "' OR 1=1; DROP TABLE records; --",
    'double " quote and \\ backslash',
    "placeholders ? :name $1 %s",
  ].join(" | ");
}

export const SYNTHETIC_FIXTURES: readonly SyntheticFixture[] = [
  {
    id: "empty",
    label: "Empty string (0 B)",
    purpose:
      "An empty string is a real stored value, not absence. It must read back as an empty string.",
    build: () => "",
  },
  {
    id: "awkward",
    label: "Unicode and SQL-looking text",
    purpose:
      "Astral-plane characters, a combining mark, SQL fragments and bind placeholders. Values are bound, never interpolated.",
    build: buildAwkwardText,
  },
  {
    id: "small",
    label: "Small document (4 KiB)",
    purpose: "A preference or draft-sized value.",
    build: () => filler(4 * 1024, 2),
  },
  {
    id: "medium",
    label: "Medium document (64 KiB)",
    purpose: "A session-sized value.",
    build: () => filler(64 * 1024, 3),
  },
  {
    id: "large",
    label: "Whole-document JSON (about 1 MiB)",
    purpose:
      "The uncapped single-value case: session history and the Profile-scoped sync record have no size limit.",
    build: buildWholeDocument,
  },
];

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * The record of one deliberate write, and the ONLY thing that may attribute
 * fixtures to a run.
 *
 * It is written TWICE, and that is the whole point. `phase: "writing"` is
 * published BEFORE the first fixture is touched, replacing any previous
 * completion record; `phase: "complete"` is published only after every fixture
 * write has been acknowledged. So an interrupted or failed run leaves a
 * `"writing"` record behind, and a stale completion record from an earlier run can
 * never certify fixtures that a later run has since rewritten — which is exactly
 * the false "verified after app restart" this schema exists to prevent.
 *
 * The fixtures are deterministic, so their BYTES cannot distinguish one run from
 * another. Attribution therefore rests entirely on this record, which is why it is
 * validated strictly rather than merely parsed.
 */
export const SYNTHETIC_MANIFEST_SCHEMA = 2;

interface ManifestCommon {
  schema: typeof SYNTHETIC_MANIFEST_SCHEMA;
  /** Identifies one deliberate write action. */
  runId: string;
  /** Identifies the document session that performed it. A verification that sees a
   * DIFFERENT session id is reading data written before this document existed. */
  sessionId: string;
  startedAtIso: string;
}

export type SyntheticRunManifest =
  | (ManifestCommon & { phase: "writing" })
  | (ManifestCommon & {
      phase: "complete";
      completedAtIso: string;
      fixtures: { id: string; bytes: number }[];
    });

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Strict validation of exactly the fields attribution relies on. Anything it
 * cannot fully validate is rejected, and a rejected manifest never certifies
 * anything — it is reported, and nothing is rewritten in response.
 *
 * An older `schema: 1` record (which had no phase, and so could not express an
 * interrupted run) is rejected for the same reason.
 */
export function parseManifest(raw: string): SyntheticRunManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  try {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (candidate.schema !== SYNTHETIC_MANIFEST_SCHEMA) return null;
    if (!isNonEmptyString(candidate.runId)) return null;
    if (!isNonEmptyString(candidate.sessionId)) return null;
    if (!isNonEmptyString(candidate.startedAtIso)) return null;

    if (candidate.phase === "writing") {
      return {
        schema: SYNTHETIC_MANIFEST_SCHEMA,
        phase: "writing",
        runId: candidate.runId,
        sessionId: candidate.sessionId,
        startedAtIso: candidate.startedAtIso,
      };
    }
    if (candidate.phase !== "complete") return null;
    if (!isNonEmptyString(candidate.completedAtIso)) return null;
    if (!Array.isArray(candidate.fixtures)) return null;

    const fixtures: { id: string; bytes: number }[] = [];
    for (const entry of candidate.fixtures) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      if (!isNonEmptyString(record.id)) return null;
      if (typeof record.bytes !== "number" || !Number.isFinite(record.bytes) || record.bytes < 0) {
        return null;
      }
      fixtures.push({ id: record.id, bytes: record.bytes });
    }
    // The record must describe THIS fixture set. One written by a build with a
    // different set describes different data and cannot attribute these files.
    const recorded = fixtures.map((fixture) => fixture.id).sort().join(",");
    const current = SYNTHETIC_FIXTURES.map((fixture) => fixture.id).sort().join(",");
    if (recorded !== current) return null;

    return {
      schema: SYNTHETIC_MANIFEST_SCHEMA,
      phase: "complete",
      runId: candidate.runId,
      sessionId: candidate.sessionId,
      startedAtIso: candidate.startedAtIso,
      completedAtIso: candidate.completedAtIso,
      fixtures,
    };
  } catch {
    // A hostile or proxied object whose property reads throw. Unreadable, so it
    // certifies nothing.
    return null;
  }
}
