"""End-to-end check of the Android app on an emulator (or a phone with USB debugging).

Installs the APK, turns on the accessibility service with adb, then drives the real UI:
tags the system Settings app as "Giải trí", opens it, checks that the warning covers it, presses
Back (= Thoát) and checks that DopaDam counted the warning and the exit.
Then starts a study session from the Study tab, checks the warning again, and that ending early
asks for the confirmation.

Usage (an emulator or device must already be running):
    python android/e2e/emulator_test.py [--apk path/to/app-debug.apk] [--shots out_dir]
"""
import argparse
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

PKG = "com.dang.dopadam"
SERVICE = f"{PKG}/{PKG}.service.GuardService"
TARGET_PKG = "com.android.settings"
SDK = Path(os.environ.get("ANDROID_HOME") or Path(os.environ["LOCALAPPDATA"]) / "Android" / "Sdk")
ADB = str(SDK / "platform-tools" / ("adb.exe" if os.name == "nt" else "adb"))


def adb(*args, check=True, binary=False):
    out = subprocess.run([ADB, *args], capture_output=True, check=False)
    if check and out.returncode != 0:
        raise RuntimeError(f"adb {' '.join(args)} failed: {out.stderr.decode(errors='replace')}")
    return out.stdout if binary else out.stdout.decode("utf-8", errors="replace")


def shell(cmd, check=True):
    return adb("shell", cmd, check=check)


def dump_ui():
    """Returns all nodes of the current UI hierarchy as (text, desc, bounds-center, package)."""
    for _ in range(5):
        shell("uiautomator dump /sdcard/ui.xml", check=False)
        raw = adb("shell", "cat", "/sdcard/ui.xml", check=False)
        if raw.strip().startswith("<?xml"):
            break
        time.sleep(1)
    nodes = []
    for n in ET.fromstring(raw[raw.index("<?xml"):].encode("utf-8")).iter("node"):
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", n.get("bounds", "[0,0][0,0]")))
        nodes.append((n.get("text", ""), n.get("content-desc", ""), ((x1 + x2) // 2, (y1 + y2) // 2), n.get("package", "")))
    return nodes


def find(text, exact=False, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for t, d, center, _ in dump_ui():
            for value in (t, d):
                if value and ((value == text) if exact else (text in value)):
                    return center
        time.sleep(1)
    raise AssertionError(f"'{text}' not found on screen")


def tap(text, exact=False, timeout=15):
    x, y = find(text, exact, timeout)
    shell(f"input tap {x} {y}")
    time.sleep(1.2)


def screen_has(text):
    return any(text in t or text in d for t, d, _, _ in dump_ui())


def screenshot(out_dir, name):
    if not out_dir:
        return
    png = adb("exec-out", "screencap", "-p", binary=True)
    Path(out_dir, name).write_bytes(png)


def overlay_visible():
    """True when a visible accessibility overlay window (type 2032) owned by DopaDam is on screen."""
    dump = shell("dumpsys window windows", check=False)
    for block in re.split(r"\n\s*Window #\d+ ", dump):
        if f"package={PKG}" in block and re.search(r"ty=(2032|ACCESSIBILITY_OVERLAY)", block) and "mViewVisibility=0x0" in block:
            return True
    return False


failures = 0


def check(name, fn):
    global failures
    try:
        fn()
        print(f"  ok    {name}")
    except Exception as e:  # noqa: BLE001 - report every failing step and keep going
        failures += 1
        print(f"  FAIL  {name}\n        {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", default=str(Path(__file__).resolve().parents[1] / "app/build/outputs/apk/release/app-release.apk"))
    parser.add_argument("--shots", default=None)
    args = parser.parse_args()
    if args.shots:
        Path(args.shots).mkdir(parents=True, exist_ok=True)

    adb("wait-for-device")
    while shell("getprop sys.boot_completed").strip() != "1":
        time.sleep(2)
    print("Device:", shell("getprop ro.product.model").strip(), "Android", shell("getprop ro.build.version.release").strip())

    adb("uninstall", PKG, check=False)
    adb("install", "-r", "-g", args.apk)
    shell("settings put secure enabled_accessibility_services " + SERVICE)
    shell("settings put secure accessibility_enabled 1")
    shell("input keyevent KEYCODE_WAKEUP")
    shell("wm dismiss-keyguard", check=False)

    def service_bound():
        for _ in range(20):
            if SERVICE.split("/")[1] in shell("dumpsys accessibility", check=False):
                return
            time.sleep(1)
        raise AssertionError("accessibility service not bound")

    check("accessibility service is bound", service_bound)

    def open_app():
        shell(f"monkey -p {PKG} -c android.intent.category.LAUNCHER 1")
        find("Tổng quan", timeout=60)
        screenshot(args.shots, "01-overview.png")

    check("app opens on the overview", open_app)

    def tag_settings():
        tap("Ứng dụng", exact=True)
        find("Chưa gán tag")
        screenshot(args.shots, "02-apps.png")
        tap("Settings", exact=True)
        tap("Giải trí", exact=True)
        screenshot(args.shots, "03-tag-dialog.png")
        tap("Lưu tag", exact=True)
        tap("Tìm app")
        shell("input text Sett")
        time.sleep(1.5)
        find("Đã gán tag (1)")
        find("Giải trí", exact=True)
        shell("input keyevent KEYCODE_BACK")  # hide the keyboard

    check("tag the Settings app as Giải trí", tag_settings)

    def warning_covers_app():
        shell("input keyevent KEYCODE_HOME")
        time.sleep(1)
        shell(f"monkey -p {TARGET_PKG} -c android.intent.category.LAUNCHER 1")
        deadline = time.time() + 10
        while time.time() < deadline and not overlay_visible():
            time.sleep(0.5)
        time.sleep(1.5)
        screenshot(args.shots, "04-warning.png")
        if not overlay_visible():
            raise AssertionError("no accessibility overlay window after opening Settings")

    check("opening the tagged app shows the warning overlay", warning_covers_app)

    def back_is_exit():
        shell("input keyevent KEYCODE_BACK")
        time.sleep(2)
        if overlay_visible():
            raise AssertionError("overlay still visible after Back")
        focus = shell("dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'", check=False)
        if TARGET_PKG in focus and "launcher" not in focus.lower():
            raise AssertionError(f"still in the blocked app: {focus.strip()}")

    check("Back means Thoát: overlay closes and goes home", back_is_exit)

    def counted():
        # Open straight on the overview tab (the app may still show the app list with the keyboard up).
        shell(f"am start -n {PKG}/.MainActivity --es route overview")
        find("Bị chặn", exact=True, timeout=30)
        time.sleep(1)
        screenshot(args.shots, "05-overview-after.png")
        nodes = [t for t, _, _, _ in dump_ui()]
        i = nodes.index("Bị chặn")
        j = nodes.index("Chọn Thoát")
        if nodes[i + 1] != "1" or nodes[j + 1] != "1":
            raise AssertionError(f"expected 1 warning and 1 exit, screen shows {nodes[i:i + 4]}")

    check("the warning and the exit are counted", counted)

    def second_open_escalates():
        shell("input keyevent KEYCODE_HOME")
        time.sleep(1)
        shell(f"monkey -p {TARGET_PKG} -c android.intent.category.LAUNCHER 1")
        time.sleep(3)
        screenshot(args.shots, "06-warning-second.png")
        if not overlay_visible():
            raise AssertionError("no overlay on the second open")
        shell("input keyevent KEYCODE_BACK")
        time.sleep(1)

    check("opening again shows the warning again", second_open_escalates)

    def start_study():
        shell(f"am start -n {PKG}/.MainActivity --es route study")
        find("Khung giờ cố định", timeout=30)
        tap("Học gì?")
        shell("input text OnThi")
        shell("input keyevent KEYCODE_BACK")  # hide the keyboard
        time.sleep(1)
        tap("Học 25 phút", exact=True)
        find("Đang học: OnThi")
        screenshot(args.shots, "07-study.png")

    check("start a 25-minute study session from the Study tab", start_study)

    def warning_during_study():
        shell("input keyevent KEYCODE_HOME")
        time.sleep(1)
        shell(f"monkey -p {TARGET_PKG} -c android.intent.category.LAUNCHER 1")
        deadline = time.time() + 10
        while time.time() < deadline and not overlay_visible():
            time.sleep(0.5)
        time.sleep(1.5)
        screenshot(args.shots, "08-warning-study.png")
        if not overlay_visible():
            raise AssertionError("no overlay during study")
        shell("input keyevent KEYCODE_BACK")
        time.sleep(1)

    check("the warning shows during study", warning_during_study)

    def end_early_needs_confirmation():
        shell(f"am start -n {PKG}/.MainActivity --es route study")
        tap("Kết thúc sớm", exact=True, timeout=30)
        find("Thay đổi này làm yếu bảo vệ")
        find("Chờ ")
        screenshot(args.shots, "09-end-early.png")
        tap("Giữ nguyên bảo vệ", exact=True)
        find("Đang học: OnThi")

    check("ending study early asks for the confirmation", end_early_needs_confirmation)

    print(f"\n{failures} step(s) failed" if failures else "\nAll emulator checks passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
