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

const isInt = v => typeof v === 'number' && Number.isSafeInteger(v);

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
