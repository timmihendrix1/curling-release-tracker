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
        func failed(_ status: OSStatus, _ data: CFTypeRef?, _ kind: String) {
            let result = inventory(status, data)
            check(result["kind"] as? String == kind)
            check(result.count == 1 && result["keys"] == nil)
        }
        let empty = inventory(errSecItemNotFound)
        check(empty["kind"] as? String == "complete")
        check((empty["keys"] as? [String])?.isEmpty == true)
        for status in [errSecInteractionNotAllowed, errSecAuthFailed, errSecDecode, errSecNotAvailable, OSStatus(-1)] {
            failed(status, [row("retained")] as NSArray, "inaccessible")
        }
        for malformed: CFTypeRef? in [nil, NSArray(), NSDictionary(), [NSNull()] as NSArray,
                                      [["wrong": "shape"]] as NSArray,
                                      [[kSecAttrAccount as String: NSNumber(value: 0)]] as NSArray] {
            failed(errSecSuccess, malformed, "unreadable")
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
        failed(errSecSuccess, [row("same"), row("same")] as NSArray, "unreadable")
        for suffix in ["", "bad\nkey", "bad\u{200e}key"] {
            failed(errSecSuccess, [row(suffix)] as NSArray, "unreadable")
        }
        failed(errSecSuccess, [row(String(repeating: "x", count: 193))] as NSArray, "limit_exceeded")
        for sync: Any in [NSNull(), "false", NSNumber(value: 0), NSNumber(value: 1)] {
            failed(errSecSuccess, [row("scope", sync: sync)] as NSArray, "unreadable")
        }
        failed(errSecSuccess, [[kSecAttrAccount as String: CredentialKeychainReader.namespace + "missing-sync"]] as NSArray, "unreadable")
        failed(errSecSuccess, [row("sync", sync: NSNumber(value: true))] as NSArray, "unsupported_scope")
        for service: Any in [NSNull(), NSNumber(value: 0)] {
            var attributes = row("service"); attributes[kSecAttrService as String] = service
            failed(errSecSuccess, [attributes] as NSArray, "unreadable")
        }
        var service = row("service"); service[kSecAttrService as String] = "other"
        failed(errSecSuccess, [service] as NSArray, "unsupported_scope")
        service[kSecAttrService as String] = ""
        check(inventory(errSecSuccess, [service] as NSArray)["kind"] as? String == "complete")
        var leakedData = row("payload"); leakedData[kSecValueData as String] = Data([1, 2, 3])
        failed(errSecSuccess, [leakedData] as NSArray, "unreadable")
        var invalidUnits = Array(CredentialKeychainReader.namespace.utf16); invalidUnits.append(0xd800)
        let invalidAccount = invalidUnits.withUnsafeBufferPointer { NSString(characters: $0.baseAddress!, length: $0.count) }
        failed(errSecSuccess, [[kSecAttrAccount as String: invalidAccount, kSecAttrSynchronizable as String: false]] as NSArray, "unreadable")
        let many = (0..<4_096).map { row("item-\($0)") }
        let limit = inventory(errSecSuccess, many as NSArray)
        check(limit["kind"] as? String == "complete")
        check((limit["keys"] as? [String])?.count == 4_096)
        failed(errSecSuccess, (many + [row("overflow")]) as NSArray, "limit_exceeded")
        print("Keychain reader: \(count) contract assertions passed (injected Security API; no device claim).")
    }
}
