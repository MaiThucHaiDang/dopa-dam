#!/usr/bin/env node
// Plays the DopaDam agent for manual checks of the GNOME Shell extension.
// Prints every line received; stdin commands:
//   minimize <id> | activate <id> | raise <pid> <title...> [--above] [--activate]
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const dir = process.env.XDG_RUNTIME_DIR;
if (!dir) { console.error('XDG_RUNTIME_DIR chưa được đặt'); process.exit(1); }
const sock = path.join(dir, 'dopadam-agent.sock');
if (fs.existsSync(sock)) fs.unlinkSync(sock);

const clients = new Set();
const server = net.createServer(c => {
    clients.add(c);
    console.log('[kết nối mới]');
    let buf = '';
    c.setEncoding('utf8');
    c.on('data', d => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) !== -1) {
            console.log('<', buf.slice(0, i));
            buf = buf.slice(i + 1);
        }
    });
    c.on('error', () => {});
    c.on('close', () => { clients.delete(c); console.log('[ngắt kết nối]'); });
});
server.listen(sock, () => console.log(`Đang nghe tại ${sock}`));

function send(obj) {
    const line = JSON.stringify(obj) + '\n';
    for (const c of clients) c.write(line);
    console.log('>', line.trim());
}

const rl = readline.createInterface({input: process.stdin});
rl.on('line', l => {
    const m = l.trim().match(/^(\S+)\s*(.*)$/);
    if (!m) return;
    const [, cmd, rest] = m;
    if (cmd === 'minimize' || cmd === 'activate') {
        const id = Number(rest);
        if (!Number.isInteger(id)) return console.log('cú pháp: minimize|activate <id>');
        send({type: `shell_${cmd}`, windowId: id});
    } else if (cmd === 'raise') {
        let args = rest;
        const above = /\s--above\b/.test(' ' + args);
        const activate = /\s--activate\b/.test(' ' + args);
        args = args.replace(/\s--(above|activate)\b/g, '');
        const mm = args.match(/^(\d+)\s+(.+)$/);
        if (!mm) return console.log('cú pháp: raise <pid> <title> [--above] [--activate]');
        send({type: 'shell_raise', pid: Number(mm[1]), title: mm[2], above, activate});
    } else {
        console.log('lệnh không rõ');
    }
});

let done = false;
function cleanup() {
    if (done) return;
    done = true;
    try { fs.unlinkSync(sock); } catch {}
    process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
rl.on('close', cleanup);
