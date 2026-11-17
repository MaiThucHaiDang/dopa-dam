#!/usr/bin/env python3
"""Scripted end-to-end run of the DopaDam warning flow in a private headless GNOME Shell.

    core_flow.py --agent /path/to/dopadam [--quick] [--keep-session] [--reuse-session]
    (or set DOPADAM_AGENT_BIN instead of --agent)

Exit status 0 when every check passed, 1 otherwise. Screenshots and logs go to
<work dir>/runs/<timestamp>/ (work dir: DOPADAM_E2E_DIR or <repo>/.toolchain/e2e-run).

The clicks use fixed positions measured on the 1280x800 virtual monitor; a pixel check on the
Thoát button stops the run with a clear message if the warning layout has moved.
"""
import argparse
import os
import signal
import sqlite3
import subprocess
import sys
import time

import agentctl
import probe

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WORK = os.environ.get("DOPADAM_E2E_DIR") or os.path.join(REPO, ".toolchain", "e2e-run")
SESSION = os.path.join(HERE, "session.sh")
WARNING_TITLE = "DopaDam – cảnh báo"
NOTICE_TITLE = "DopaDam – thông báo"
TARGET_EXE = "gnome-calculator"
TARGET_CLASS = "org.gnome.Calculator"

# Positions on the warning (1280x800) for the "choice" step without and with the allow options.
THOAT = (393, 391)
VAO = (343, 539)
ALTERNATIVE_LINK = (390, 482)
FIVE_MINUTES = (330, 575)  # after Vào was clicked, the content moves up
FIRST_ACTIVITY = (362, 332)  # "alternative" step
START_ACTIVITY = (345, 484)

results = []


class Stop(Exception):
    """A step the rest of the flow depends on failed."""


def need(name, ok, detail=""):
    if not check(name, ok, detail):
        raise Stop(name)
    return ok


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}", flush=True)
    return ok


def wait_for(pred, timeout, step=0.1):
    end = time.time() + timeout
    while time.time() < end:
        v = pred()
        if v:
            return v
        time.sleep(step)
    return None


def windows():
    return probe.windows()


def warning():
    return next((w for w in windows() if w["title"] == WARNING_TITLE), None)


def target():
    return next((w for w in windows() if w["wmClass"] == TARGET_CLASS), None)


def warning_ready():
    w = warning()
    return w if w and w["focused"] and w["above"] else None


class Run:
    def __init__(self, args):
        self.args = args
        self.dir = os.path.join(WORK, "runs", time.strftime("%Y%m%d-%H%M%S"))
        self.data = os.path.join(self.dir, "data")
        os.makedirs(self.dir, exist_ok=True)
        self.agent = None
        self.target = None
        self.shot_no = 0

    def shot(self, name):
        self.shot_no += 1
        path = os.path.join(self.dir, f"{self.shot_no:02d}-{name}.png")
        try:
            probe.call("screenshot", path=path)
        except Exception as e:  # a screenshot is evidence, not a check
            print(f"(screenshot failed: {e})")
        return path

    def db(self, sql, args=()):
        return agentctl.query(self.data, sql, args)

    def last_event(self):
        rows = self.db("SELECT object, decision, allow_minutes, level, lock_seconds, shown_at FROM intercept_events"
                       " ORDER BY shown_at DESC LIMIT 1")
        return rows[0] if rows else None

    def event_count(self):
        return self.db("SELECT COUNT(*) FROM intercept_events")[0][0]

    def shell_log(self):
        with open(os.path.join(WORK, "shell.log"), encoding="utf-8", errors="replace") as f:
            return f.read()

    def start_agent(self):
        self.agent = agentctl.start(self.args.agent, self.data, os.path.join(self.dir, "agent.log"))

    def stop_agent(self):
        if self.agent and self.agent.poll() is None:
            self.agent.send_signal(signal.SIGTERM)
            try:
                self.agent.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.agent.kill()
        self.agent = None

    def layout_ok(self, timeout=8):
        """Seconds until the Thoát button is painted where the clicks expect it (teal pixels), or None."""
        try:
            from PIL import Image
        except ImportError:
            time.sleep(2)
            return 2.0
        start = time.time()
        while time.time() - start < timeout:
            path = os.path.join(self.dir, "layout-probe.png")
            probe.call("screenshot", path=path)
            r, g, b = Image.open(path).convert("RGB").getpixel((THOAT[0], THOAT[1] - 16))
            if g > 140 and b > 120 and r < 140:
                return time.time() - start
            time.sleep(0.1)
        self.shot("layout-wrong")
        return None

    # ---- the flow ----

    def run(self):
        agentctl.seed(self.data, {TARGET_EXE: "entertainment"})
        self.target = agentctl.start_program([TARGET_EXE], os.path.join(self.dir, "target.log"))
        t = wait_for(lambda: (w := target()) and w["focused"] and w, 10)
        need("target program comes to the front", t)
        log_mark = len(self.shell_log())

        # 1. Agent starts while the tagged program is already in front.
        self.start_agent()
        connected = wait_for(lambda: "DopaDam: connected" in self.shell_log()[log_mark:], 15, 0.3)
        check("extension connects to the agent", connected)
        w = wait_for(warning_ready, 10)
        if not w:
            self.shot("no-warning")
        need("warning shows for the program already in front, focused and above", w, str(w))
        check("warning covers the monitor", w["fullscreen"] or w["rect"]["width"] >= 1280, str(w["rect"]))
        painted = self.layout_ok()
        need("warning is painted with the layout the clicks expect", painted is not None,
             f"{painted:.1f} s after the window was up" if painted is not None else "")
        check("warning is painted within 1 s", painted is not None and painted <= 1.0, f"{painted:.1f} s")
        ev = self.last_event()
        check("event recorded for the program", ev and ev[0] == TARGET_EXE and ev[1] is None, str(ev))

        # 2. Vào is locked during the countdown.
        probe.call("click", x=VAO[0], y=VAO[1])
        time.sleep(0.6)
        self.shot("locked-vao-clicked")
        ev = self.last_event()
        check("Vào does nothing while locked", warning() and ev[1] is None and not self.db("SELECT * FROM allow_windows"),
              str(ev))

        # 3. Enter = Thoát: warning gone, program minimised.
        probe.call("key", keys=["Return"])
        gone = wait_for(lambda: warning() is None, 5)
        t = target()
        self.shot("after-enter")
        need("Enter closes the warning", gone)
        check("Thoát minimises the program", t and t["minimized"], str(t))
        check("decision recorded as exit", self.last_event()[1] == "exit", str(self.last_event()))

        # 4. Bring it back (at a normal pace: see step 10 for a quick return): Esc also means Thoát.
        time.sleep(2)
        probe.call("activate", id=t["id"])
        w = wait_for(warning_ready, 8)
        need("warning shows again when the program is brought back", w)
        probe.call("key", keys=["Escape"])
        need("Esc closes the warning", wait_for(lambda: warning() is None, 5))
        t = target()
        check("Esc minimises the program", t and t["minimized"], str(t))

        # 5. Vào after the countdown lets the program through.
        time.sleep(2)
        probe.call("activate", id=t["id"])
        w = wait_for(warning_ready, 8)
        need("warning shows for the third time", w)
        ev = self.last_event()
        self.shot("countdown-start")
        time.sleep(1.5)
        self.shot("countdown-running")
        wait_s = ev[4] - (time.time() * 1000 - ev[5]) / 1000 + 0.8
        time.sleep(max(0, wait_s))
        probe.call("click", x=VAO[0], y=VAO[1])
        time.sleep(0.8)
        self.shot("vao-options")
        probe.call("click", x=FIVE_MINUTES[0], y=FIVE_MINUTES[1])
        gone = wait_for(lambda: warning() is None, 5)
        t = wait_for(lambda: (w := target()) and w["focused"] and w, 5)
        self.shot("after-vao")
        need("Vào + 5 phút closes the warning", gone)
        check("the program is in front and usable after Vào", t, str(target()))
        ev = self.last_event()
        check("decision recorded as enter, 5 minutes", ev[1] == "enter" and ev[2] == 5, str(ev))
        check("allow window recorded", self.db("SELECT object FROM allow_windows") == [(TARGET_EXE,)])
        time.sleep(2)
        check("no warning while the allow window runs", warning() is None)

        if not self.args.quick:
            # 6. "Còn 1 phút" notice, then the warning when the allow window ends.
            db = sqlite3.connect(os.path.join(self.data, "dopadam.db"), timeout=5)
            db.execute("UPDATE allow_windows SET expires_at = ?", (int(time.time() * 1000) + 63_000,))
            db.commit()
            db.close()
            n = wait_for(lambda: next((w for w in windows() if w["title"] == NOTICE_TITLE), None), 10, 0.3)
            self.shot("one-minute-notice")
            check("'Còn 1 phút' notice shows", n, str(n))
            if n:
                time.sleep(1.0)  # Mutter focuses a new window; the extension gives the focus back
                n = next((w for w in windows() if w["title"] == NOTICE_TITLE), None) or n
                t = target()
                self.shot("one-minute-notice-settled")
                r = n["rect"]
                check("the notice does not take the keyboard focus", not n["focused"], str(n))
                check("the program the user is typing in keeps the focus", t and t["focused"], str(t))
                check("the notice sits in the top-right corner, above", n["above"] and r["y"] <= 64
                      and 1280 - (r["x"] + r["width"]) <= 48 and r["x"] > 640, str(r))
            w = wait_for(warning_ready, 75, 0.5)
            need("warning returns when the allow window ends", w)
        else:
            probe.call("activate", id=target()["id"])
            db = sqlite3.connect(os.path.join(self.data, "dopadam.db"), timeout=5)
            db.execute("DELETE FROM allow_windows")
            db.commit()
            db.close()
            w = wait_for(warning_ready, 8)
            need("warning returns once the allow window is gone", w)

        # 7. Làm việc khác.
        probe.call("click", x=ALTERNATIVE_LINK[0], y=ALTERNATIVE_LINK[1])
        time.sleep(0.6)
        probe.call("click", x=FIRST_ACTIVITY[0], y=FIRST_ACTIVITY[1])
        time.sleep(0.3)
        self.shot("alternative")
        probe.call("click", x=START_ACTIVITY[0], y=START_ACTIVITY[1])
        gone = wait_for(lambda: warning() is None, 5)
        t = target()
        need("'Làm việc khác' closes the warning", gone)
        check("'Làm việc khác' minimises the program", t and t["minimized"], str(t))
        check("decision recorded as alternative", self.last_event()[1] == "alternative", str(self.last_event()))

        # 8. The agent restarts while the Shell keeps running: the extension reconnects.
        self.stop_agent()
        mark = len(self.shell_log())
        wait_for(lambda: "DopaDam: disconnected" in self.shell_log()[mark:], 5)
        mark = len(self.shell_log())
        started = time.time()
        self.start_agent()
        ok = wait_for(lambda: "DopaDam: connected" in self.shell_log()[mark:], 12, 0.2)
        check("extension reconnects after an agent restart (<= 7 s)", ok and time.time() - started <= 7,
              f"{time.time() - started:.1f} s")

        # 9. Re-opening the program right after Thoát (within the agent's 1.5 s exit grace).
        time.sleep(2)
        probe.call("activate", id=target()["id"])
        need("warning shows after the restart", wait_for(warning_ready, 8))
        probe.call("key", keys=["Escape"])
        need("Esc closes the warning", wait_for(lambda: warning() is None, 5))
        time.sleep(0.5)
        probe.call("activate", id=target()["id"])
        w = wait_for(warning_ready, 6)
        self.shot("quick-reopen")
        check("re-opening the program 0.5 s after Thoát still warns", w, "" if w else str(target()))
        if not w:
            # Any later focus change brings the warning; get one for the next step.
            probe.call("minimize", id=target()["id"])
            time.sleep(1)
            probe.call("activate", id=target()["id"])
            need("warning shows after another focus change", wait_for(warning_ready, 8))

        # 10. The warned program is closed while the warning is up.
        before = self.event_count()
        probe.call("close", id=target()["id"])
        if self.target:
            try:
                self.target.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        time.sleep(4)
        self.shot("program-closed")
        extra = self.event_count() - before
        check("closing the warned program removes the warning", warning() is None)
        check("closing the warned program records no new warnings", extra == 0, f"{extra} new events in 4 s")

    def cleanup(self):
        self.stop_agent()
        if self.target and self.target.poll() is None:
            self.target.terminate()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--agent", default=os.environ.get("DOPADAM_AGENT_BIN"), help="agent binary (or DOPADAM_AGENT_BIN)")
    ap.add_argument("--quick", action="store_true", help="skip the ~70 s allow-window expiry and notice check")
    ap.add_argument("--reuse-session", action="store_true", help="use a session already started with session.sh")
    ap.add_argument("--keep-session", action="store_true", help="leave the Shell running afterwards")
    args = ap.parse_args()
    if not args.agent or not os.access(args.agent, os.X_OK):
        ap.error("pass the agent binary with --agent or DOPADAM_AGENT_BIN")
    args.agent = os.path.abspath(args.agent)

    if not args.reuse_session:
        if subprocess.run([SESSION, "status"], capture_output=True).returncode == 0:
            print("a session is already running; stop it or pass --reuse-session", file=sys.stderr)
            return 1
        if subprocess.run([SESSION, "start"], capture_output=True).returncode != 0:
            print("could not start the private GNOME Shell (see shell.log)", file=sys.stderr)
            return 1
    run = Run(args)
    try:
        run.run()
    except Stop as e:
        print(f"stopped: the rest of the flow depends on '{e}'")
    except Exception as e:
        check("run finished without an exception", False, repr(e))
    finally:
        run.cleanup()
        if not args.reuse_session and not args.keep_session:
            subprocess.run([SESSION, "stop"])
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed; screenshots and logs in {run.dir}")
    return 1 if failed or not results else 0


if __name__ == "__main__":
    sys.exit(main())
