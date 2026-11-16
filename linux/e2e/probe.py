#!/usr/bin/env python3
"""Client for the probe extension of the private test Shell (linux/e2e/probe@dopadam-e2e).

As a library:  import probe; probe.call("windows")
As a command:  probe.py windows | probe.py screenshot out.png | probe.py key Escape
               probe.py click X Y | probe.py ext info|enable|disable UUID | probe.py raw '{"cmd":...}'
"""
import json
import os
import socket
import sys


def socket_path():
    return f"/run/user/{os.getuid()}/dopadam-e2e/dd-probe.sock"


def call(cmd, timeout=15, **kw):
    req = dict(kw, cmd=cmd)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        s.connect(socket_path())
        s.sendall((json.dumps(req) + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
    reply = json.loads(buf or b"{}")
    if not reply.get("ok"):
        raise RuntimeError(f"probe {cmd}: {reply.get('error')}")
    return reply


def windows():
    return call("windows")["windows"]


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    c, rest = argv[0], argv[1:]
    if c == "windows":
        r = call("windows")
        for w in r["windows"]:
            flags = [k for k in ("focused", "minimized", "above", "fullscreen", "hidden") if w[k]]
            print(f"{w['stack']:2} id={w['id']} pid={w['pid']} {w['wmClass']!s:24} {w['title']!r} {w['rect']} {' '.join(flags)}")
        print("overview:", r["overview"])
    elif c == "screenshot":
        print(call("screenshot", path=os.path.abspath(rest[0]))["path"])
    elif c == "key":
        call("key", keys=rest)
    elif c == "click":
        call("click", x=int(rest[0]), y=int(rest[1]))
    elif c == "ext":
        print(call("extension", action=rest[0], uuid=rest[1]))
    elif c == "raw":
        req = json.loads(rest[0])
        print(json.dumps(call(req.pop("cmd"), **req)))
    else:
        print(json.dumps(call(c)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
