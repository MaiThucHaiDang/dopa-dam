# Type-check of the iPhone app on Linux

`./run.sh` (from anywhere; needs the Swift toolchain in `.toolchain/swift`) type-checks every file of `DopaDam/`
with the real Swift compiler, without a Mac:

1. builds `DopaDamCore` (the real package) into `.toolchain/ios-typecheck/core-build`;
2. compiles the stub modules in `Stubs/` (`SwiftUI`, `AppIntents`, `UserNotifications`, `UIKit`) into
   `.toolchain/ios-typecheck/stubs`;
3. runs `swiftc -typecheck -swift-version 5` on all app files against the stubs and the real core module;
4. type-checks the real `Support/SystemActions.swift` separately, with `#selector(URLSessionTask.suspend)` replaced by
   `Selector("suspend")` (`#selector` needs the Objective-C runtime). The other files see a stand-in
   `SystemActions` from `Stubs/SystemActions/`; keep its two function signatures equal to the real file.

It also fails when the app writes a bare `Settings`: SwiftUI declares a `Settings` scene type too, so the core's type
must be written `DopaDamCore.Settings`.

Build output stays under `.toolchain/ios-typecheck/` (git-ignored). The exit status is non-zero on any error.
Warnings are printed and do not fail the run (today: `Binding(get:set:)` closures reading the `@MainActor`
model; Swift 5 language mode only warns).

## What it proves

- Every call into `DopaDamCore` is right: labels, types, optionality, access levels, `Identifiable` / `Hashable`
  conformances, `mutating`, result types.
- The app's own types, generics, `@Observable` (the real macro), `@MainActor` use and type inference inside view
  builders (including the 10-children limit of `buildBlock`).

## What it cannot prove

- That Apple's real API matches the stubs. The stubs were written from knowledge of the iOS 17 SDK, not generated
  from it. A wrong stub can hide an error or invent one; the items least certain are listed at the top of
  `Stubs/AppIntents/AppIntents.swift` (shape of `.result(...)`, `AppIntent.description`) and in the report that came
  with this check.
- Anything that depends on the Apple SDK's availability (`@available`), deprecations, Xcode's AppIntents metadata
  extraction, the asset catalog compiler, signing, or run-time behaviour on a device.
