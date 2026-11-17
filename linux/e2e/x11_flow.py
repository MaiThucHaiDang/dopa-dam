#!/usr/bin/env python3
"""End-to-end run of the agent's X11 path (no GNOME Shell extension) in the private Shell with Xwayland.

    x11_flow.py --agent /path/to/dopadam

The DopaDam extension stays disabled (only the probe is enabled), so the agent falls back to its X11
focus source and activates its own warning window itself. Calculator and the agent run as X11
clients. Checks that the warning is focused (so that Enter / Esc reach it) every time it shows, not
only the first time. Exit status 0 when every check passed.
"""
import argparse
import os
import subprocess
import sys
import time

import agentctl
import core_flow as cf
import probe


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--agent", default=os.environ.get("DOPADAM_AGENT_BIN"))
    args = ap.parse_args()
    if not args.agent or not os.access(args.agent, os.X_OK):
        ap.error("pass the agent binary with --agent or DOPADAM_AGENT_BIN")
    if subprocess.run([cf.SESSION, "status"], capture_output=True).returncode == 0:
        print("a session is already running; stop it first", file=sys.stderr)
        return 1
    os.environ["DOPADAM_E2E_EXTENSIONS"] = "probe@dopadam-e2e"
    if subprocess.run([cf.SESSION, "start", "--x11"], capture_output=True).returncode != 0:
        print("could not start the private GNOME Shell", file=sys.stderr)
        return 1
    run_dir = os.path.join(cf.WORK, "runs", time.strftime("x11-%Y%m%d-%H%M%S"))
    data = os.path.join(run_dir, "data")
    os.makedirs(run_dir, exist_ok=True)
    procs = []
    try:
        time.sleep(3)
        env = {"GDK_BACKEND": "x11", "DISPLAY": probe.call("eval", code='GLib.getenv("DISPLAY")')["value"]}
        xauth = probe.call("eval", code='GLib.getenv("XAUTHORITY")').get("value")
        if xauth:
            env["XAUTHORITY"] = xauth
        agentctl.seed(data, {cf.TARGET_EXE: "entertainment"})
        procs.append(agentctl.start_program(
            ["env", *[f"{k}={v}" for k, v in env.items()], "gnome-calculator"], os.path.join(run_dir, "target.log")))

        def calc():
            return next((w for w in cf.windows() if w["wmClass"].lower().endswith("calculator")), None)

        cf.need("target program comes to the front", cf.wait_for(lambda: (w := calc()) and w["focused"] and w, 10))
        procs.append(agentctl.start(args.agent, data, os.path.join(run_dir, "agent.log"), extra_env=env))
        for n, key in enumerate(["Return", "Escape", "Return"], start=1):
            w = cf.wait_for(cf.warning_ready, 8)
            time.sleep(1.0)  # let the page paint before the key
            probe.call("screenshot", path=os.path.join(run_dir, f"warning-{n}.png"))
            cf.check(f"warning #{n} is up, above and focused", w, str(cf.warning()))
            probe.call("key", keys=[key])
            gone = cf.wait_for(lambda: cf.warning() is None, 5)
            cf.check(f"{key} closes warning #{n}", gone)
            c = calc()
            cf.check(f"{key} minimises the program (#{n})", c and c["minimized"], str(c))
            if not gone or not c:
                break
            time.sleep(2.5)
            probe.call("activate", id=c["id"])
    except cf.Stop as e:
        print(f"stopped: the rest depends on '{e}'")
    finally:
        for p in procs:
            if p.poll() is None:
                p.terminate()
        subprocess.run([cf.SESSION, "stop"])
    failed = [r for r in cf.results if not r[1]]
    print(f"\n{len(cf.results) - len(failed)}/{len(cf.results)} checks passed; logs in {run_dir}")
    return 1 if failed or not cf.results else 0


if __name__ == "__main__":
    sys.exit(main())
