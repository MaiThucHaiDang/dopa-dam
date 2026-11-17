// Pure protocol logic for the DopaDam shell extension.
// No gi:// or resource:// imports here, so Node can unit-test it.

export const PROTOCOL_VERSION = 1;
export const MAX_LINE_BYTES = 64 * 1024;

export function encode(obj) {
    return JSON.stringify(obj) + '\n';
}

export function helloMessage(shellVersion) {
    return {type: 'shell_hello', protocol: PROTOCOL_VERSION, shellVersion: String(shellVersion ?? '')};
}

export function idleMessage(seconds) {
    const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return {type: 'idle', seconds: s};
}

export function emptyFocusMessage() {
    return {type: 'focus', windowId: 0, pid: 0, wmClass: null, appId: null, fullscreen: false, monitor: null};
}

// Build a focus message from plain values. Deliberately has no title field:
// window titles must never leave the Shell.
export function focusMessage(info) {
    if (!info)
        return emptyFocusMessage();
    const m = info.monitor;
    return {
        type: 'focus',
        windowId: Math.trunc(Number(info.windowId)) || 0,
        pid: Math.trunc(Number(info.pid)) || 0,
        wmClass: typeof info.wmClass === 'string' ? info.wmClass : null,
        appId: typeof info.appId === 'string' ? info.appId : null,
        fullscreen: info.fullscreen === true,
        monitor: m ? {x: Math.trunc(m.x), y: Math.trunc(m.y), width: Math.trunc(m.width), height: Math.trunc(m.height)} : null,
    };
}

// Remembers the last focus message and says whether a new one differs.
export class FocusDeduper {
    constructor() { this._last = null; }
    reset() { this._last = null; }
    shouldSend(msg) {
        const key = JSON.stringify(msg);
        if (key === this._last)
            return false;
        this._last = key;
        return true;
    }
}

// Splits a byte/text stream into lines; keeps the partial tail between pushes.
// A line longer than maxLen is discarded (to bound memory).
export class LineBuffer {
    constructor(maxLen = MAX_LINE_BYTES) {
        this._buf = '';
        this._max = maxLen;
        this._skipping = false;
    }
    push(text) {
        const out = [];
        let data = this._buf + text;
        let idx;
        while ((idx = data.indexOf('\n')) !== -1) {
            const line = data.slice(0, idx);
            data = data.slice(idx + 1);
            if (this._skipping)
                this._skipping = false;
            else if (line.length <= this._max && line.trim() !== '')
                out.push(line);
        }
        if (data.length > this._max) {
            data = '';
            this._skipping = true;
        }
        this._buf = data;
        return out;
    }
}

// Splits a stream of UTF-8 bytes into lines. GJS's TextDecoder has no {stream: true}, so the
// bytes are cut after the last newline byte (never part of a multi-byte sequence) and only whole
// lines are decoded; the tail waits for the next chunk. A tail longer than maxLen is dropped up
// to the next newline (to bound memory).
export class Utf8LineReader {
    constructor(maxLen = MAX_LINE_BYTES) {
        this._max = maxLen;
        this._lines = new LineBuffer(maxLen);
        this._decoder = new TextDecoder('utf-8');
        this._rest = new Uint8Array(0);
        this._skipping = false;
    }
    push(bytes) {
        let data = bytes;
        if (this._rest.length > 0) {
            data = new Uint8Array(this._rest.length + bytes.length);
            data.set(this._rest);
            data.set(bytes, this._rest.length);
        }
        this._rest = new Uint8Array(0);
        if (this._skipping) {
            const nl = data.indexOf(10);
            if (nl === -1)
                return [];
            this._skipping = false;
            data = data.subarray(nl + 1);
        }
        const cut = data.lastIndexOf(10);
        const tail = data.subarray(cut + 1);
        if (tail.length > this._max)
            this._skipping = true;
        else
            this._rest = tail.slice();
        return cut === -1 ? [] : this._lines.push(this._decoder.decode(data.subarray(0, cut + 1)));
    }
}

const isInt = v =>typeof v === 'number' && Number.isSafeInteger(v);

// Parse and validate one incoming line. Returns a command object or null
// (malformed JSON, unknown type, bad fields).
export function parseCommand(line) {
    let o;
    try {
        o = JSON.parse(line);
    } catch (_e) {
        return null;
    }
    if (o === null || typeof o !== 'object' || Array.isArray(o))
        return null;
    switch (o.type) {
    case 'shell_minimize':
    case 'shell_activate':
        return isInt(o.windowId) && o.windowId > 0 ? {type: o.type, windowId: o.windowId} : null;
    case 'shell_raise':
        if (!isInt(o.pid) || o.pid <= 0 || typeof o.title !== 'string')
            return null;
        return {
            type: 'shell_raise',
            pid: o.pid,
            title: o.title,
            above: o.above === true,
            activate: o.activate === true,
        };
    default:
        return null;
    }
}

// ---- Passive notice windows (shell_raise with activate: false) ----

export const NOTICE_MARGIN = 16;
export const NOTICE_GRACE_MS = 1500;

// Top-right corner of a work area ({x, y, width, height}) for a window of the given size, `margin`
// pixels from the edges. A window wider or taller than the area is pinned to its top-left corner.
export function cornerPosition(area, width, height, margin = NOTICE_MARGIN) {
    return {
        x: Math.trunc(Math.max(area.x, area.x + area.width - width - margin)),
        y: Math.trunc(Math.max(area.y, area.y + margin)),
    };
}

// Gives the keyboard focus back to the window that had it before a notice was mapped. Mutter
// focuses every new window, but a notice must not interrupt typing. Only focus that the notice
// takes within `graceMs` of being raised is handed back: a click on the notice later is a choice.
// Windows are plain ids here; 0 means "nothing focused".
export class NoticeFocus {
    constructor(graceMs = NOTICE_GRACE_MS) {
        this._grace = graceMs;
        this._notices = new Map(); // window id -> time until which taking focus is undone
        this._prev = 0;
        this._cur = 0;
    }
    // Call on every focus change. Returns the id that should get the focus back, or null.
    onFocus(id, now) {
        if (id === this._cur)
            return null;
        this._prev = this._cur;
        this._cur = id;
        return this._taken(id, now);
    }
    // The window `id` is a notice that was just raised. Returns the id to give the focus back to
    // when the notice already has it.
    markNotice(id, now) {
        this._notices.set(id, now + this._grace);
        return this._cur === id ? this._taken(id, now) : null;
    }
    forget(id) {
        this._notices.delete(id);
        if (this._cur === id) this._cur = 0;
        if (this._prev === id) this._prev = 0;
    }
    isNotice(id) { return this._notices.has(id); }
    withinGrace(id, now) {
        const until = this._notices.get(id);
        return until !== undefined && now <= until;
    }
    _taken(id, now) {
        if (!this.withinGrace(id, now) || !this._prev || this._prev === id || this._notices.has(this._prev))
            return null;
        return this._prev;
    }
}
