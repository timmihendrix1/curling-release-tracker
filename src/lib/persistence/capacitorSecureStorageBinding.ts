// The ONLY file in this repository that names `@aparajita/capacitor-secure-storage`.
//
// It binds the plugin's actual shipped API — verified against the published
// 8.0.1 tarball and its own native dependency's source, not a README — to the
// narrow `SecureStorageBinding` interface declared in `secureCredentialStore.ts`.
// Keeping the binding here means the store's ownership, ordering and
// classification logic is testable with a plain fake, and that a bundle which
// never constructs a protected credential store ships no secure-storage
// implementation at all.
//
// ============================================================================
// DEPENDENCY SUITABILITY AUDIT — the native credential path is CLOSED
// ============================================================================
//
// The contract requires **item-specific missing-versus-failed evidence**: only a
// positively established absence may become the `null` the Supabase SDK reads as
// "no session". **No audited Capacitor-8 dependency supplies it**, and this
// binding therefore reports `no_absence_evidence` for every empty read, which
// makes the store unusable and closes the native credential path. That is
// reported rather than papered over, and the requirement is NOT complete.
//
// ## What the selected plugin does, and the exact gap
//
// `@aparajita/capacitor-secure-storage` 8.0.1 matches the approved S2 storage
// MECHANISMS: on iOS Keychain generic-password items via `KeychainSwift`; on
// Android AES/GCM ciphertext in the app-private `WSSecureStorageSharedPreferences`
// with a per-key `SecretKey` in the `AndroidKeyStore`. `Package.swift` targets
// iOS 15 and depends on `capacitor-swift-pm` `from: "8.0.0"` — satisfied by the
// root project's `exact: "8.5.2"` pin — plus `keychain-swift` 21.0.0. Its
// `configure`, write and removal paths are usable.
//
// Its READ path is not, on either platform:
//
//   - **iOS — the result code is discarded.** `KeychainSwift.getData` stores
//     `SecItemCopyMatching`'s `OSStatus` in `lastResultCode`, and
//     `KeychainSwift.get` additionally sets `errSecInvalidEncoding` (-67853)
//     when the stored bytes are not UTF-8; both then return `nil`. The plugin's
//     `internalGetItem` calls `getData(withKey:)`, which is
//     `keychain.get(key) as Any` — it **never reads `lastResultCode`** — and
//     resolves `{ data: nil }`. So `errSecItemNotFound` (established absence),
//     `errSecInteractionNotAllowed` (a locked keychain) and invalid encoding all
//     arrive identically. `tryKeychainOp` cannot help: it only surfaces a
//     THROWN error, and `getData` never throws.
//   - **Android — key loss is reported as nothing.** `SecureStorage.java`'s
//     `decryptString` returns **null** when the ciphertext row exists but
//     `keyStore.getEntry(alias, null)` is null, which is exactly the
//     restored-backup case: `SharedPreferences` is restored, Keystore keys are
//     not. That is retained unreadable data, and it is indistinguishable here
//     from a genuinely absent row.
//
// ## Alternatives audited, and why each fails
//
//   - **`capacitor-secure-storage-plugin` 0.13.0** (peer `@capacitor/core >= 8.0.0`,
//     ships `Package.swift`, iOS 15, `SwiftKeychainWrapper`). **Materially
//     worse.** Its iOS `get` tests `hasValue(forKey:)` — itself
//     `data(forKey:) != nil`, so the same conflation — and then resolves
//     `keychainwrapper.string(forKey: key) ?? ""`, **fabricating an empty
//     string** when a read fails after `hasValue` said yes. Absence and failure
//     are both `call.reject`, separable only by message text. Its Android
//     `PasswordStorageHelper` catches every `GeneralSecurityException`,
//     `printStackTrace()`s it and returns null — swallowing the failure. It also
//     reads and writes `KeychainWrapper.standard`, a service outside this
//     application's namespace, and writes `.afterFirstUnlock` without
//     `ThisDeviceOnly`.
//   - **`@evva/capacitor-secure-storage-plugin` 4.0.4** — peer
//     `@capacitor/core: ^7.0.1`, which does not accept the installed 8.5.2.
//   - **`@capacitor/preferences`** — not secure storage at all, and already
//     rejected on write semantics (ADR-0049 decision 2).
//   - **Biometric plugins** (`capacitor-native-biometric`,
//     `@aparajita/capacitor-biometric-auth`) — excluded by scope: no biometric
//     prompt may be introduced.
//
// ## What is deliberately NOT done
//
// No custom cryptography and no plugin fork — both remain prohibited. No global
// probe (a marker key, `keys()`/`internalGetPrefixedKeys`), no timing delay and
// no speculative retry is used to manufacture an absence claim: a prefix
// enumeration is not item-specific evidence, returns empty on its own failure,
// and on Android enumerates Keystore aliases rather than ciphertext rows — so it
// would report a retained-ciphertext entry as absent, which is the very error
// being corrected.
//
// **What would close the gap:** an implementation that surfaces, per read,
// either the iOS `OSStatus` (or a boolean derived from `errSecItemNotFound`) or
// an Android `sharedPreferences.contains(key)` check distinguished from a
// decryption failure. Until such a dependency exists, `read` reports
// `no_absence_evidence` and the native path stays closed.
//
// Nothing here classifies, logs or forwards a plugin error: every rejection
// propagates unchanged into the store, which converts it into a fixed category
// without reading its message.
import {
  KeychainAccess,
  SecureStorage,
} from "@aparajita/capacitor-secure-storage";
import {
  SECURE_CREDENTIAL_IOS_ACCESS,
  type SecureStorageBinding,
  type SecureStorageReadEvidence,
  type SecureStorageRemoveEvidence,
} from "./secureCredentialStore";

/**
 * The plugin's numeric `KeychainAccess` member for the one accessibility class
 * this application uses. Mapped through the plugin's own enum rather than a
 * hard-coded integer so a renumbering upstream is a compile error here instead
 * of a silently weaker item.
 */
const IOS_ACCESS_BY_NAME: Readonly<
  Record<typeof SECURE_CREDENTIAL_IOS_ACCESS, KeychainAccess>
> = {
  afterFirstUnlockThisDeviceOnly: KeychainAccess.afterFirstUnlockThisDeviceOnly,
};

export function createCapacitorSecureStorageBinding(): SecureStorageBinding {
  return {
    // `KeychainSwift.set` calls `deleteNoLock(key)` BEFORE `SecItemAdd`
    // (verified in keychain-swift 21.0.0), so a replacement that fails at the
    // add step has already removed the value it was replacing.
    failedWriteMayLosePreviousValue: true,

    async configure({ keyPrefix, synchronize, iosAccess }): Promise<void> {
      // Order matters only in that all three must be in force before the first
      // read or write. `setKeyPrefix` is what puts every item under the fixed
      // application-owned namespace instead of the plugin's own
      // `capacitor-storage_` default.
      await SecureStorage.setKeyPrefix(keyPrefix);
      // iCloud Keychain synchronisation OFF. On Android this is a documented
      // no-op.
      await SecureStorage.setSynchronize(synchronize);
      await SecureStorage.setDefaultKeychainAccess(IOS_ACCESS_BY_NAME[iosAccess]);
    },

    // `getItem`, NOT `get`. The latter JSON-decodes and performs ISO-date
    // conversion; a provider session string must round-trip byte-for-byte.
    async read(key: string): Promise<SecureStorageReadEvidence> {
      const data = await SecureStorage.getItem(key);
      if (typeof data === "string") return { kind: "value", value: data };
      // `null`/`undefined`. The plugin discarded the platform's own reason — see
      // the audit above — so this binding CANNOT report established absence, and
      // says so instead of guessing.
      return { kind: "no_absence_evidence" };
    },

    async write(key: string, value: string): Promise<void> {
      await SecureStorage.setItem(key, value);
    },

    // `remove`, not `removeItem`: it returns the store's own "there was
    // something to delete" flag, which `removeItem` discards. Neither value
    // confirms physical deletion — on Android an already-missing alias returns
    // false while leaving the ciphertext row in place, and
    // `SharedPreferences.apply()` acknowledges no disk failure.
    async remove(key: string): Promise<SecureStorageRemoveEvidence> {
      const removed = await SecureStorage.remove(key);
      if (removed === true) return { kind: "deleted" };
      if (removed === false) return { kind: "nothing_to_delete" };
      return { kind: "no_evidence" };
    },
  };
}
