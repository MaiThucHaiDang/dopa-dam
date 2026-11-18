#!/usr/bin/env python3
"""Prints "<udid><TAB><name><TAB><runtime>" of an available iPhone simulator, so no device name is hard-coded.

  pick-simulator.py main    the runtime of the iOS SDK that Xcode builds with (else the newest); "iPhone 16" when it
                            exists, else the first iPhone by name
  pick-simulator.py small   the narrowest screen: an "iPhone SE" on that runtime (else any runtime); exit 3 if none

Everything available is listed on stderr, for the log.
"""
import json
import subprocess
import sys


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "main"
    raw = subprocess.check_output(["xcrun", "simctl", "list", "devices", "available", "-j"])
    found = []
    for runtime, devices in json.loads(raw)["devices"].items():
        if ".iOS-" not in runtime:
            continue
        version = tuple(int(p) for p in runtime.split(".iOS-")[1].split("-"))
        for device in devices:
            if device.get("isAvailable", True) and device["name"].startswith("iPhone"):
                found.append((version, device["name"], device["udid"], runtime))
    for version, name, udid, runtime in sorted(found):
        print(f"available: {name} / iOS {'.'.join(map(str, version))} / {udid}", file=sys.stderr)
    if not found:
        return 1
    # The runtime that matches the SDK of this Xcode (18.5 for Xcode 16.4); the image also has newer ones.
    sdk = subprocess.run(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"], capture_output=True, text=True).stdout.strip()
    wanted = tuple(int(p) for p in sdk.split(".")[:2]) if sdk else ()
    matching = [f for f in found if f[0][:2] == wanted]
    pool = matching or found
    print(f"SDK {sdk}: using {'the matching runtime' if matching else 'the newest runtime'}", file=sys.stderr)
    if mode == "small":
        small = [f for f in pool if " SE" in f[1]] or [f for f in found if " SE" in f[1]]
        if not small:
            return 3
        chosen = max(small, key=lambda f: (f[0], f[1]))
    else:
        newest = max(f[0] for f in pool)
        current = sorted((f for f in pool if f[0] == newest), key=lambda f: f[1])
        exact = [f for f in current if f[1] == "iPhone 16"]
        chosen = (exact or current)[0]
    print(f"{chosen[2]}\t{chosen[1]}\t{chosen[3]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
