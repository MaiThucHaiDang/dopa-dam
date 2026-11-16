#!/usr/bin/env bash
# Runs inside `dbus-run-session` (started by session.sh): configures the private session's
# settings, starts the headless Shell and writes the environment other programs need to join.
set -u

exts="$(python3 -c 'import sys; print(repr([e for e in sys.argv[1].split(",") if e]))' "$E2E_EXTENSIONS")"
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "$exts"
gsettings set org.gnome.shell welcome-dialog-last-shown-version "'999'"
gsettings set org.gnome.desktop.interface enable-animations false
# The virtual pointer starts at (0, 0): with the hot corner on, its first move opens the Overview.
gsettings set org.gnome.desktop.interface enable-hot-corners false
gsettings set org.gnome.shell start-in-overview false 2>/dev/null || true

args=(--headless --virtual-monitor "$E2E_SIZE" --wayland-display "$E2E_DISPLAY")
[[ "$E2E_X11" == "1" ]] || args+=(--no-x11)
gnome-shell "${args[@]}" &
pid=$!
{
    echo "DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS"
    echo "WAYLAND_DISPLAY=$E2E_DISPLAY"
    echo "HOME=$HOME"
    echo "XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR"
    echo "SHELL_PID=$pid"
} >"$E2E_ENVFILE.tmp"
mv "$E2E_ENVFILE.tmp" "$E2E_ENVFILE"
wait "$pid"
echo "inner: gnome-shell exited with $?"
