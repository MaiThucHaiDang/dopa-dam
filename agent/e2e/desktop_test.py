"""Desktop check of the Windows agent: tags Notepad as entertainment, opens it, checks that the
warning window covers it, presses Enter (= Thoát) and checks the decision and that Notepad was
minimized.

The agent runs hidden with a temporary data folder and without starting with Windows. Its
native messaging registry entry is removed at the end.

Usage: python agent/e2e/desktop_test.py [--shot out.png]
Needs the debug build (cd agent && npm run build:ui && cd src-tauri && cargo build) and Pillow.
"""
import argparse
import ctypes
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from ctypes import wintypes
from pathlib import Path

AGENT = Path(__file__).resolve().parents[1] / "src-tauri" / "target" / "debug" / "dopadam.exe"
REG_KEYS = [
    r"HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.dang.dopadam",
    r"HKCU\Software\Google\Chrome\NativeMessagingHosts\com.dang.dopadam",
]
user32 = ctypes.windll.user32


def wait(fn, what, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = fn()
        if value:
            return value
        time.sleep(0.3)
    raise AssertionError(f"timed out waiting for {what}")


def query(db, sql, *args):
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        return con.execute(sql, args).fetchall()
    finally:
        con.close()


def foreground_title():
    hwnd = user32.GetForegroundWindow()
    buf = ctypes.create_unicode_buffer(256)
    user32.GetWindowTextW(hwnd, buf, 256)
    return hwnd, buf.value


def find_window(title_part):
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _):
        buf = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, buf, 256)
        if title_part in buf.value and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True

    user32.EnumWindows(cb, 0)
    return found[0] if found else None


def press_enter():
    VK_RETURN, KEYUP = 0x0D, 0x0002
    user32.keybd_event(VK_RETURN, 0, 0, 0)
    user32.keybd_event(VK_RETURN, 0, KEYUP, 0)


failures = 0


def check(name, fn):
    global failures
    try:
        fn()
        print(f"  ok    {name}")
    except Exception as e:  # noqa: BLE001 - report every failing step
        failures += 1
        print(f"  FAIL  {name}\n        {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--shot", default=None)
    args = parser.parse_args()
    if not AGENT.exists():
        sys.exit(f"Agent not built: {AGENT}")

    data = Path(tempfile.mkdtemp(prefix="dopadam-desktop-"))
    db = data / "dopadam.db"
    env = dict(os.environ, DOPADAM_DATA_DIR=str(data), DOPADAM_NO_AUTOSTART="1", DOPADAM_QUIET="1")
    agent = subprocess.Popen([str(AGENT), "--hidden"], env=env)
    notepad = None
    try:
        wait(lambda: db.exists() and query(db, "SELECT COUNT(*) FROM kv")[0][0] > 0, "agent database")

        def tag_notepad():
            con = sqlite3.connect(db)
            now = int(time.time() * 1000)
            con.execute(
                "INSERT INTO tag_rules(id, kind, pattern, tag, delay_seconds, updated_at) VALUES('exe:notepad.exe', 'exe', 'notepad.exe', 'entertainment', NULL, ?)",
                (now,),
            )
            con.commit()
            con.close()

        check("tag notepad.exe as entertainment", tag_notepad)

        def warning_covers_notepad():
            nonlocal notepad
            notepad = subprocess.Popen(["notepad.exe"])
            wait(lambda: query(db, "SELECT COUNT(*) FROM intercept_events WHERE object = 'notepad.exe'")[0][0] == 1, "warning event", 25)
            # The warning window is titled "DopaDam" and should be the foreground window.
            wait(lambda: foreground_title()[1] == "DopaDam", "warning window in front", 10)
            time.sleep(1.0)
            if args.shot:
                from PIL import ImageGrab

                ImageGrab.grab().save(args.shot)

        check("opening Notepad shows the warning in front", warning_covers_notepad)

        def enter_is_exit():
            press_enter()
            rows = wait(lambda: [r for r in query(db, "SELECT decision FROM intercept_events") if r[0]], "decision", 10)
            assert rows == [("exit",)], rows
            hwnd = wait(lambda: find_window("Notepad") or find_window("Untitled"), "notepad window", 5)
            wait(lambda: user32.IsIconic(hwnd), "Notepad minimized", 5)

        check("Enter means Thoát: decision recorded and Notepad minimized", enter_is_exit)
    finally:
        subprocess.run(["taskkill", "/IM", "notepad.exe", "/F"], capture_output=True)
        agent.kill()
        agent.wait(timeout=10)
        for key in REG_KEYS:
            subprocess.run(["reg", "delete", key, "/f"], capture_output=True)
        time.sleep(0.5)
        import shutil

        shutil.rmtree(data, ignore_errors=True)

    print(f"\n{failures} step(s) failed" if failures else "\nAll desktop checks passed")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
