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
        guard status == errSecSuccess else { return ["kind": "inaccessible"] }
        guard let rows = result as? [Any], !rows.isEmpty else { return ["kind": "unreadable"] }
        let prefix = Array(namespace.utf16)
        var names = [[UInt16]]()
        var seen = Set<[UInt16]>()
        for raw in rows {
            guard let attributes = raw as? [String: Any],
                  attributes[kSecValueData as String] == nil,
                  attributes[kSecValueRef as String] == nil,
                  attributes[kSecValuePersistentRef as String] == nil,
                  let account = attributes[kSecAttrAccount as String] as? NSString else {
                return ["kind": "unreadable"]
            }
            // NSString can carry isolated UTF-16 surrogates which Swift String
            // repairs. Refuse instead of changing an account's identity.
            var units = [UInt16](repeating: 0, count: account.length)
            account.getCharacters(&units, range: NSRange(location: 0, length: account.length))
            guard Array((account as String).utf16) == units else { return ["kind": "unreadable"] }
            // String.hasPrefix is grapheme-aware: a combining mark after the
            // delimiter must not make an owned artifact appear foreign.
            if !units.starts(with: prefix) { continue }
            let suffix = Array(units.dropFirst(prefix.count))
            guard suffix.count <= 192, names.count < inventoryKeyLimit else { return ["kind": "limit_exceeded"] }
            let key = String(decoding: suffix, as: UTF16.self)
            guard !suffix.isEmpty,
                  !key.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
                  seen.insert(suffix).inserted else { return ["kind": "unreadable"] }
            guard let sync = attributes[kSecAttrSynchronizable as String] as? NSNumber,
                  CFGetTypeID(sync) == CFBooleanGetTypeID() else { return ["kind": "unreadable"] }
            guard !sync.boolValue else { return ["kind": "unsupported_scope"] }
            if let rawService = attributes[kSecAttrService as String] {
                guard let service = rawService as? String else { return ["kind": "unreadable"] }
                guard service.isEmpty else { return ["kind": "unsupported_scope"] }
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
