#!/usr/bin/env bash
# Private headless GNOME Shell for end-to-end tests. It never touches the user's own session:
# its own HOME, D-Bus session bus, runtime directory and Wayland display name.
#
#   session.sh start [--x11]   start the Shell in the background (with --x11: Xwayland enabled)
#   session.sh exec CMD...     run CMD inside the private session's environment
#   session.sh stop            stop the Shell and every process started inside the session
#   session.sh status          print the session environment, or exit 1 when it is not running
#
# Environment:
#   DOPADAM_E2E_DIR         work folder (private HOME, Shell log); default <repo>/.toolchain/e2e-run
#   DOPADAM_E2E_EXTENSIONS  comma-separated extensions to enable; default dopadam@dang,probe@dopadam-e2e
#   DOPADAM_E2E_SIZE        virtual monitor size; default 1280x800
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
work="${DOPADAM_E2E_DIR:-$repo/.toolchain/e2e-run}"
# Unix socket paths are limited to ~108 bytes, so the runtime dir has to be short.
rt="/run/user/$(id -u)/dopadam-e2e"
display="dd-e2e"
home="$work/home"
envfile="$rt/session.env"

running() {
    [[ -f "$envfile" ]] || return 1
    local pid
    pid="$(sed -n 's/^SHELL_PID=//p' "$envfile")"
    [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# PIDs of this user's processes whose environment has the private runtime dir.
session_pids() {
    local f pid
    for f in /proc/[0-9]*/environ; do
        pid="${f#/proc/}"; pid="${pid%/environ}"
        [[ "$pid" == "$$" || "$pid" == "$PPID" || "$pid" == "$BASHPID" ]] && continue
        if grep -qxzF "XDG_RUNTIME_DIR=$rt" "$f" 2>/dev/null; then
            echo "$pid"
        fi
    done
}

cmd_start() {
    local x11=0
    [[ "${1:-}" == "--x11" ]] && x11=1
    if running; then
        echo "session already running" >&2
        exit 1
    fi
    mkdir -p "$rt" "$home"
    chmod 700 "$rt"
    local ext="$home/.local/share/gnome-shell/extensions"
    mkdir -p "$ext"
    rm -rf "${ext:?}/dopadam@dang" "${ext:?}/probe@dopadam-e2e"
    cp -r "$repo/linux/gnome-shell-extension/dopadam@dang" "$ext/"
    cp -r "$here/probe@dopadam-e2e" "$ext/"
    rm -f "$envfile" "$rt/dd-probe.sock"
    : >"$work/shell.log"
    setsid env -i PATH=/usr/bin:/bin HOME="$home" XDG_RUNTIME_DIR="$rt" LANG=C.UTF-8 \
        E2E_X11="$x11" E2E_DISPLAY="$display" E2E_ENVFILE="$envfile" E2E_SIZE="${DOPADAM_E2E_SIZE:-1280x800}" \
        E2E_EXTENSIONS="${DOPADAM_E2E_EXTENSIONS:-dopadam@dang,probe@dopadam-e2e}" \
        dbus-run-session -- bash "$here/inner.sh" >>"$work/shell.log" 2>&1 </dev/null &
    disown
    for _ in $(seq 1 150); do
        [[ -S "$rt/dd-probe.sock" ]] && break
        sleep 0.2
    done
    if [[ ! -S "$rt/dd-probe.sock" ]]; then
        echo "the probe did not come up; see $work/shell.log" >&2
        exit 1
    fi
    cat "$envfile"
}

cmd_exec() {
    running || { echo "session not running" >&2; exit 1; }
    local vars=()
    while IFS= read -r line; do
        [[ "$line" == SHELL_PID=* ]] || vars+=("$line")
    done <"$envfile"
    exec env -i PATH=/usr/bin:/bin LANG=C.UTF-8 XDG_CURRENT_DESKTOP=GNOME "${vars[@]}" "$@"
}

cmd_stop() {
    if [[ -f "$envfile" ]]; then
        local pid
        pid="$(sed -n 's/^SHELL_PID=//p' "$envfile")"
        [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    fi
    for _ in $(seq 1 25); do
        [[ -z "$(session_pids)" ]] && break
        sleep 0.2
    done
    local left
    left="$(session_pids)"
    if [[ -n "$left" ]]; then
        # shellcheck disable=SC2086
        kill $left 2>/dev/null || true
        sleep 1
        left="$(session_pids)"
        # shellcheck disable=SC2086
        [[ -n "$left" ]] && kill -9 $left 2>/dev/null || true
    fi
    rm -f "$envfile" "$rt/dd-probe.sock"
}

case "${1:-}" in
start) shift; cmd_start "$@" ;;
exec) shift; cmd_exec "$@" ;;
stop) cmd_stop ;;
status) running && cat "$envfile" ;;
*) sed -n '2,15p' "$0"; exit 2 ;;
esac
