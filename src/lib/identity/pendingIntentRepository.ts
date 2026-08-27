// The pending deep-link intent, its validation, and its persistence (ADR-0025 §22,
// §C, §19; Stage B0.2c).
//
// An intent is what a person was trying to reach when they arrived: a team
// invitation link or an admin-request link. It is captured and validated ABOVE the
// gate, before any redirect, and replayed once the gate is ready — so a person who
// clicks an invitation while signed out does not lose it to the authentication they
// have to complete first.
//
// ONE LIFETIME, ONE BOUNDED EXCEPTION.
//
// Ordinary intents are retained across authentication (including a full-page
// Google return and its URL cleanup, and a `correlation_changed`), onboarding,
// reload and transient failures. They are deleted on terminal handling, explicit
// dismissal, a definitive denial, an ordinary sign-out, or an ordinary account
// switch. **They are never read, deleted and then acted on** — deletion follows
// terminal handling, so an intent cannot be lost to a crash mid-replay.
//
// The single exception is the invitation wrong-account recovery transition
// (ADR-0025 §C): exactly one validated invitation survives exactly one sign-out,
// marked `survival: "invitation_account_recovery"`. **An absent or uncertain
// survival marker is never inferred** — if persistence failed, the application must
// not claim the invitation will be replayed automatically.
//
// ADMIN-REQUEST INTENTS GET NO RECOVERY. An admin-request link carries no secret
// and is not email-bound; the server enforces nominee identity separately at
// acceptance, so there is no `wrong_email` outcome to recover from. Nothing here
// can mark one for survival.
//
// REMOVAL IS REQUIRED, NEVER BEST-EFFORT. A deletion failure blocks the transition
// that needed it — notably, it blocks provider sign-out, which is what guarantees
// "no ordinary intent may be replayed under another account".
//
// AN OUTSTANDING DENIAL CLEANUP IS A SEPARATE RECORD, NOT A THIRD LIFETIME.
//
// When a definitive server denial (§14) cannot complete its required intent
// deletion, this repository writes a **tombstone** under its own key. The tombstone
// carries no intent material at all — its mere presence is the whole fact: *the
// pending-intent key must be empty before any ready state.*
//
// A separate record, rather than a third `survival` value on the intent itself, is
// what makes the invariant airtight. A same-record marker has two bypasses that no
// amount of care inside one method closes: an ordinary capture can simply
// `save()` over it, and a discharge that reads the marker and then removes the key
// can destroy an intent a newer capture wrote in between. With the tombstone:
//
//  - `save()` and `markInvitationForRecovery()` **refuse while a tombstone exists**,
//    so no legitimate newer intent can come into being while a debt is outstanding
//    — which is exactly why the discharge needs no currency proof and cannot
//    destroy anything a newer operation owns;
//  - the debt cannot be overwritten by ordinary capture, converted into recovery
//    survival, or replayed, because it does not live in the record those paths
//    write;
//  - the discharge is "clear the intent key, then clear the tombstone", in that
//    order, so a partial discharge leaves the debt in force rather than forgotten.
//
// `settleIntentBeforeReady` is the ONE choke point every path to a ready gate
// passes through, and no ready state is entered while a tombstone is present or
// unreadable.

import { localStorageAdapter } from "../persistence/localStorageAdapter";
import type {
  PersistenceRemoveResult,
  PersistenceWriteResult,
  RemovableStorageAdapter,
} from "../persistence/types";
import type { IdentityRecordLoad } from "./errors";
import {
  hasSupportedSchemaVersion,
  isCanonicalUuid,
  isOpaqueIdentifier,
  isRecordLike,
  isValidTimestamp,
  readIdentityRecord,
  readIdentityRecordRaw,
  readUntrustedLiteral,
  readUntrustedProperty,
  readUntrustedTimestamp,
  removeIdentityRecord,
  writeIdentityRecord,
} from "./untrustedValue";

export const PENDING_INTENT_SCHEMA_VERSION = 1 as const;

export const PENDING_INTENT_STORAGE_KEY = "curling.identity.pendingIntent.v1";

export type PendingIntentKind = "invitation" | "admin_request";

export const PENDING_INTENT_KINDS: readonly PendingIntentKind[] = ["invitation", "admin_request"];

export const INTENT_CLEANUP_SCHEMA_VERSION = 1 as const;

export const INTENT_CLEANUP_STORAGE_KEY = "curling.identity.intentCleanup.v1";

/**
 * The tombstone a definitive denial leaves when its REQUIRED intent deletion could
 * not be completed (ADR-0025 §14, §22).
 *
 * It carries **no intent material** — no kind, no token, no admin-request id. Its
 * presence alone is the fact: the pending-intent key must be empty before any ready
 * state. Storing the intent it was owed against would put a secret in a second key
 * for no gain, and would invite a comparison this design does not need.
 */
export type OutstandingIntentCleanup = {
  schemaVersion: typeof INTENT_CLEANUP_SCHEMA_VERSION;
  /** When the denial recorded the debt. Never used as authority for anything; it
   * exists so the record is inspectable rather than an opaque flag. */
  recordedAt: string;
};

export function createOutstandingIntentCleanup(recordedAt: string): OutstandingIntentCleanup | null {
  if (!isValidTimestamp(recordedAt)) return null;
  return { schemaVersion: INTENT_CLEANUP_SCHEMA_VERSION, recordedAt };
}

/**
 * Validates an untrusted stored tombstone. Never throws.
 *
 * A malformed tombstone is NOT read as absence. Absence means "no debt", and
 * inferring that from material this build cannot parse would discharge a debt by
 * corruption — so the callers below treat malformed exactly as present.
 */
export function validateOutstandingIntentCleanup(raw: unknown): OutstandingIntentCleanup | null {
  if (!isRecordLike(raw)) return null;
  if (!hasSupportedSchemaVersion(raw, INTENT_CLEANUP_SCHEMA_VERSION)) return null;
  const recordedAt = readUntrustedTimestamp(raw, "recordedAt");
  if (recordedAt === null) return null;
  return { schemaVersion: INTENT_CLEANUP_SCHEMA_VERSION, recordedAt };
}

/**
 * What an intent's lifetime is, durably.
 *
 * - `ordinary` — captured above the gate and legitimately continuing through
 *   authentication and onboarding. It survives reload and transient failure, and
 *   is deleted on terminal handling, dismissal, a definitive denial, an ordinary
 *   sign-out or an ordinary account switch (ADR-0025 §22).
 * - `invitation_account_recovery` — the one bounded exception: exactly one
 *   validated invitation surviving exactly one sign-out (§C).
 *
 * An **outstanding denial cleanup is deliberately not a value here.** It is a debt
 * about the key, not a lifetime of a record, and it lives in its own tombstone —
 * see this module's header for why that distinction is what makes the invariant
 * hold.
 */
export type PendingIntentSurvival = "ordinary" | "invitation_account_recovery";

export const PENDING_INTENT_SURVIVALS: readonly PendingIntentSurvival[] = [
  "ordinary",
  "invitation_account_recovery",
];

/** An invitation token is an opaque secret; only genuinely disqualifying
 * properties are rejected (empty, over-long, whitespace or control characters).
 * Inventing a shape would fail closed on a legitimate token the moment the
 * issuer's format changed. */
export const MAX_INVITATION_TOKEN_LENGTH = 512;

export type PendingIntent = {
  schemaVersion: typeof PENDING_INTENT_SCHEMA_VERSION;
  kind: PendingIntentKind;
  value: string;
  capturedAt: string;
  survival: PendingIntentSurvival;
};

/** Whether a raw deep-link value is usable for this kind. An `admin_request` id is
 * a UUID (`team_admin_requests.id`); an `invitation` is an opaque token. */
export function isValidIntentValue(kind: PendingIntentKind, value: unknown): value is string {
  return kind === "admin_request"
    ? isCanonicalUuid(value)
    : isOpaqueIdentifier(value, MAX_INVITATION_TOKEN_LENGTH);
}

/**
 * Builds an intent, or returns `null` when the value is not valid for the kind.
 * **Never repairs**: an over-long or whitespace-carrying token is discarded, not
 * trimmed or truncated, so what is replayed is always exactly what arrived.
 */
export function createPendingIntent(input: {
  kind: PendingIntentKind;
  value: unknown;
  capturedAt: string;
  survival?: PendingIntentSurvival;
}): PendingIntent | null {
  if (!isValidIntentValue(input.kind, input.value)) return null;
  return {
    schemaVersion: PENDING_INTENT_SCHEMA_VERSION,
    kind: input.kind,
    value: input.value,
    capturedAt: input.capturedAt,
    survival: input.survival ?? "ordinary",
  };
}

/**
 * Applies the deep-link precedence rule to the two query parameters, exactly
 * preserving the behaviour `TeamDeepLinkGate.tsx` already has: **`adminRequestId`
 * wins when both are present.**
 *
 * An INVALID `adminRequestId` is discarded rather than repaired, and discarding it
 * means it is not an intent at all — so it does not suppress a separately valid
 * `inviteToken`. (Precedence orders two intents; it does not let a malformed
 * parameter veto a well-formed one. Nothing security-relevant rests on this
 * choice: the server re-checks eligibility on replay in either case.)
 */
export function selectDeepLinkIntent(
  params: { inviteToken?: unknown; adminRequestId?: unknown },
  capturedAt: string
): PendingIntent | null {
  const adminRequest = createPendingIntent({
    kind: "admin_request",
    value: params.adminRequestId,
    capturedAt,
  });
  if (adminRequest !== null) return adminRequest;
  return createPendingIntent({ kind: "invitation", value: params.inviteToken, capturedAt });
}

/**
 * Validates an untrusted stored value into an intent, or returns `null`. Never
 * throws, for any input. No prior-schema branch or repair exists.
 *
 * A stored `admin_request` carrying `survival: "invitation_account_recovery"` is
 * **malformed**, not silently downgraded: admin-request intents have no recovery
 * transition, so such a record could only come from tampering or a defect, and
 * honouring it would grant a survival this design never gives them.
 */
export function validatePendingIntent(raw: unknown): PendingIntent | null {
  if (!isRecordLike(raw)) return null;
  if (!hasSupportedSchemaVersion(raw, PENDING_INTENT_SCHEMA_VERSION)) return null;

  const kind = readUntrustedLiteral<PendingIntentKind>(raw, "kind", PENDING_INTENT_KINDS);
  if (kind === null) return null;

  const value = readUntrustedProperty(raw, "value");
  if (!isValidIntentValue(kind, value)) return null;

  const capturedAt = readUntrustedTimestamp(raw, "capturedAt");
  if (capturedAt === null) return null;

  const survival = readUntrustedLiteral<PendingIntentSurvival>(
    raw,
    "survival",
    PENDING_INTENT_SURVIVALS
  );
  if (survival === null) return null;
  if (kind === "admin_request" && survival !== "ordinary") return null;

  return { schemaVersion: PENDING_INTENT_SCHEMA_VERSION, kind, value, capturedAt, survival };
}

/**
 * The closed result of a required intent mutation. `blocked` is what stops a
 * transition: the repository could not PROVE the required state, so the caller
 * must not proceed to a provider sign-out.
 */
export type IntentMutationOutcome =
  | { kind: "applied" }
  /** Nothing needed changing — there was no such intent to begin with. */
  | { kind: "not_required" }
  /** Storage could not be read or written. The caller stays locked and performs
   * zero provider calls. */
  | { kind: "blocked" }
  /**
   * The caller withdrew between the read and the write, so **nothing was
   * changed**. Used when a superseded operation must not mutate state that now
   * belongs to a newer transition (ADR-0025 §8).
   */
  | { kind: "superseded" };

export interface PendingIntentRepository {
  load(): Promise<IdentityRecordLoad<PendingIntent>>;
  save(intent: PendingIntent): Promise<PersistenceWriteResult>;
  /** Unconditional required deletion — terminal handling, explicit dismissal, or a
   * definitive terminal denial. */
  deleteIntent(): Promise<PersistenceRemoveResult>;
  /**
   * Clears the denial-cleanup tombstone only after the caller has proved that the
   * pending-intent key was removed. Keeping this separate from `deleteIntent`
   * lets ordinary terminal handling remain independent while the invalidation
   * protocol can complete both halves in one coordinator effect section.
   */
  clearOutstandingDenialCleanup(): Promise<PersistenceRemoveResult>;
  /**
   * Deletes every ORDINARY pending intent — explicit sign-out step 2, and an
   * ordinary account switch.
   *
   * An intent marked `invitation_account_recovery` is deliberately retained: it is
   * by definition not an *ordinary* pending intent, and surviving exactly one
   * sign-out is its entire purpose (ADR-0025 §22, §C).
   *
   * A read failure is `blocked`, not `not_required`: the caller cannot prove no
   * ordinary intent remains, and guessing would risk replaying one under another
   * account.
   */
  deleteOrdinaryIntents(): Promise<IntentMutationOutcome>;
  /**
   * Marks exactly one invitation for survival across the recovery sign-out
   * (ADR-0025 §C step 3). Rejects anything that is not an invitation.
   */
  markInvitationForRecovery(intent: PendingIntent): Promise<PersistenceWriteResult>;
  /**
   * Removes every ordinary intent OTHER than the preserved invitation (ADR-0025 §C
   * step 4). A read failure is `blocked`.
   */
  deleteOtherOrdinaryIntents(preservedInvitationValue: string): Promise<IntentMutationOutcome>;
  /**
   * Records the tombstone for a definitive denial whose REQUIRED intent deletion
   * did not complete (ADR-0025 §14, §22).
   *
   * A **write of a separate key**, which is exactly why it can succeed where the
   * removal could not. It carries no intent material.
   *
   * `applied` when the debt is now durable — including when it already was.
   * `blocked` when the tombstone itself could not be written, in which case the
   * denial reports honestly that a required local mutation is unproven and claims
   * nothing more.
   */
  recordOutstandingDenialCleanup(recordedAt: string): Promise<IntentMutationOutcome>;
  /**
   * The one pre-ready settlement of intent state, run on **every** path to a ready
   * gate.
   *
   * - An outstanding **tombstone** is discharged: the pending-intent key is cleared
   *   and only then is the tombstone cleared. It needs no currency proof, because
   *   `save` and `markInvitationForRecovery` refuse while it exists — so there is
   *   no legitimate newer intent for this to destroy. Any failure, and any
   *   unreadable tombstone, is `blocked`, and no ready state is entered.
   * - A recovery survival marker is reset to `ordinary`, so the same invitation
   *   cannot survive a second, unrelated sign-out. `capturedAt` is preserved, and
   *   the stored bytes are re-confirmed immediately before the write.
   * - An `ordinary` intent is left **completely untouched**, which is what keeps a
   *   first-run deep link alive across normal authentication and onboarding.
   *
   * @param canProceed consulted AFTER the read and IMMEDIATELY BEFORE the recovery
   * reset write. A read-then-write cannot be made atomic here, so the caller is
   * given the one point where it can still withdraw: if it answers `false`, nothing
   * is written and the outcome is `superseded`. That is what stops an operation
   * that was overtaken mid-reset from mutating a newer transition's intent state.
   */
  settleIntentBeforeReady(canProceed?: () => Promise<boolean>): Promise<IntentMutationOutcome>;
}

/** The one, value-free write failure this repository ever reports. It never names
 * a key, a stored value, an identifier or anything read from the argument. */
const REJECTED_WRITE: PersistenceWriteResult = {
  ok: false,
  error: { kind: "unknown", message: "The record could not be stored." },
};

export function createPendingIntentRepository(
  adapter: RemovableStorageAdapter = localStorageAdapter
): PendingIntentRepository {
  async function read(): Promise<IdentityRecordLoad<PendingIntent>> {
    return readIdentityRecord(adapter, PENDING_INTENT_STORAGE_KEY, validatePendingIntent);
  }

  async function removeStored(): Promise<IntentMutationOutcome> {
    const removal = await removeIdentityRecord(adapter, PENDING_INTENT_STORAGE_KEY);
    return removal.ok ? { kind: "applied" } : { kind: "blocked" };
  }

  /**
   * Whether a denial debt is outstanding.
   *
   * A malformed or unreadable tombstone counts as **present**. Absence means "no
   * debt", and concluding that from material this build cannot read would let
   * corruption discharge a debt.
   */
  async function outstandingCleanup(): Promise<"absent" | "present" | "unreadable"> {
    const loaded = await readIdentityRecord(
      adapter,
      INTENT_CLEANUP_STORAGE_KEY,
      validateOutstandingIntentCleanup
    );
    if (loaded.status === "absent") return "absent";
    if (loaded.status === "value") return "present";
    // `malformed` and `read_failed` alike.
    return "unreadable";
  }

  return {
    load: read,

    async save(intent: PendingIntent): Promise<PersistenceWriteResult> {
      // Snapshot the untrusted argument into inert plain data before it is
      // serialized — see `markInvitationForRecovery` below for the full rationale.
      const snapshot = validatePendingIntent(intent);
      if (snapshot === null) return REJECTED_WRITE;
      // ORDINARY CAPTURE CANNOT OVERWRITE A DENIAL DEBT.
      //
      // While a tombstone is outstanding the pending-intent key is owed deletion,
      // and the gate cannot be ready — so there is nothing a captured intent could
      // usefully do, and letting it land would erase the debt's whole purpose. An
      // unreadable tombstone is refused for the same reason: the debt cannot be
      // ruled out. This is also what makes the discharge safe without a currency
      // proof: no legitimate newer intent can come into being for it to destroy.
      if ((await outstandingCleanup()) !== "absent") return REJECTED_WRITE;
      return writeIdentityRecord(
        adapter,
        PENDING_INTENT_STORAGE_KEY,
        snapshot,
        validatePendingIntent
      );
    },

    async deleteIntent(): Promise<PersistenceRemoveResult> {
      return removeIdentityRecord(adapter, PENDING_INTENT_STORAGE_KEY);
    },

    async clearOutstandingDenialCleanup(): Promise<PersistenceRemoveResult> {
      return removeIdentityRecord(adapter, INTENT_CLEANUP_STORAGE_KEY);
    },

    async deleteOrdinaryIntents(): Promise<IntentMutationOutcome> {
      const stored = await read();
      if (stored.status === "absent") return { kind: "not_required" };
      if (stored.status === "read_failed") return { kind: "blocked" };
      // A malformed record is removed: it is not a usable intent, so it cannot be
      // the marked survivor, and leaving unusable material behind would keep a
      // later load reporting `malformed` forever.
      if (stored.status === "value" && stored.value.survival === "invitation_account_recovery") {
        return { kind: "not_required" };
      }
      return removeStored();
    },

    async markInvitationForRecovery(intent: PendingIntent): Promise<PersistenceWriteResult> {
      // SNAPSHOT BEFORE READING OR SPREADING. The argument is untrusted at runtime:
      // spreading it would invoke `ownKeys`/`getOwnPropertyDescriptor` traps and
      // could copy values that differ from the ones a `kind` check just observed.
      // Validating first reads every property exactly once through the contained
      // readers and yields inert plain data, so the `kind` that is checked is the
      // `kind` that is stored.
      const snapshot = validatePendingIntent(intent);
      if (snapshot === null) return REJECTED_WRITE;
      if (snapshot.kind !== "invitation") return REJECTED_WRITE;
      // A recovery marker must never overwrite an outstanding denial cleanup: that
      // would convert a deletion the server's denial is owed into a survival across
      // a sign-out. An unreadable tombstone is refused for the same reason — the
      // debt cannot be ruled out.
      if ((await outstandingCleanup()) !== "absent") return REJECTED_WRITE;
      return writeIdentityRecord(
        adapter,
        PENDING_INTENT_STORAGE_KEY,
        { ...snapshot, survival: "invitation_account_recovery" as const },
        validatePendingIntent
      );
    },

    async deleteOtherOrdinaryIntents(
      preservedInvitationValue: string
    ): Promise<IntentMutationOutcome> {
      const stored = await read();
      if (stored.status === "absent") return { kind: "not_required" };
      if (stored.status === "read_failed") return { kind: "blocked" };
      if (
        stored.status === "value" &&
        stored.value.kind === "invitation" &&
        stored.value.value === preservedInvitationValue
      ) {
        return { kind: "not_required" };
      }
      return removeStored();
    },

    async recordOutstandingDenialCleanup(recordedAt: string): Promise<IntentMutationOutcome> {
      const existing = await outstandingCleanup();
      // Already durable. Rewriting would only replace one honest timestamp with
      // another; an unreadable one is already treated as present, and overwriting it
      // would discard a debt this build cannot read.
      if (existing !== "absent") return { kind: "applied" };
      const record = createOutstandingIntentCleanup(recordedAt);
      // A defective clock cannot record a debt. The denial then reports that a
      // required local mutation is unproven — see §22's honest limitation.
      if (record === null) return { kind: "blocked" };
      const write = await writeIdentityRecord(
        adapter,
        INTENT_CLEANUP_STORAGE_KEY,
        record,
        validateOutstandingIntentCleanup
      );
      return write.ok ? { kind: "applied" } : { kind: "blocked" };
    },

    async settleIntentBeforeReady(
      canProceed?: () => Promise<boolean>
    ): Promise<IntentMutationOutcome> {
      // THE DEBT FIRST, and unconditionally.
      const debt = await outstandingCleanup();
      if (debt === "unreadable") return { kind: "blocked" };
      if (debt === "present") {
        // Clear the intent key, and only THEN the tombstone. The reverse order
        // would let a failure halfway leave a stale intent with no record that it
        // is owed deletion.
        const cleared = await removeIdentityRecord(adapter, PENDING_INTENT_STORAGE_KEY);
        if (!cleared.ok) return { kind: "blocked" };
        const discharged = await removeIdentityRecord(adapter, INTENT_CLEANUP_STORAGE_KEY);
        return discharged.ok ? { kind: "applied" } : { kind: "blocked" };
      }

      const stored = await read();
      if (stored.status === "absent") return { kind: "not_required" };
      if (stored.status === "read_failed") return { kind: "blocked" };
      if (stored.status === "malformed") return removeStored();
      if (stored.value.survival === "ordinary") return { kind: "not_required" };
      if (canProceed !== undefined && !(await canProceed())) return { kind: "superseded" };

      // RE-CONFIRM THE STORED BYTES immediately before the write.
      //
      // The decision above was made from one read; without this, a capture that
      // replaced the record in between would be silently overwritten with the older
      // read's data. This is the narrowest compare-and-set this interface can
      // express — the residual window is the write itself, and ADR-0025 §8's honest
      // limitation still stands.
      const confirmed = await readIdentityRecordRaw(adapter, PENDING_INTENT_STORAGE_KEY);
      if (confirmed.status !== "value") return { kind: "blocked" };
      const stillTheSame = validatePendingIntent(parseConfirmedRecord(confirmed.raw));
      if (
        stillTheSame === null ||
        stillTheSame.kind !== stored.value.kind ||
        stillTheSame.value !== stored.value.value ||
        stillTheSame.capturedAt !== stored.value.capturedAt ||
        stillTheSame.survival !== stored.value.survival
      ) {
        return { kind: "superseded" };
      }

      const write = await writeIdentityRecord(
        adapter,
        PENDING_INTENT_STORAGE_KEY,
        { ...stored.value, survival: "ordinary" as const },
        validatePendingIntent
      );
      return write.ok ? { kind: "applied" } : { kind: "blocked" };
    },
  };
}

/** Parses a re-confirmation read without throwing. An unparseable value simply
 * fails the comparison above, which is the deny-ward direction. */
function parseConfirmedRecord(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export const pendingIntentRepository: PendingIntentRepository = createPendingIntentRepository();
