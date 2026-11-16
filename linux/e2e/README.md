# End-to-end tests in a private GNOME Shell

These scripts run the DopaDam agent and its GNOME Shell extension (`linux/gnome-shell-extension/dopadam@dang`)
inside a **private, headless GNOME Shell**. It has its own HOME, D-Bus session bus, runtime directory
(`/run/user/<uid>/dopadam-e2e`) and Wayland display (`dd-e2e`), so the desktop you are logged in to is never touched:
no settings, extensions or sockets of the real session are read or written.

Needs: `gnome-shell` (45 or newer; tested with 50.1), `dbus-run-session`, `gsettings`, `python3`, `gnome-calculator`
as the program to block, and a built agent binary. `python3-pil` is optional (used to check the warning layout).

## Files

| File | What it does |
| --- | --- |
| `session.sh` | Starts / stops the private Shell. `start [--x11]`, `exec CMD…` (run a program inside the session), `stop` (kills the Shell and everything started in the session), `status`. |
| `inner.sh` | Runs inside `dbus-run-session`: sets the session's gsettings (enabled extensions, no animations, no hot corner) and starts `gnome-shell --headless --virtual-monitor 1280x800`. |
| `probe@dopadam-e2e/` | **Test-only** Shell extension, installed only in the private HOME. Answers on `$XDG_RUNTIME_DIR/dd-probe.sock`: window list (title, pid, class, focused, minimized, above, fullscreen, stacking), screenshots, key presses and pointer clicks through a Clutter virtual device, activate / minimize / close / full-screen a window, enable / disable an extension, and a JS `eval`. Never install it in a real session. |
| `probe.py` | Client for the probe, as a library or command: `./probe.py windows`, `./probe.py screenshot out.png`, `./probe.py key Escape`, `./probe.py click 343 539`, `./probe.py ext info dopadam@dang`. |
| `agentctl.py` | Seeds an agent data folder (the schema is read from `agent/src-tauri/src/db.rs`; programs are tagged by inserting `tag_rules` rows) and starts the agent or another program inside the session. |
| `core_flow.py` | The scripted run. Exit status 0 when every check passed, 1 otherwise. |

## Running the scripted flow

```sh
cd linux/e2e
./core_flow.py --agent /path/to/dopadam          # or: DOPADAM_AGENT_BIN=/path/to/dopadam ./core_flow.py
./core_flow.py --agent /path/to/dopadam --quick  # skips the ~70 s wait for the end of an allow window
```

It starts the Shell, opens Calculator, tags it as entertainment and starts the agent (`--hidden`, own data folder,
`DOPADAM_NO_AUTOSTART=1`, `DOPADAM_QUIET=1`), then checks: the extension connects; the warning appears over the program
that is already in front, focused, above and full screen; Vào stays locked during the countdown; Enter and Esc close the
warning and minimise the program; Vào + "5 phút" lets the program through and records the allow window; the "Còn 1 phút"
notice and the warning at the end of the allow window; "Làm việc khác"; the extension reconnects after the agent
restarts; re-opening the program 0.5 s after Thoát; closing the warned program while the warning is up. The Shell is
stopped at the end (`--keep-session` leaves it running, `--reuse-session` uses one started with `session.sh start`).

Screenshots, the agent's log and its data folder go to `<work>/runs/<timestamp>/`; the Shell's log is `<work>/shell.log`.
`<work>` is `$DOPADAM_E2E_DIR`, default `<repo>/.toolchain/e2e-run` (git-ignored).

The clicks use fixed positions on the 1280x800 virtual monitor. If the warning page changes its layout, the run stops
at "warning is painted with the layout the clicks expect"; measure the new positions from a screenshot and update the
constants at the top of `core_flow.py`.

## Exploring by hand

```sh
./session.sh start                     # prints the session environment
./session.sh exec gnome-calculator &   # any program started like this appears in the private Shell
./probe.py windows
./probe.py screenshot /tmp/shot.png    # then look at the picture
./session.sh stop
```

`session.sh start --x11` enables Xwayland (the display number is printed by
`./probe.py raw '{"cmd":"eval","code":"GLib.getenv(\"DISPLAY\")"}'`, the cookie by the same with `XAUTHORITY`); run
clients with `GDK_BACKEND=x11 DISPLAY=… XAUTHORITY=…`. Set `DOPADAM_E2E_EXTENSIONS=probe@dopadam-e2e` before `start` to
leave the DopaDam extension disabled, so the agent falls back to its X11 source.

Notes: the Shell caches extension code, so restart the session after editing the extension. The virtual pointer starts
at (0, 0); the session turns the hot corner off so the first move does not open the Overview.
