// Test-only probe for the private headless GNOME Shell of linux/e2e.
// Listens on $XDG_RUNTIME_DIR/dd-probe.sock. Protocol: the client sends one JSON object on one
// line, the probe answers with one JSON line ({ok: true, ...} or {ok: false, error}) and closes.
// It must only ever be installed in the throw-away HOME that linux/e2e/session.sh creates.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SOCKET_NAME = 'dd-probe.sock';

function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

function now() {
    return GLib.get_monotonic_time();
}

export default class ProbeExtension extends Extension {
    enable() {
        this._path = GLib.build_filenamev([GLib.get_user_runtime_dir(), SOCKET_NAME]);
        try {
            Gio.File.new_for_path(this._path).delete(null);
        } catch (_e) { /* not there */ }
        this._service = new Gio.SocketService();
        this._service.add_address(Gio.UnixSocketAddress.new(this._path),
            Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT, null);
        this._service.connect('incoming', (_s, conn) => {
            this._serve(conn).catch(e => console.error(`probe: ${e}`));
            return true;
        });
        this._service.start();
        const seat = Clutter.get_default_backend().get_default_seat();
        this._kbd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._ptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        console.log('probe: listening');
    }

    disable() {
        this._service?.stop();
        this._service?.close();
        this._service = null;
        this._kbd = null;
        this._ptr = null;
        try {
            Gio.File.new_for_path(this._path).delete(null);
        } catch (_e) { /* ignore */ }
    }

    async _serve(conn) {
        const input = new Gio.DataInputStream({base_stream: conn.get_input_stream()});
        const line = await new Promise((resolve, reject) => {
            input.read_line_async(GLib.PRIORITY_DEFAULT, null, (s, res) => {
                try {
                    const [bytes] = s.read_line_finish_utf8(res);
                    resolve(bytes);
                } catch (e) {
                    reject(e);
                }
            });
        });
        let reply;
        try {
            const req = JSON.parse(line ?? '{}');
            reply = {ok: true, ...(await this._handle(req) ?? {})};
        } catch (e) {
            reply = {ok: false, error: String(e)};
        }
        const data = new TextEncoder().encode(`${JSON.stringify(reply)}\n`);
        await new Promise(resolve => {
            conn.get_output_stream().write_all_async(data, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                try {
                    s.write_all_finish(res);
                } catch (_e) { /* client gone */ }
                resolve();
            });
        });
        conn.close(null);
    }

    _windows() {
        const actors = global.get_window_actors();
        const metas = actors.map(a => a.get_meta_window()).filter(w => w);
        const stacked = global.display.sort_windows_by_stacking(metas);
        const focus = global.display.focus_window;
        const tracker = Shell.WindowTracker.get_default();
        return stacked.map((w, i) => {
            const r = w.get_frame_rect();
            return {
                id: w.get_id(),
                title: w.get_title(),
                pid: w.get_pid(),
                wmClass: w.get_wm_class(),
                appId: tracker.get_window_app(w)?.get_id() ?? null,
                focused: w === focus,
                minimized: w.minimized,
                above: w.is_above(),
                fullscreen: w.is_fullscreen(),
                hidden: w.is_hidden(),
                stack: i, // 0 = bottom
                rect: {x: r.x, y: r.y, width: r.width, height: r.height},
            };
        });
    }

    _find(id) {
        for (const a of global.get_window_actors()) {
            const w = a.get_meta_window();
            if (w && w.get_id() === id)
                return w;
        }
        throw new Error(`no window ${id}`);
    }

    _keyval(name) {
        const v = Clutter[`KEY_${name}`];
        if (typeof v !== 'number')
            throw new Error(`unknown key ${name}`);
        return v;
    }

    async _handle(req) {
        switch (req.cmd) {
        case 'ping':
            return {shellVersion: (await import('resource:///org/gnome/shell/misc/config.js')).PACKAGE_VERSION};
        case 'windows':
            return {windows: this._windows(), overview: Main.overview.visible};
        case 'overview':
            if (req.show)
                Main.overview.show();
            else
                Main.overview.hide();
            return {};
        case 'activate':
            Main.activateWindow(this._find(req.id));
            return {};
        case 'minimize':
            this._find(req.id).minimize();
            return {};
        case 'close':
            this._find(req.id).delete(global.get_current_time());
            return {};
        case 'fullscreen': {
            const w = this._find(req.id);
            if (req.on)
                w.make_fullscreen();
            else
                w.unmake_fullscreen();
            return {};
        }
        case 'screenshot': {
            const file = Gio.File.new_for_path(req.path);
            const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
            const shooter = new Shell.Screenshot();
            await new Promise((resolve, reject) => {
                shooter.screenshot(false, stream, (s, res) => {
                    try {
                        s.screenshot_finish(res);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            stream.close(null);
            return {path: req.path};
        }
        case 'key': {
            // req.keys: list of key names (Clutter.KEY_<name>); pressed together, released in reverse.
            const vals = req.keys.map(k => this._keyval(k));
            for (const v of vals) {
                this._kbd.notify_keyval(now(), v, Clutter.KeyState.PRESSED);
                await sleep(30);
            }
            for (const v of vals.reverse()) {
                this._kbd.notify_keyval(now(), v, Clutter.KeyState.RELEASED);
                await sleep(30);
            }
            return {};
        }
        case 'move':
            this._ptr.notify_absolute_motion(now(), req.x, req.y);
            return {};
        case 'click': {
            this._ptr.notify_absolute_motion(now(), req.x, req.y);
            await sleep(150);
            const button = req.button ?? Clutter.BUTTON_PRIMARY;
            this._ptr.notify_button(now(), button, Clutter.ButtonState.PRESSED);
            await sleep(80);
            this._ptr.notify_button(now(), button, Clutter.ButtonState.RELEASED);
            return {};
        }
        case 'extension': {
            // req.action: 'info' | 'enable' | 'disable'
            const mgr = Main.extensionManager;
            if (req.action === 'enable')
                await mgr.enableExtension(req.uuid);
            else if (req.action === 'disable')
                await mgr.disableExtension(req.uuid);
            const ext = mgr.lookup(req.uuid);
            return {found: !!ext, state: ext?.state ?? null, error: ext?.error ? String(ext.error) : null};
        }
        case 'eval': {
            // Test-only escape hatch, reachable only through the private session's runtime dir.
            // eslint-disable-next-line no-new-func
            const fn = new Function('global', 'Main', 'GLib', `return (${req.code});`);
            return {value: JSON.parse(JSON.stringify(fn(global, Main, GLib) ?? null))};
        }
        default:
            throw new Error(`unknown cmd ${req.cmd}`);
        }
    }
}
