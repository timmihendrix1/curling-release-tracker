# Brower TCi — native iOS BLE transport probe

A **development-only** engineering prototype. It connects to a physical Brower TCi
Timer over native iOS Bluetooth, inspects the documented services, reads raw
characteristic values, receives raw Athlete Data notifications, and exports what it saw.

It is **not** part of the Curling Performance Platform application. It has no account,
no Profile, no cloud connection and no sporting records, and it creates none.

Read `docs/BROWER_IOS_FEASIBILITY.md` at the repository root before using it. That
document holds the constraints, the dependency versions, the blockers and the
physical-device acceptance procedure. This file is only the command reference.

## What it will not do

- **Write to the timer.** The native transport interface declares no write operation, so
  no memory request, New Athlete, clear, channel or test command can be sent.
- **Decode anything.** Raw bytes only. The packet encoding is not established — see
  `docs/BROWER_INTEGRATION_STATUS.md`.
- **Fall back.** Off native iOS there is no transport at all: no Web Bluetooth, no
  sample data.
- **Run in the background.** No iOS background Bluetooth mode is declared.
- **Persist or upload anything.** The log is in memory and leaves the device only
  through an explicit share.

## Commands

```bash
npm install        # project-local; does not touch the repository root's node_modules
npm run typecheck
npm run lint
npm test
npm run build      # Vite build into dist/
npm run cap:sync   # copy dist/ into the native project
npm run cap:open   # open the generated Xcode project
```

`npm run dev` serves the UI in a browser. It is useful for laying out the screen and for
nothing else: without native iOS the probe reports an unsupported platform and offers no
Bluetooth controls.

To compile the native project without a signing identity, from the repository root:

```bash
xcodebuild -project tools/brower-ios-probe/ios/App/App.xcodeproj \
  -scheme App -destination 'generic/platform=iOS' -configuration Debug \
  -derivedDataPath /private/tmp/brower-ios-build CODE_SIGNING_ALLOWED=NO build
```

## Requirements

Node 22+ and Xcode 26.0+. Swift Package Manager is used; CocoaPods is not required.

## Status

The project compiles unsigned for a device target, and on **2026-09-28 it was run on a
physical iPhone**: it connected to a real Brower TCi Timer, discovered both documented
services, and received real Athlete Data notifications. The exported logs are archived at
`docs/hardware/brower/observations/2026-09-28-ios-manual/`, whose README is the authority
on what those bytes show and on the tests that session did **not** perform.

**No signing configuration was added to this repository.** There is still no
`DEVELOPMENT_TEAM`, no signing identity and no provisioning profile in any file here, and
none will be added. Running on a device requires a signing team chosen locally in Xcode
(`App` target → Signing & Capabilities) and **Developer Mode** enabled on the iPhone. That
the probe ran is an observation about the operator's machine and phone, not evidence that
anything in this repository configures signing.

**Not verified by that session:** any characteristic read, any write (the transport
declares no write operation), the all-nearby chooser, backgrounding or screen lock while a
subscription is active, timing gates, and 20-split rollover. **Android is entirely
untested** — no Android project exists here.

**Bluetooth does not work in the iOS Simulator.** Every BLE claim has to come from a
real device.
