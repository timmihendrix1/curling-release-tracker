import Foundation
import Security
import LocalAuthentication

@main
enum CredentialKeychainReaderTests {
    static func main() {
        var count = 0
        func check(_ condition: Bool, file: StaticString = #fileID, line: UInt = #line) {
            precondition(condition, "Keychain reader contract failed", file: file, line: line)
            count += 1
        }
        func read(_ status: OSStatus, _ data: CFTypeRef? = nil) -> [String: Any] {
            CredentialKeychainReader.read("synthetic-key") { query, result in
                let attributes = query as NSDictionary
                check(attributes[kSecClass] as? String == kSecClassGenericPassword as String)
                check(attributes[kSecAttrAccount] as? String == "curling.credentials.v1.synthetic-key")
                check(attributes[kSecAttrSynchronizable] as? Bool == false)
                check(attributes[kSecMatchLimit] as? String == kSecMatchLimitOne as String)
                check(attributes[kSecReturnData] as? Bool == true)
                check((attributes[kSecUseAuthenticationContext] as? LAContext)?.interactionNotAllowed == true)
                check(attributes[kSecAttrAccessGroup] == nil)
                check(attributes[kSecAttrService] == nil)
                result?.pointee = data
                return status
            }
        }
        check(read(errSecItemNotFound)["kind"] as? String == "established_absent")
        for status in [errSecInteractionNotAllowed, errSecAuthFailed, errSecDecode, errSecNotAvailable, OSStatus(-1)] {
            check(read(status)["kind"] as? String == "inaccessible")
        }
        check(read(errSecSuccess)["kind"] as? String == "unreadable")
        check(read(errSecSuccess, NSData(bytes: [UInt8(0xff)], length: 1))["kind"] as? String == "unreadable")
        for value in ["", "synthetic\n\u{0000}🚀"] {
            let result = read(errSecSuccess, value.data(using: .utf8)! as NSData)
            check(result["kind"] as? String == "value")
            check(result["value"] as? String == value)
        }
        for key in ["", "bad\nkey", String(repeating: "x", count: 193)] {
            let result = CredentialKeychainReader.read(key) { _, _ in
                preconditionFailure("Invalid key reached native storage")
            }
            check(result["kind"] as? String == "unreadable")
        }

        func inventory(_ status: OSStatus, _ data: CFTypeRef? = nil) -> [String: Any] {
            CredentialKeychainReader.inventory { query, result in
                let attributes = query as NSDictionary
                check(attributes[kSecClass] as? String == kSecClassGenericPassword as String)
                check(attributes[kSecMatchLimit] as? String == kSecMatchLimitAll as String)
                check(attributes[kSecReturnAttributes] as? Bool == true)
                check(attributes[kSecReturnData] as? Bool == false)
                check(attributes[kSecReturnRef] == nil && attributes[kSecReturnPersistentRef] == nil)
                check(attributes[kSecAttrSynchronizable] as? String == kSecAttrSynchronizableAny as String)
                check(attributes[kSecAttrAccount] == nil && attributes[kSecAttrService] == nil)
                check(attributes[kSecAttrAccessGroup] == nil)
                check((attributes[kSecUseAuthenticationContext] as? LAContext)?.interactionNotAllowed == true)
                check(attributes.count == 6)
                result?.pointee = data
                return status
            }
        }
        func row(_ suffix: String, sync: Any = NSNumber(value: false)) -> [String: Any] {
            [kSecAttrAccount as String: CredentialKeychainReader.namespace + suffix,
             kSecAttrSynchronizable as String: sync]
        }
        func failed(_ status: OSStatus, _ data: CFTypeRef?, _ kind: String, _ diagnostic: String) {
            let result = inventory(status, data)
            check(result["kind"] as? String == kind)
            check(result.count == 2 && result["keys"] == nil)
            check(result["diagnostic"] as? String == diagnostic)
        }
        let empty = inventory(errSecItemNotFound)
        check(empty["kind"] as? String == "complete")
        check((empty["keys"] as? [String])?.isEmpty == true)
        check(empty.count == 2 && empty["diagnostic"] == nil)
        for (status, diagnostic) in [(errSecInteractionNotAllowed, "os_interaction_not_allowed"),
                                     (errSecAuthFailed, "os_auth_failed"), (errSecDecode, "os_decode"),
                                     (errSecNotAvailable, "os_not_available"), (errSecMissingEntitlement, "os_missing_entitlement"),
                                     (errSecParam, "os_parameter"), (OSStatus(-1), "os_other")] {
            failed(status, [row("retained")] as NSArray, "inaccessible", diagnostic)
        }
        for malformed: CFTypeRef? in [nil, NSArray(), NSDictionary()] {
            failed(errSecSuccess, malformed, "unreadable", "rows_shape")
        }
        failed(errSecSuccess, [NSNull()] as NSArray, "unreadable", "row_shape")
        for malformed in [[["wrong": "shape"]] as NSArray, [[kSecAttrAccount as String: NSNumber(value: 0)]] as NSArray] {
            failed(errSecSuccess, malformed, "unreadable", "account_shape")
        }
        let foreign = [[kSecAttrAccount as String: "unrelated-private-account"]] as NSArray
        let excluded = inventory(errSecSuccess, foreign)
        check(excluded["kind"] as? String == "complete")
        check((excluded["keys"] as? [String])?.isEmpty == true)

        let suffixes = ["z-orphan", "sb-fixture-auth-token-flow-unindexed1-code-verifier", "\u{e000}", "🥌", "é", "e\u{301}", "\u{301}after-delimiter", String(repeating: "x", count: 192)]
        let observed = inventory(errSecSuccess, suffixes.map { row($0) } as NSArray)
        check(observed["kind"] as? String == "complete")
        check((observed["keys"] as? [String])?.map { Array($0.utf16) } == suffixes.map { Array($0.utf16) }.sorted { $0.lexicographicallyPrecedes($1) })
        check((observed["keys"] as? [String])?.count == suffixes.count)
        failed(errSecSuccess, [row("same"), row("same")] as NSArray, "unreadable", "key_shape")
        for suffix in ["", "bad\nkey", "bad\u{200e}key"] {
            failed(errSecSuccess, [row(suffix)] as NSArray, "unreadable", "key_shape")
        }
        failed(errSecSuccess, [row(String(repeating: "x", count: 193))] as NSArray, "limit_exceeded", "key_limit")
        // Actual returned-attribute shape in Apple's Security source: integer
        // CFNumber. Exercise the whole inventory, not a standalone coercion.
        var zero32: Int32 = 0, zero64: Int64 = 0
        let numericZeros: [Any] = [NSNumber(value: 0), CFNumberCreate(nil, .sInt32Type, &zero32)!, CFNumberCreate(nil, .sInt64Type, &zero64)!]
        for sync in numericZeros {
            check(CFGetTypeID(sync as! NSNumber) == CFNumberGetTypeID())
            let result = inventory(errSecSuccess, [row("numeric-zero", sync: sync)] as NSArray)
            check(result["kind"] as? String == "complete")
            check((result["keys"] as? [String]) == ["numeric-zero"])
            check(result.count == 2 && result["diagnostic"] == nil)
        }
        var one32: Int32 = 1
        for sync: Any in [NSNumber(value: 1), CFNumberCreate(nil, .sInt32Type, &one32)!] {
            failed(errSecSuccess, [row("numeric-enabled", sync: sync)] as NSArray, "unsupported_scope", "sync_enabled")
        }
        for sync: Any in [NSNull(), "false", "0", "1", Data(), NSArray(), NSDictionary(),
                          NSNumber(value: -1), NSNumber(value: 2), NSNumber(value: Int64.min),
                          NSNumber(value: Int64.max), NSNumber(value: UInt64.max)] {
            failed(errSecSuccess, [row("scope", sync: sync)] as NSArray, "unreadable", "sync_shape")
        }
        for raw in [0.0, -0.0, 1.0, 0.5, -0.5, Double.nan, Double.infinity, -Double.infinity] {
            var value = raw
            let sync = CFNumberCreate(nil, .doubleType, &value)!
            check(CFNumberIsFloatType(sync))
            failed(errSecSuccess, [row("floating", sync: sync)] as NSArray, "unreadable", "sync_shape")
        }
        // A valid numeric row cannot hide a later poisoned/enabled/duplicate row.
        failed(errSecSuccess, [row("valid", sync: NSNumber(value: 0)), row("poisoned", sync: "0")] as NSArray, "unreadable", "sync_shape")
        failed(errSecSuccess, [row("valid", sync: NSNumber(value: 0)), row("enabled", sync: NSNumber(value: 1))] as NSArray, "unsupported_scope", "sync_enabled")
        failed(errSecSuccess, [row("duplicate", sync: NSNumber(value: 0)), row("duplicate")] as NSArray, "unreadable", "key_shape")
        var numericService = row("numeric-service", sync: NSNumber(value: 0)); numericService[kSecAttrService as String] = "other"
        failed(errSecSuccess, [numericService] as NSArray, "unsupported_scope", "service_present")
        failed(errSecSuccess, [[kSecAttrAccount as String: CredentialKeychainReader.namespace + "missing-sync"]] as NSArray, "unreadable", "sync_shape")
        failed(errSecSuccess, [row("sync", sync: NSNumber(value: true))] as NSArray, "unsupported_scope", "sync_enabled")
        for service: Any in [NSNull(), NSNumber(value: 0)] {
            var attributes = row("service"); attributes[kSecAttrService as String] = service
            failed(errSecSuccess, [attributes] as NSArray, "unreadable", "service_shape")
        }
        var service = row("service"); service[kSecAttrService as String] = "other"
        failed(errSecSuccess, [service] as NSArray, "unsupported_scope", "service_present")
        service[kSecAttrService as String] = ""
        check(inventory(errSecSuccess, [service] as NSArray)["kind"] as? String == "complete")
        var leakedData = row("payload"); leakedData[kSecValueData as String] = Data([1, 2, 3])
        failed(errSecSuccess, [leakedData] as NSArray, "unreadable", "value_reference")
        var invalidUnits = Array(CredentialKeychainReader.namespace.utf16); invalidUnits.append(0xd800)
        let invalidAccount = invalidUnits.withUnsafeBufferPointer { NSString(characters: $0.baseAddress!, length: $0.count) }
        failed(errSecSuccess, [[kSecAttrAccount as String: invalidAccount, kSecAttrSynchronizable as String: false]] as NSArray, "unreadable", "account_encoding")
        let many = (0..<4_096).map { row("item-\($0)") }
        let limit = inventory(errSecSuccess, many as NSArray)
        check(limit["kind"] as? String == "complete")
        check((limit["keys"] as? [String])?.count == 4_096)
        failed(errSecSuccess, (many + [row("overflow")]) as NSArray, "limit_exceeded", "key_limit")
        print("Keychain reader: \(count) contract assertions passed (injected Security API; no device claim).")
    }
}
