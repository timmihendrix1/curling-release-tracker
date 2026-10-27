import Capacitor

@objc(CredentialKeychainReaderPlugin)
public class CredentialKeychainReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CredentialKeychainReaderPlugin"
    public let jsName = "CurlingCredentialReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "inventory", returnType: CAPPluginReturnPromise)
    ]

    @objc public func read(_ call: CAPPluginCall) {
        guard let key = call.getString("key") else {
            call.resolve(["kind": "unreadable"])
            return
        }
        call.resolve(CredentialKeychainReader.read(key))
    }

    @objc public func inventory(_ call: CAPPluginCall) {
        call.resolve(CredentialKeychainReader.inventory())
    }
}
