import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {PACKAGE_VERSION} from 'resource:///org/gnome/shell/misc/config.js';

import * as P from './protocol.js';

const RETRY_SECONDS = 5;
const IDLE_SECONDS = 30;
const RAISE_TOTAL_MS = 2000;
const RAISE_POLL_MS = 100;

export default class DopaDamExtension extends Extension {
    enable() {
        this._enabled = true;
        this._conn = null;
        this._input = null;
        this._output = null;
        this._cancellable = null;
        this._generation = 0;
        this._writeQueue = [];
        this._writing = false;
        this._state = null; // 'connected' | 'disconnected', to log only on change
        this._retryId = 0;
        this._idleId = 0;
        this._focusWindow = null;
        this._focusSignals = [];
        this._displaySignals = [];
        this._pendingRaise = [];
        this._deduper = new P.FocusDeduper();
        this._reader = new P.Utf8LineReader();
        this._noticeFocus = new P.NoticeFocus();
        this._noticeSignals = new Map(); // window id -> {window, ids}

        this._safe(() => {
            this._tracker = Shell.WindowTracker.get_default();
            const d = global.display;
            this._displaySignals.push(d.connect('notify::focus-window', () => this._safe(() => this._onFocusChanged())));
            this._displaySignals.push(d.connect('window-created', (_d, w) => this._safe(() => this._tryPendingRaises(w))));
            // Watch the window that already has focus (its full-screen changes); nothing is sent before connecting.
            this._onFocusChanged();
        });
        this._connect();
    }

    disable() {
        this._enabled = false;
        this._safe(() => {
            for (const id of this._displaySignals)
                global.display.disconnect(id);
        });
        this._displaySignals = [];
        this._clearFocusWindow();
        if (this._retryId) GLib.source_remove(this._retryId);
        if (this._idleId) GLib.source_remove(this._idleId);
        this._retryId = 0;
        this._idleId = 0;
        for (const p of this._pendingRaise)
            if (p.timerId) GLib.source_remove(p.timerId);
        this._pendingRaise = [];
        for (const id of [...this._noticeSignals.keys()])
            this._forgetNotice(id);
        this._noticeFocus = null;
        this._noticeSignals = null;
        this._closeConnection();
        this._tracker = null;
        this._deduper = null;
        this._reader = null;
    }

    // Run fn and swallow any exception: nothing may escape into the Shell.
    _safe(fn) {
        try {
            return fn();
        } catch (e) {
            try {
                console.error(`DopaDam: ${e}`);
            } catch (_e) { /* ignore */ }
            return undefined;
        }
    }

    _setState(s, detail) {
        if (this._state === s)
            return;
        this._state = s;
        console.log(`DopaDam: ${s}${detail ? ` (${detail})` : ''}`);
    }

    // ---- connection ----

    _socketPath() {
        const dir = GLib.getenv('XDG_RUNTIME_DIR');
        return dir ? GLib.build_filenamev([dir, 'dopadam-agent.sock']) : null;
    }

    _scheduleRetry() {
        if (!this._enabled || this._retryId)
            return;
        this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RETRY_SECONDS, () => {
            this._retryId = 0;
            this._safe(() => this._connect());
            return GLib.SOURCE_REMOVE;
        });
    }

    _connect() {
        if (!this._enabled || this._conn)
            return;
        const path = this._socketPath();
        if (!path || !GLib.file_test(path, GLib.FileTest.EXISTS)) {
            this._setState('disconnected', 'no agent socket');
            this._scheduleRetry();
            return;
        }
        const gen = ++this._generation;
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        const client = new Gio.SocketClient();
        const addr = Gio.UnixSocketAddress.new(path);
        client.connect_async(addr, cancellable, (_c, res) => this._safe(() => {
            let conn;
            try {
                conn = client.connect_finish(res);
            } catch (e) {
                if (gen === this._generation && this._enabled) {
                    this._setState('disconnected', e.message);
                    this._scheduleRetry();
                }
                return;
            }
            if (gen !== this._generation || !this._enabled) {
                try { conn.close(null); } catch (_e) { /* ignore */ }
                return;
            }
            this._onConnected(conn, cancellable, gen);
        }));
    }

    _onConnected(conn, cancellable, gen) {
        this._conn = conn;
        this._input = conn.get_input_stream();
        this._output = conn.get_output_stream();
        this._writeQueue = [];
        this._writing = false;
        this._reader = new P.Utf8LineReader();
        this._deduper.reset();
        this._setState('connected');

        this._send(P.helloMessage(PACKAGE_VERSION));
        this._sendFocus(true);
        this._idleId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, IDLE_SECONDS, () => {
            this._safe(() => this._sendIdle());
            return GLib.SOURCE_CONTINUE;
        });
        this._readMore(cancellable, gen);
    }

    _readMore(cancellable, gen) {
        this._input.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, cancellable, (stream, res) => this._safe(() => {
            if (gen !== this._generation || !this._enabled)
                return;
            let bytes;
            try {
                bytes = stream.read_bytes_finish(res);
            } catch (e) {
                this._onDisconnected(e.message);
                return;
            }
            if (bytes.get_size() === 0) {
                this._onDisconnected('closed by agent');
                return;
            }
            for (const line of this._reader.push(bytes.toArray()))
                this._safe(() => this._handleLine(line));
            this._readMore(cancellable, gen);
        }));
    }

    _onDisconnected(detail) {
        this._closeConnection();
        this._setState('disconnected', detail);
        this._scheduleRetry();
    }

    _closeConnection() {
        this._generation++;
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._conn) {
            try { this._conn.close(null); } catch (_e) { /* ignore */ }
        }
        this._conn = null;
        this._input = null;
        this._output = null;
        this._writeQueue = [];
        this._writing = false;
    }

    // ---- writing (queued, never blocks) ----

    _send(obj) {
        if (!this._output)
            return;
        this._writeQueue.push(new TextEncoder().encode(P.encode(obj)));
        this._pump();
    }

    _pump() {
        if (this._writing || !this._output || this._writeQueue.length === 0)
            return;
        this._writing = true;
        const data = this._writeQueue.shift();
        const gen = this._generation;
        this._output.write_all_async(data, GLib.PRIORITY_DEFAULT, this._cancellable, (stream, res) => this._safe(() => {
            if (gen !== this._generation || !this._enabled)
                return;
            this._writing = false;
            try {
                stream.write_all_finish(res);
            } catch (e) {
                this._onDisconnected(e.message);
                return;
            }
            this._pump();
        }));
    }

    // ---- focus reporting ----

    _focusInfo(w) {
        if (!w)
            return null;
        let appId = null;
        const app = this._tracker?.get_window_app(w);
        if (app)
            appId = app.get_id();
        let monitor = null;
        const idx = w.get_monitor();
        if (idx >= 0)
            monitor = global.display.get_monitor_geometry(idx);
        return {
            windowId: w.get_id(),
            pid: w.get_pid(),
            wmClass: w.get_wm_class(),
            appId,
            fullscreen: w.is_fullscreen(),
            monitor,
        };
    }

    _sendFocus(force = false) {
        if (!this._output)
            return;
        const msg = P.focusMessage(this._focusInfo(global.display.focus_window));
        if (!force && !this._deduper.shouldSend(msg))
            return;
        if (force)
            this._deduper.shouldSend(msg);
        this._send(msg);
        this._sendIdle();
    }

    _sendIdle() {
        if (!this._output)
            return;
        const monitor = global.backend.get_core_idle_monitor();
        this._send(P.idleMessage(monitor.get_idletime() / 1000));
    }

    _clearFocusWindow() {
        const w = this._focusWindow;
        this._focusWindow = null;
        const ids = this._focusSignals;
        this._focusSignals = [];
        if (w) {
            for (const id of ids) {
                try { w.disconnect(id); } catch (_e) { /* ignore */ }
            }
        }
    }

    _onFocusChanged() {
        this._clearFocusWindow();
        const w = global.display.focus_window;
        this._safe(() => this._keepFocusFromNotice(w));
        if (w) {
            this._focusWindow = w;
            this._focusSignals.push(w.connect('notify::fullscreen', () => this._safe(() => this._sendFocus())));
            this._focusSignals.push(w.connect('unmanaged', () => this._safe(() => this._clearFocusWindow())));
        }
        this._sendFocus();
    }

    // ---- commands ----

    _findWindow(id) {
        for (const actor of global.get_window_actors()) {
            const w = actor.get_meta_window();
            if (w && w.get_id() === id)
                return w;
        }
        return null;
    }

    _activate(w) {
        // Main.activateWindow unminimizes, switches workspace and focuses.
        try {
            Main.activateWindow(w);
        } catch (_e) {
            w.unminimize();
            w.activate(global.get_current_time());
        }
    }

    _handleLine(line) {
        const cmd = P.parseCommand(line);
        if (!cmd)
            return;
        if (cmd.type === 'shell_minimize') {
            this._findWindow(cmd.windowId)?.minimize();
        } else if (cmd.type === 'shell_activate') {
            const w = this._findWindow(cmd.windowId);
            if (w) this._activate(w);
        } else if (cmd.type === 'shell_raise') {
            const req = {cmd, timerId: 0, elapsed: 0};
            if (this._applyRaise(req))
                return;
            this._pendingRaise.push(req);
            req.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RAISE_POLL_MS, () => {
                req.elapsed += RAISE_POLL_MS;
                const done = this._safe(() => this._applyRaise(req)) || req.elapsed >= RAISE_TOTAL_MS;
                if (done) {
                    req.timerId = 0;
                    this._dropRaise(req);
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _dropRaise(req) {
        this._pendingRaise = this._pendingRaise.filter(r => r !== req);
    }

    // Returns true when the request was satisfied.
    _applyRaise(req, only = null) {
        const {pid, title, above, activate} = req.cmd;
        let target = null;
        const match = w => w && w.get_pid() === pid && w.get_title() === title;
        if (only) {
            if (match(only)) target = only;
        } else {
            for (const actor of global.get_window_actors()) {
                const w = actor.get_meta_window();
                if (match(w)) { target = w; break; }
            }
        }
        if (!target)
            return false;
        if (above) target.make_above();
        else target.unmake_above();
        if (activate)
            this._activate(target);
        else
            this._settleNotice(target);
        return true;
    }

    // ---- passive notices (shell_raise with activate: false) ----
    // Mutter focuses every new window and places it in the middle. A notice must not interrupt
    // typing or cover the program: put it in the top-right corner of its monitor's work area and
    // give the focus back to the window that had it.

    _settleNotice(w) {
        const id = w.get_id();
        if (!this._noticeSignals.has(id)) {
            const ids = [
                w.connect('size-changed', () => this._safe(() => this._placeNotice(w))),
                w.connect('position-changed', () => this._safe(() => this._placeNotice(w))),
                w.connect('unmanaged', () => this._safe(() => this._forgetNotice(id))),
            ];
            this._noticeSignals.set(id, {window: w, ids});
        }
        const back = this._noticeFocus.markNotice(id, GLib.get_monotonic_time() / 1000);
        this._placeNotice(w);
        // Mutter places a new window when it is first mapped, after this request: keep putting the
        // notice in its corner while it is fresh (the signals above cover most, this the rest).
        const entry = this._noticeSignals.get(id);
        if (!entry.timerId) {
            entry.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RAISE_POLL_MS, () => {
                const live = this._safe(() => {
                    if (!this._enabled || !this._noticeSignals.has(id) ||
                        !this._noticeFocus.withinGrace(id, GLib.get_monotonic_time() / 1000)) {
                        return false;
                    }
                    this._placeNotice(w);
                    return true;
                });
                if (!live)
                    entry.timerId = 0;
                return live ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            });
        }
        if (back)
            this._giveFocusBack(back);
    }

    _placeNotice(w) {
        // Only while the notice is fresh: the user may move it afterwards.
        if (!this._noticeFocus.withinGrace(w.get_id(), GLib.get_monotonic_time() / 1000))
            return;
        const area = w.get_work_area_current_monitor();
        const rect = w.get_frame_rect();
        if (rect.width <= 0 || rect.height <= 0)
            return;
        const pos = P.cornerPosition(area, rect.width, rect.height);
        if (rect.x !== pos.x || rect.y !== pos.y)
            w.move_frame(true, pos.x, pos.y);
    }

    _forgetNotice(id) {
        const entry = this._noticeSignals?.get(id);
        if (entry) {
            for (const sid of entry.ids) {
                try { entry.window.disconnect(sid); } catch (_e) { /* ignore */ }
            }
            if (entry.timerId)
                GLib.source_remove(entry.timerId);
            this._noticeSignals.delete(id);
        }
        this._noticeFocus?.forget(id);
    }

    _keepFocusFromNotice(w) {
        const back = this._noticeFocus.onFocus(w ? w.get_id() : 0, GLib.get_monotonic_time() / 1000);
        if (back)
            this._giveFocusBack(back);
    }

    _giveFocusBack(id) {
        const prev = this._findWindow(id);
        if (!prev || prev.minimized)
            return;
        // Not from inside the focus signal: let Mutter finish mapping the notice first.
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._safe(() => {
                if (this._enabled)
                    prev.activate(global.get_current_time());
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _tryPendingRaises(w) {
        // The title may not be set yet at window-created; the poll timer covers that.
        for (const req of [...this._pendingRaise]) {
            if (this._applyRaise(req, w)) {
                if (req.timerId) GLib.source_remove(req.timerId);
                req.timerId = 0;
                this._dropRaise(req);
            }
        }
    }
}
