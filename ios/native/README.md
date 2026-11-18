# DopaDam for iPhone (native)

SwiftUI app (iOS 17+, iPhone, portrait, dark, Vietnamese) and the Swift package it is built on.

## Layout

- `DopaDamCore/` - Swift package, Foundation only. The shared rules, the state machine over `AppState`, the read
  models and Vietnamese wording, and everything the screens decide without drawing: the warning flow
  (`WarningFlow`), `StateChange` + `ConfirmGate`, settings/study forms, notification specs, app URL schemes, the
  guide text. Built and tested on Linux (`swift build && swift test`, 112 tests, including the shared vectors).
- `DopaDam/` - the app target. `App/` (`@main`, the `@Observable` `AppModel`), `Intents/` (the two App Intents and
  the App Shortcuts provider), `Views/` (thin SwiftUI views), `Support/` (theme tokens, state file access, local
  notifications, the two UIKit calls), `Assets.xcassets` (icon from `shared/brand/icon-1024.png` flattened onto the
  background colour, accent colour).
- `DopaDamTests/` - unit tests hosted by the app: the two App Intents on a temporary state file.
- `DopaDamUITests/` - XCUITest: the warning flow, study mode, Cài đặt and its confirmation, Thống kê, every tab. Each
  step attaches a screenshot.
- `ci/` - scripts the workflow uses: `pick-simulator.py`, `collect-results.py` (xcresult to PNGs and a summary),
  `publish-logs.sh` (logs branch).
- `project.yml` - XcodeGen spec (bundle id `com.dang.dopadam`, iOS 17.0, Swift 5 mode, generated Info.plist with
  Vietnamese as the only localisation, no signing team, one scheme `DopaDam` whose test action runs both test
  targets). `DopaDam.xcodeproj` is generated and not committed.

## Debug launch arguments

`Support/DebugLaunch.swift` exists only in Debug builds (`#if DEBUG`; CI checks that the Release binary has no trace
of it). The UI tests, and you on a simulator, can start the app with: `-dopadam-reset` (empty state file),
`-dopadam-seed stats` (four weeks of history, made with the core's own `recordWarning`/`decide`), `-dopadam-warn <App>`
(the warning for that app, as the "mở màn hình hỏi" action shows it). `StateAccess.useStateFile(at:)` (Debug only) points
the state at a temporary file for the unit tests.

## How it blocks

No Screen Time entitlements. The user makes a Shortcuts automation "When <app> is opened" that runs
`DopaDam: có cần hỏi không` (parameter: the app's name) and, if the result is true, `DopaDam: mở màn hình hỏi`.
The in-app "Hướng dẫn" tab explains it.

## CI

`.github/workflows/ios-app.yml` (`macos-15`, on every push to `linux-port` that touches `ios/native`, and by hand) has
two jobs:

- `build`: `swift test` on the core, `xcodegen generate`, `xcodebuild` for `iphoneos` Release with
  `CODE_SIGNING_ALLOWED=NO` into `build/DerivedData`, a check that the Release binary has no Debug hooks, then
  `Payload/DopaDam.app` is zipped into `DopaDam-unsigned.ipa`. Artifacts: `DopaDam-unsigned-ipa` and `xcodebuild-log`.
  The `.ipa` is unsigned: sign it with AltStore, Sideloadly or similar before installing.
- `simulator-tests` (matrix `main` = iPhone 16, `small` = iPhone SE 3rd generation): picks an available simulator with
  `xcrun simctl list` (the runtime that matches the Xcode SDK), runs `xcodebuild test`, exports the screenshots from
  the `.xcresult` and uploads them as the artifact `simulator-results-<kind>`. `small` runs only the layout-heavy tests.

Both jobs publish their logs, and the simulator job its screenshots as PNG files, to the `ci-logs-ios` branch, one
subfolder each (`build/`, `simulator-main/`, `simulator-small/`), so no sign-in is needed:
`git fetch <repo> ci-logs-ios` then `git show FETCH_HEAD:simulator-main/run-summary.txt`. The branch is one commit,
replaced by each job with `--force-with-lease`, keeping the other jobs' folders.

Locally on a Mac: `brew install xcodegen && cd ios/native && xcodegen generate && open DopaDam.xcodeproj`.

## What was verified

- Linux: the core builds and its tests pass; the app type-checks against stubs (`typecheck/run.sh`).
- macOS runner (CI): the project builds for Release without warnings; the two App Intents pass their unit tests; the UI
  tests drive the whole app on an iOS 18.5 simulator (iPhone 16 and iPhone SE) and every step has a screenshot. This
  includes the Home-screen jump after Thoát and the system notification prompt.
- Not verified (needs a real iPhone): Shortcuts automations that call the two actions, opening other apps by URL
  scheme (the simulator has none of them installed), notifications actually arriving at the 4th and 5th minute,
  signing and sideloading.
