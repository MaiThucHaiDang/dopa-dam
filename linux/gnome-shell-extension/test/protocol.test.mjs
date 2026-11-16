import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../dopadam@dang/protocol.js';

test('encode ends with newline and hello shape', () => {
    const s = P.encode(P.helloMessage('50.1'));
    assert.ok(s.endsWith('\n'));
    assert.deepEqual(JSON.parse(s), {type: 'shell_hello', protocol: 1, shellVersion: '50.1'});
});

test('idle floors and clamps', () => {
    assert.deepEqual(P.idleMessage(12.9), {type: 'idle', seconds: 12});
    assert.equal(P.idleMessage(-3).seconds, 0);
    assert.equal(P.idleMessage(NaN).seconds, 0);
});

test('focus message never carries a title', () => {
    const m = P.focusMessage({windowId: 7, pid: 42, wmClass: 'Firefox', appId: 'firefox.desktop',
        fullscreen: true, title: 'secret', monitor: {x: 0, y: 0, width: 1920, height: 1080}});
    assert.ok(!('title' in m));
    assert.ok(!JSON.stringify(m).includes('secret'));
    assert.equal(m.fullscreen, true);
    assert.deepEqual(m.monitor, {x: 0, y: 0, width: 1920, height: 1080});
});

test('null focus gives the empty message', () => {
    assert.deepEqual(P.focusMessage(null), {type: 'focus', windowId: 0, pid: 0, wmClass: null,
        appId: null, fullscreen: false, monitor: null});
});

test('missing wmClass/appId become null', () => {
    const m = P.focusMessage({windowId: 1, pid: 2, wmClass: undefined, appId: undefined, monitor: null});
    assert.equal(m.wmClass, null);
    assert.equal(m.appId, null);
    assert.equal(m.fullscreen, false);
});

test('deduper drops identical consecutive focus only', () => {
    const d = new P.FocusDeduper();
    const a = P.focusMessage({windowId: 1, pid: 1});
    const b = P.focusMessage({windowId: 2, pid: 1});
    assert.equal(d.shouldSend(a), true);
    assert.equal(d.shouldSend(a), false);
    assert.equal(d.shouldSend(b), true);
    assert.equal(d.shouldSend(a), true);
    d.reset();
    assert.equal(d.shouldSend(a), true);
});

test('line buffer joins partial reads', () => {
    const b = new P.LineBuffer();
    assert.deepEqual(b.push('{"a":'), []);
    assert.deepEqual(b.push('1}\n{"b":2}\n{"c"'), ['{"a":1}', '{"b":2}']);
    assert.deepEqual(b.push(':3}\n'), ['{"c":3}']);
    assert.deepEqual(b.push('\n\n'), []);
});

test('line buffer discards oversized lines', () => {
    const b = new P.LineBuffer(10);
    assert.deepEqual(b.push('x'.repeat(30)), []);
    assert.deepEqual(b.push('yyy\nok\n'), ['ok']);
});

test('parseCommand accepts valid commands', () => {
    assert.deepEqual(P.parseCommand('{"type":"shell_minimize","windowId":5}'), {type: 'shell_minimize', windowId: 5});
    assert.deepEqual(P.parseCommand('{"type":"shell_activate","windowId":5}'), {type: 'shell_activate', windowId: 5});
    assert.deepEqual(P.parseCommand('{"type":"shell_raise","pid":9,"title":"Cảnh báo","above":true,"activate":false}'),
        {type: 'shell_raise', pid: 9, title: 'Cảnh báo', above: true, activate: false});
});

test('parseCommand rejects bad input', () => {
    for (const l of ['', 'not json', '[]', 'null', '{"type":"other"}', '{"type":"shell_minimize"}',
        '{"type":"shell_minimize","windowId":"5"}', '{"type":"shell_minimize","windowId":1.5}',
        '{"type":"shell_minimize","windowId":0}', '{"type":"shell_raise","pid":1}',
        '{"type":"shell_raise","pid":1,"title":3}'])
        assert.equal(P.parseCommand(l), null, l);
});

test('raise flags default to false', () => {
    const c = P.parseCommand('{"type":"shell_raise","pid":1,"title":"t"}');
    assert.equal(c.above, false);
    assert.equal(c.activate, false);
});
