#!/usr/bin/env bash
# Type-checks the whole DopaDam app target on Linux against stub modules of Apple's frameworks.
# Usage: ios/native/typecheck/run.sh   (from anywhere). Exits non-zero on any error.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
NATIVE="$ROOT/ios/native"
OUT="$ROOT/.toolchain/ios-typecheck"
STUBS="$OUT/stubs"
CORE_BUILD="$OUT/core-build"

# shellcheck disable=SC1091
. "$ROOT/.toolchain/scripts/swift-env.sh"

# Clean state for the stubs (the core build is incremental on purpose; it is cheap and SwiftPM is reliable).
rm -rf "$STUBS" "$OUT/app-check"
mkdir -p "$STUBS" "$OUT/app-check"

echo "== 1/4 build DopaDamCore"
swift build --package-path "$NATIVE/DopaDamCore" --build-path "$CORE_BUILD" 2>&1 | tail -n 3
CORE_MODULES="$(dirname "$(find "$CORE_BUILD" -name DopaDamCore.swiftmodule -path '*Modules*' | head -n 1)")"

echo "== 2/4 build stub modules"
# Order matters: UIKit and AppIntents first, UserNotifications, then SwiftUI (which imports UIKit).
for m in UIKit UserNotifications AppIntents SwiftUI; do
  swiftc -emit-module -module-name "$m" -parse-as-library -swift-version 5 \
    -I "$STUBS" -emit-module-path "$STUBS/$m.swiftmodule" \
    $(find "$HERE/Stubs/$m" -name '*.swift')
done

echo "== name collisions: DopaDamCore.Settings vs SwiftUI.Settings"
# On iOS, SwiftUI declares a Settings scene type too; the core's type must always be written DopaDamCore.Settings.
if grep -rnE '(^|[^A-Za-z0-9_.])Settings\b' "$NATIVE/DopaDam" --include='*.swift' | grep -v '^[^:]*:[0-9]*: *//'; then
  echo "error: bare 'Settings' in the app; write DopaDamCore.Settings"; exit 1
fi

echo "== 3/4 type-check the app (everything except Support/SystemActions.swift)"
APP_FILES=$(find "$NATIVE/DopaDam" -name '*.swift' ! -name SystemActions.swift | sort)
swiftc -typecheck -parse-as-library -swift-version 5 \
  -I "$STUBS" -I "$CORE_MODULES" \
  $APP_FILES "$HERE/Stubs/SystemActions/SystemActions.swift"

echo "== 4/4 type-check the real Support/SystemActions.swift (selector expression replaced)"
# `#selector(URLSessionTask.suspend)` needs the Objective-C runtime; the stub UIKit has a Selector(String) stand-in.
sed 's/#selector(URLSessionTask\.suspend)/Selector("suspend")/' "$NATIVE/DopaDam/Support/SystemActions.swift" > "$OUT/app-check/SystemActions.swift"
grep -q 'Selector("suspend")' "$OUT/app-check/SystemActions.swift" \
  || { echo "SystemActions.swift no longer contains #selector(URLSessionTask.suspend); update run.sh"; exit 1; }
swiftc -typecheck -parse-as-library -swift-version 5 -I "$STUBS" "$OUT/app-check/SystemActions.swift"

echo "OK: the app type-checks against the stubs"
