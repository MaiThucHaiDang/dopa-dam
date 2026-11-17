# DopaDam for iPhone (native)

SwiftUI app (iOS 17+, iPhone, portrait, dark, Vietnamese) and the Swift package it is built on.

## Layout

- `DopaDamCore/` - Swift package, Foundation only. The shared rules, the state machine over `AppState`, the read
  models and Vietnamese wording, and everything the screens decide without drawing: the warning flow
  (`WarningFlow`), `StateChange` + `ConfirmGate`, settings/study forms, notification specs, app URL schemes, the
  guide text. Built and tested on Linux (`swift build && swift test`, 111 tests, including the shared vectors).
- `DopaDam/` - the app target. `App/` (`@main`, the `@Observable` `AppModel`), `Intents/` (the two App Intents and
  the App Shortcuts provider), `Views/` (thin SwiftUI views), `Support/` (theme tokens, state file access, local
  notifications, the two UIKit calls), `Assets.xcassets` (icon from `shared/brand/icon-1024.png` flattened onto the
  background colour, accent colour).
- `project.yml` - XcodeGen spec (bundle id `com.dang.dopadam`, iOS 17.0, Swift 5 mode, generated Info.plist, no
  signing team). `DopaDam.xcodeproj` is generated and not committed.

## How it blocks

No Screen Time entitlements. The user makes a Shortcuts automation "When <app> is opened" that runs
`DopaDam: có cần hỏi không` (parameter: the app's name) and, if the result is true, `DopaDam: mở màn hình hỏi`.
The in-app "Hướng dẫn" tab explains it.

## CI

`.github/workflows/ios-app.yml` (manual, `macos-15`): `swift test` on the core, `xcodegen generate`, `xcodebuild`
for `iphoneos` Release with `CODE_SIGNING_ALLOWED=NO` into `build/DerivedData`, then `Payload/DopaDam.app` is zipped
into `DopaDam-unsigned.ipa`. Artifacts: `DopaDam-unsigned-ipa` and `xcodebuild-log` (uploaded even when the build
fails). The `.ipa` is unsigned: sign it with AltStore, Sideloadly or similar before installing.

Locally on a Mac: `brew install xcodegen && cd ios/native && xcodegen generate && open DopaDam.xcodeproj`.

## What was verified

- Linux: the core builds and its tests pass; every app file passes `swiftc -frontend -parse`; `AppModel`,
  `StateAccess` and `Clock` type-check against the real core (with stubs for the two UIKit/UserNotifications
  helpers).
- Not verified (no Xcode or iOS SDK here): that the SwiftUI views, the App Intents and the project compile; that
  XcodeGen's output builds; and everything that needs a device (Shortcuts automation, the Home-screen jump,
  URL schemes, notifications). Expect a first round of compile fixes from the CI log.
