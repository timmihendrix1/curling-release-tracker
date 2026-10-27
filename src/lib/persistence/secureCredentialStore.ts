// The protected credential store — Stage M3b3 (docs/MOBILE_APP_MIGRATION.md
// Stage M3b0 §4, ADR-0049).
//
// This is NOT `StorageAdapter`, and that is deliberate. Provider credentials do
// not live beside sporting data: the user decision of 2026-09-30 selected **S2**
// — iOS Keychain, and on Android encrypted app-private storage whose keys are
// protected by the Android Keystore — behind ONE shared application-facing
// contract. Sporting data and identity continuity records use the SQLite
// boundary instead.
//
// Three facts this module refuses to blur:
//
//   1. **Two stores are not one transaction.** A credential write and an
//      identity-record write remain separate, unordered and independently
//      failable. Nothing here makes them atomic, and no caller may assume it.
//   2. **SQLite does not encrypt credentials**, and this store is not a
//      durability guarantee. A resolved write is the platform's acknowledgement
//      of the call, not proof that the bytes survived a power loss.
//   3. **Absence must be POSITIVELY ESTABLISHED.** A read that returned nothing
//      is not absence unless the platform said so. Only established absence may
//      become a `null` the SDK reads as "no session"; everything else — an
//      unreadable item, a lost key, a malformed bridge response, and the case
//      where the platform simply did not say — is a FAILURE.
//
// ## Why (3) has its own failure category, and why the native path is closed
//
// An earlier revision inferred absence from a separate "readability marker": if
// a marker key read back, an ambiguous empty read of some OTHER key was treated
// as established absence. **That inference is invalid and has been removed.**
// Reading one key successfully says nothing about another key: an item-specific
// read or decoding failure, or a transient failure followed by a successful
// marker read, produces exactly the same observation. The marker cannot repair
// information the native binding discarded, and no global probe, delay or retry
// can either — which is why none is used.
//
// The evidence exists natively and is thrown away before it reaches JavaScript:
//
//   - iOS: `KeychainSwift.getData` records `SecItemCopyMatching`'s `OSStatus` in
//     `lastResultCode` — `errSecItemNotFound` would be established absence,
//     `errSecInteractionNotAllowed` a locked keychain — and `KeychainSwift.get`
//     additionally sets `errSecInvalidEncoding` for non-UTF-8 data. The installed
//     plugin's `getData(withKey:)` returns `keychain.get(key) as Any` and
//     **never inspects `lastResultCode`**, so every one of those collapses to
//     `nil`.
//   - Android: the installed `SecureStorage.java` `decryptString` returns
//     **null** when the ciphertext row exists but its Keystore entry does not
//     (`getEntry` → null). That is retained unreadable data, not a missing
//     entry, and the plugin reports it identically to a genuinely absent row.
//
// So `SecureStorageBinding` demands item-specific evidence, and the Capacitor
// Android binding reports `no_absence_evidence` because the installed plugin cannot
// supply it. The user-approved app-owned iOS reader (2026-10-24) now preserves
// SecItemCopyMatching evidence. It does not perform migration or activation, and
// its physical-device acceptance remains open. See `capacitorSecureStorageBinding.ts`
// for the dependency audit. No custom cryptography or plugin fork is introduced.
//
// No secret, no key name and no raw plugin exception ever leaves this module.
// Failures are fixed categories; messages are fixed strings.
import { detectRuntimePlatform, type RuntimePlatform } from "../platform/runtimePlatform";
import { ordinaryCredentialNamespaceAvailable, runOrdinaryCredentialOperation } from "./nativeCredentialNamespace";

/**
 * The fixed, application-owned namespace every credential item lives under.
 *
 * It is a constant, never derived from configuration, a Profile, a user input or
 * the diagnostics surface. On iOS the Keychain is additionally scoped to this
 * app's default access group (the app declares **no** keychain-sharing
 * entitlement and must not gain one); on Android the backing store is this app's
 * private `SharedPreferences` file. The prefix is what keeps the app's own
 * credential items separable from anything else it might ever store.
 */
export const SECURE_CREDENTIAL_NAMESPACE = "curling.credentials.v1.";

/**
 * iOS Keychain accessibility for every item this store writes:
 * `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`
 * (`KeychainAccess.afterFirstUnlockThisDeviceOnly`, the plugin's value `3`).
 *
 * Both halves are chosen, and both are stated against Apple's own primary
 * documentation for the underlying attribute constants rather than against the
 * plugin's paraphrase:
 *
 *   - **AfterFirstUnlock** — "cannot be accessed after a restart until the
 *     device has been unlocked once by the user". The app must be able to
 *     restore a session at launch after a reboot without the device happening to
 *     be unlocked at that exact instant; `WhenUnlocked` would turn an ordinary
 *     cold start into a failed read.
 *   - **ThisDeviceOnly** — Apple documents these variants as **not migrating to
 *     a new device**: the item is not included in an iCloud backup and is not
 *     restored onto different hardware. A restored backup therefore has **no**
 *     credential, which means re-authentication rather than a refresh token
 *     copied onto hardware it was never issued for.
 *
 * Deliberately NOT claimed: that the item is absent from every local/encrypted
 * backup artefact, or that it cannot survive a same-device restore. Apple's
 * documentation is about device migration, and this repository has performed no
 * backup/restore measurement — so backup behaviour remains **unverified against
 * the selected configuration**, as the design requires it be.
 *
 * `kSecAttrSynchronizable` stays **false** (see `SECURE_CREDENTIAL_SYNCHRONIZE`):
 * iCloud Keychain synchronisation is not enabled and must not be.
 */
export const SECURE_CREDENTIAL_IOS_ACCESS = "afterFirstUnlockThisDeviceOnly" as const;

/** iCloud Keychain synchronisation is OFF. Credentials do not leave the device. */
export const SECURE_CREDENTIAL_SYNCHRONIZE = false;

/** Fixed, safe messages. A caught plugin value may embed a key, a payload
 * fragment or a keychain path, so it is never inspected, stringified, logged or
 * forwarded. */
const UNAVAILABLE_MESSAGE = "Protected storage is unavailable on this platform.";

/**
 * Why a credential operation could not be completed. Deliberately coarse, and
 * deliberately free of platform text.
 *
 * - `store_unavailable` — no protected store exists here at all: an unsupported
 *   platform, or the plugin is missing. Never a transient condition.
 * - `store_inaccessible` — the store exists and refused the operation (a locked
 *   keychain, an OS error, a keystore failure). Presence is UNKNOWN.
 * - `entry_unreadable` — an entry exists, or may exist, and could not be decoded
 *   or decrypted: corrupt ciphertext, a lost Keystore key, invalid UTF-8. The
 *   value is not usable and **nothing is repaired or deleted here**.
 * - `absence_not_established` — the platform returned nothing AND supplied no
 *   evidence that nothing is there. **This is the category the installed
 *   bindings produce**, and treating it as absence is exactly the defect this
 *   contract exists to prevent.
 */
export type SecureCredentialFailure =
  | { kind: "store_unavailable" }
  | { kind: "store_inaccessible" }
  | { kind: "entry_unreadable" }
  | { kind: "absence_not_established" };

/**
 * `absent` carries no qualifier, because it now means exactly one thing: the
 * platform positively reported that no such item exists. Any weaker observation
 * is a `read_failed`.
 */
export type SecureCredentialReadResult =
  | { status: "value"; value: string }
  | { status: "absent" }
  | { status: "read_failed"; error: SecureCredentialFailure };

/**
 * A failed write reports whether the previous value may have been destroyed.
 *
 * This is not defensive padding. `KeychainSwift.set` calls `deleteNoLock(key)`
 * **before** `SecItemAdd`, so on iOS a replacement that fails at the add step
 * has already removed the value it was replacing. A caller must not be told the
 * old bytes are intact when the platform cannot promise that.
 */
export type SecureCredentialWriteResult =
  | { ok: true }
  | { ok: false; error: SecureCredentialFailure; previousValueMayBeLost: boolean };

/**
 * A removal reports what the platform SAID, never what is physically true.
 *
 * - `deleted_reported` — the platform reported it removed something.
 * - `nothing_to_delete_reported` — the platform reported there was nothing to
 *   remove. On Android this is exactly the path a row whose Keystore alias is
 *   already missing takes: `removeAlias` returns false **without** removing the
 *   retained ciphertext from `SharedPreferences`.
 *
 * **Neither outcome confirms physical deletion**, and neither confirms the
 * change reached disk: Android's `SharedPreferences.apply()` returns `void` and
 * acknowledges no disk failure. A caller that needs the bytes provably gone
 * cannot get that from this contract, and this contract does not pretend
 * otherwise.
 */
export type SecureCredentialRemoveResult =
  | { ok: true; outcome: "deleted_reported" | "nothing_to_delete_reported" }
  | { ok: false; error: SecureCredentialFailure };

/**
 * The one application-facing contract, shared by iOS and Android.
 *
 * Every method resolves — none rejects — matching the discipline every other
 * storage boundary in this repository already follows (ADR-0013).
 */
export interface SecureCredentialStore {
  read(key: string): Promise<SecureCredentialReadResult>;
  write(key: string, value: string): Promise<SecureCredentialWriteResult>;
  remove(key: string): Promise<SecureCredentialRemoveResult>;
}

/**
 * What a binding must report for a single read. The whole point of this shape is
 * that it has **no** "nothing came back" member that a caller could mistake for
 * absence:
 *
 * - `value` — the item's exact stored string.
 * - `established_absent` — the platform positively reported no such item
 *   (`errSecItemNotFound`, or an Android row the store confirmed it does not
 *   hold).
 * - `unreadable` — an entry exists or may exist and could not be decoded,
 *   decrypted or fetched.
 * - `no_absence_evidence` — the platform returned nothing and said nothing about
 *   why. A binding over an implementation that discards its result code must
 *   report THIS, not `established_absent`.
 */
export type SecureStorageReadEvidence =
  | { kind: "value"; value: string }
  | { kind: "established_absent" }
  | { kind: "unreadable" }
  | { kind: "no_absence_evidence" };

/** What a binding reports for a removal — the platform's own claim, nothing
 * stronger. `no_evidence` means it did not say. */
export type SecureStorageRemoveEvidence =
  | { kind: "deleted" }
  | { kind: "nothing_to_delete" }
  | { kind: "no_evidence" };

/**
 * The narrow slice of a native implementation this store uses, declared here —
 * not imported — so the store's control flow is testable without a native
 * bridge, and so exactly one file
 * (`capacitorSecureStorageBinding.ts`) names a package.
 *
 * `clearAll` and `keys` are deliberately absent: no clear-all and no key
 * enumeration is reachable from application code, and no global probe may stand
 * in for item-specific evidence.
 */
export interface SecureStorageBinding {
  /** Applies the fixed namespace, the synchronisation flag and the iOS
   * accessibility class. Called once, before any read or write. */
  configure(options: {
    keyPrefix: string;
    synchronize: boolean;
    iosAccess: typeof SECURE_CREDENTIAL_IOS_ACCESS;
  }): Promise<void>;
  read(key: string): Promise<SecureStorageReadEvidence>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<SecureStorageRemoveEvidence>;
  /**
   * Whether a failed `write` may have destroyed the value it was replacing.
   * A property of the implementation, not of the call — see
   * `SecureCredentialWriteResult`.
   */
  /** S3c private migration observation only; ordinary stores never call it. */
  inventory?(): Promise<unknown>;
  readonly failedWriteMayLosePreviousValue: boolean;
}

/** Raised for every condition under which no protected store exists here. */
export class SecureStoreUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecureStoreUnavailableError";
  }
}

/**
 * Fixed enum codes that carry no user content, so they are the one thing about a
 * caught value this module reads. The `message` is never read.
 *
 * `UNIMPLEMENTED`/`UNAVAILABLE` are Capacitor's own `ExceptionCode`s, raised by
 * `registerPlugin`'s proxy when no native implementation is reachable — "no
 * store exists here", not "this operation failed".
 */
const UNREADABLE_CODES: ReadonlySet<string> = new Set(["invalidData"]);
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(["UNIMPLEMENTED", "UNAVAILABLE"]);

function isUnavailable(error: unknown): boolean {
  try {
    return error instanceof SecureStoreUnavailableError;
  } catch {
    // `instanceof` can itself throw on a hostile prototype. Failing to classify
    // is never reported as "no store exists" — the honest answer is the
    // operation failure below.
    return false;
  }
}

function readErrorCode(error: unknown): string | null {
  try {
    if (error === null || typeof error !== "object") return null;
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

function classify(error: unknown): SecureCredentialFailure {
  if (isUnavailable(error)) return { kind: "store_unavailable" };
  const code = readErrorCode(error);
  if (code !== null && UNAVAILABLE_CODES.has(code)) return { kind: "store_unavailable" };
  if (code !== null && UNREADABLE_CODES.has(code)) return { kind: "entry_unreadable" };
  // Everything else — `osError`, `unknownError`, a bridge rejection, a thrown
  // non-Error — leaves presence unknown.
  return { kind: "store_inaccessible" };
}

export interface NativeSecureCredentialStoreOptions {
  /** Test seam. Production passes nothing and the real plugin binding is loaded
   * lazily on first use, so no bundle that never constructs this store ships a
   * secure-storage implementation. */
  binding?: SecureStorageBinding;
  /** Test seam for the trusted platform signal (ADR-0047). */
  detectPlatform?: () => RuntimePlatform;
}

/**
 * Loads the real plugin binding. Behind a dynamic import so that merely
 * importing this module — which the type-checker and the Web build both do —
 * never pulls the plugin, and so the plugin's **Web implementation**, which is
 * backed by `localStorage`, is never even loaded. There is no Web fallback: this
 * store fails closed on the Web before it gets here.
 */
async function loadDefaultBinding(): Promise<SecureStorageBinding> {
  try {
    const binding = await import("./capacitorSecureStorageBinding");
    return binding.createCapacitorSecureStorageBinding();
  } catch {
    throw new SecureStoreUnavailableError("The protected storage plugin is not available.");
  }
}

/**
 * Creates the native protected credential store.
 *
 * **Nothing is opened here.** Configuration and plugin loading happen on the
 * first operation, so constructing the store is inert — importable and
 * constructible on the Web, under Next's server rendering and in tests, where it
 * simply fails closed.
 *
 * **Ownership and ordering.** Every operation goes through ONE namespace-wide FIFO queue whose
 * tail is always fulfilled, never rejected, so a failed operation cannot strand
 * later ones, and concurrent callers observe the order they called in. A failed
 * configuration leaves the store unconfigured rather than caching the failure, so
 * the next operation retries honestly instead of inheriting a dead verdict for
 * the rest of the session.
 */
export function createNativeSecureCredentialStore(
  options: NativeSecureCredentialStoreOptions = {}
): SecureCredentialStore {
  const detectPlatform = options.detectPlatform ?? detectRuntimePlatform;
  const injectedBinding = options.binding;

  let binding: SecureStorageBinding | null = injectedBinding ?? null;
  let configured = false;

  function enqueue<T>(task: () => Promise<T>, refused: () => T): Promise<T> {
    return runOrdinaryCredentialOperation(task, refused);
  }
  function requireOrdinaryOwner(): void {
    if (!ordinaryCredentialNamespaceAvailable()) throw new Error("Protected storage is owned by migration.");
  }

  async function ensureConfigured(): Promise<SecureStorageBinding> {
    let platform: RuntimePlatform;
    try {
      platform = detectPlatform();
    } catch {
      // A platform signal that throws must not be able to decide we are on the
      // Web, where the plugin's `localStorage`-backed implementation lives.
      platform = "unsupported_native";
    }
    if (platform !== "ios" && platform !== "android") {
      throw new SecureStoreUnavailableError(UNAVAILABLE_MESSAGE);
    }

    requireOrdinaryOwner();
    const resolved = binding ?? (await loadDefaultBinding());
    requireOrdinaryOwner();
    binding = resolved;
    if (!configured) {
      requireOrdinaryOwner();
      await resolved.configure({
        keyPrefix: SECURE_CREDENTIAL_NAMESPACE,
        synchronize: SECURE_CREDENTIAL_SYNCHRONIZE,
        iosAccess: SECURE_CREDENTIAL_IOS_ACCESS,
      });
      configured = true;
    }
    return resolved;
  }

  async function readTask(key: string): Promise<SecureCredentialReadResult> {
    try {
      const active = await ensureConfigured();
      requireOrdinaryOwner();
      const evidence = await active.read(key);
      // A malformed or absent evidence object is itself a failure. It is never
      // read as absence, and the shape is validated rather than trusted.
      if (evidence === null || typeof evidence !== "object") {
        return { status: "read_failed", error: { kind: "absence_not_established" } };
      }
      switch (evidence.kind) {
        case "value":
          // Only an exact string is a value. Anything else is a bridge response
          // this store did not write and cannot interpret.
          return typeof evidence.value === "string"
            ? { status: "value", value: evidence.value }
            : { status: "read_failed", error: { kind: "entry_unreadable" } };
        case "established_absent":
          return { status: "absent" };
        case "unreadable":
          return { status: "read_failed", error: { kind: "entry_unreadable" } };
        case "no_absence_evidence":
          return { status: "read_failed", error: { kind: "absence_not_established" } };
        default:
          return { status: "read_failed", error: { kind: "absence_not_established" } };
      }
    } catch (error) {
      return { status: "read_failed", error: classify(error) };
    }
  }

  async function writeTask(key: string, value: string): Promise<SecureCredentialWriteResult> {
    let mayLose = false;
    try {
      const active = await ensureConfigured();
      mayLose = active.failedWriteMayLosePreviousValue === true;
      requireOrdinaryOwner();
      await active.write(key, value);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: classify(error), previousValueMayBeLost: mayLose };
    }
  }

  async function removeTask(key: string): Promise<SecureCredentialRemoveResult> {
    try {
      const active = await ensureConfigured();
      requireOrdinaryOwner();
      const evidence = await active.remove(key);
      if (evidence === null || typeof evidence !== "object") {
        return { ok: false, error: { kind: "store_inaccessible" } };
      }
      switch (evidence.kind) {
        case "deleted":
          return { ok: true, outcome: "deleted_reported" };
        case "nothing_to_delete":
          return { ok: true, outcome: "nothing_to_delete_reported" };
        case "no_evidence":
          // The platform did not say. Reporting a success would be the false
          // "confirmed deletion" this contract refuses.
          return { ok: false, error: { kind: "store_inaccessible" } };
        default:
          return { ok: false, error: { kind: "store_inaccessible" } };
      }
    } catch (error) {
      return { ok: false, error: classify(error) };
    }
  }

  return {
    read(key: string): Promise<SecureCredentialReadResult> {
      // The outer catch covers the unreachable case that the queue machinery or
      // a classifier itself throws. A public method never rejects.
      return enqueue(() => readTask(key), (): SecureCredentialReadResult => ({ status: "read_failed", error: { kind: "store_inaccessible" } })).catch(
        (): SecureCredentialReadResult => ({
          status: "read_failed",
          error: { kind: "store_inaccessible" },
        })
      );
    },
    write(key: string, value: string): Promise<SecureCredentialWriteResult> {
      return enqueue(() => writeTask(key, value), (): SecureCredentialWriteResult => ({ ok: false, error: { kind: "store_inaccessible" }, previousValueMayBeLost: false })).catch(
        (): SecureCredentialWriteResult => ({
          ok: false,
          error: { kind: "store_inaccessible" },
          // Unknown, so reported as the unsafe possibility rather than the
          // convenient one.
          previousValueMayBeLost: true,
        })
      );
    },
    remove(key: string): Promise<SecureCredentialRemoveResult> {
      return enqueue(() => removeTask(key), (): SecureCredentialRemoveResult => ({ ok: false, error: { kind: "store_inaccessible" } })).catch(
        (): SecureCredentialRemoveResult => ({
          ok: false,
          error: { kind: "store_inaccessible" },
        })
      );
    },
  };
}
