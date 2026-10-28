import Foundation
import Security
import LocalAuthentication

// Read-only companion to the existing secure-storage writer. Query attributes
// match KeychainSwift 21.0.0: generic password + prefixed account, non-synchronizable,
// app-accessible groups (no sharing entitlement), no service attribute. The
// separate inventory observes attributes only; neither path repairs anything.
enum CredentialKeychainReader {
    static let namespace = "curling.credentials.v1."
    typealias CopyMatching = (CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus

    // This metadata envelope is not a retention limit or measured OS capacity.
    static let inventoryKeyLimit = 4_096

    // Closed support metadata only. Never return OS numbers or item attributes.
    private enum InventoryFailure: String {
        case os_interaction_not_allowed, os_auth_failed, os_not_available
        case os_missing_entitlement, os_parameter, os_decode, os_other
        case rows_shape, row_shape, value_reference, account_shape, account_encoding
        case key_limit, key_shape, sync_shape, sync_enabled, service_shape, service_present

        var kind: String {
            switch self {
            case .os_interaction_not_allowed, .os_auth_failed, .os_not_available,
                 .os_missing_entitlement, .os_parameter, .os_decode, .os_other: return "inaccessible"
            case .key_limit: return "limit_exceeded"
            case .sync_enabled, .service_present: return "unsupported_scope"
            default: return "unreadable"
            }
        }
        var response: [String: Any] { ["kind": kind, "diagnostic": rawValue] }
    }

    static func inventory(copyMatching: CopyMatching = SecItemCopyMatching) -> [String: Any] {
        let context = LAContext()
        context.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnAttributes as String: true,
            kSecReturnData as String: false,
            kSecUseAuthenticationContext as String: context
        ]
        var result: CFTypeRef?
        let status = copyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return ["kind": "complete", "keys": [String]()] }
        guard status == errSecSuccess else {
            let failure: InventoryFailure
            switch status {
            case errSecInteractionNotAllowed: failure = .os_interaction_not_allowed
            case errSecAuthFailed: failure = .os_auth_failed
            case errSecNotAvailable: failure = .os_not_available
            case errSecMissingEntitlement: failure = .os_missing_entitlement
            case errSecParam: failure = .os_parameter
            case errSecDecode: failure = .os_decode
            default: failure = .os_other
            }
            return failure.response
        }
        guard let rows = result as? [Any], !rows.isEmpty else { return InventoryFailure.rows_shape.response }
        let prefix = Array(namespace.utf16)
        var names = [[UInt16]]()
        var seen = Set<[UInt16]>()
        for raw in rows {
            guard let attributes = raw as? [String: Any] else { return InventoryFailure.row_shape.response }
            guard attributes[kSecValueData as String] == nil,
                  attributes[kSecValueRef as String] == nil,
                  attributes[kSecValuePersistentRef as String] == nil else {
                return InventoryFailure.value_reference.response
            }
            guard let account = attributes[kSecAttrAccount as String] as? NSString else { return InventoryFailure.account_shape.response }
            // NSString can carry isolated UTF-16 surrogates which Swift String
            // repairs. Refuse instead of changing an account's identity.
            var units = [UInt16](repeating: 0, count: account.length)
            account.getCharacters(&units, range: NSRange(location: 0, length: account.length))
            guard Array((account as String).utf16) == units else { return InventoryFailure.account_encoding.response }
            // String.hasPrefix is grapheme-aware: a combining mark after the
            // delimiter must not make an owned artifact appear foreign.
            if !units.starts(with: prefix) { continue }
            let suffix = Array(units.dropFirst(prefix.count))
            guard suffix.count <= 192, names.count < inventoryKeyLimit else { return InventoryFailure.key_limit.response }
            let key = String(decoding: suffix, as: UTF16.self)
            guard !suffix.isEmpty,
                  !key.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                  seen.insert(suffix).inserted else { return InventoryFailure.key_shape.response }
            guard let sync = attributes[kSecAttrSynchronizable as String] as? NSNumber else { return InventoryFailure.sync_shape.response }
            let syncType = CFGetTypeID(sync)
            let synchronizable: Bool
            if syncType == CFBooleanGetTypeID() {
                synchronizable = sync.boolValue
            } else if syncType == CFNumberGetTypeID() {
                // Apple's Security database returns Sync attributes as integer
                // CFNumber (SecDbItem.c / SecItemDb.c), despite the public
                // CFBoolean description. Normalize only exact integer 0/1;
                // never boolValue, a rounded conversion or an absent default.
                let number = unsafeBitCast(sync, to: CFNumber.self) // verified toll-free CF type above
                var value: Int64 = 0
                guard !CFNumberIsFloatType(number),
                      CFNumberGetValue(number, .sInt64Type, &value),
                      value == 0 || value == 1 else { return InventoryFailure.sync_shape.response }
                synchronizable = value == 1
            } else { return InventoryFailure.sync_shape.response }
            guard !synchronizable else { return InventoryFailure.sync_enabled.response }
            if let rawService = attributes[kSecAttrService as String] {
                guard let service = rawService as? String else { return InventoryFailure.service_shape.response }
                guard service.isEmpty else { return InventoryFailure.service_present.response }
            }
            names.append(suffix)
        }
        names.sort { $0.lexicographicallyPrecedes($1) }
        return ["kind": "complete", "keys": names.map { String(decoding: $0, as: UTF16.self) }]
    }

    static func read(_ key: String, copyMatching: CopyMatching = SecItemCopyMatching) -> [String: Any] {
        guard !key.isEmpty, key.utf16.count <= 192,
              !key.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else {
            return ["kind": "unreadable"]
        }
        let context = LAContext()
        context.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: namespace + key,
            kSecAttrSynchronizable as String: false,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true,
            kSecUseAuthenticationContext as String: context
        ]
        var result: CFTypeRef?
        let status = copyMatching(query as CFDictionary, &result)
        // Only this platform result establishes absence. Never infer it from
        // nil data, a different item, a failed decode, a timeout or enumeration.
        if status == errSecItemNotFound { return ["kind": "established_absent"] }
        guard status == errSecSuccess else { return ["kind": "inaccessible"] }
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
            return ["kind": "unreadable"]
        }
        return ["kind": "value", "value": value]
    }
}
