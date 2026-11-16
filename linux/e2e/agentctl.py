#!/usr/bin/env python3
"""Seed a DopaDam data folder and start the agent inside the private test session.

Library use (from core_flow.py):
    agentctl.seed(data_dir, {"gnome-calculator": "entertainment"})
    proc = agentctl.start(agent_bin, data_dir, log_path, hidden=True)

The database schema is read from agent/src-tauri/src/db.rs (the same `CREATE TABLE IF NOT EXISTS`
text the agent runs), so the seeded file is exactly what the agent would have created.
"""
import os
import re
import sqlite3
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SESSION = os.path.join(HERE, "session.sh")


def schema():
    src = open(os.path.join(REPO, "agent/src-tauri/src/db.rs"), encoding="utf-8").read()
    m = re.search(r'const SCHEMA: &str = r#"(.*?)"#;', src, re.S)
    if not m:
        raise RuntimeError("SCHEMA not found in db.rs")
    return m.group(1)


def seed(data_dir, rules, delays=None, kv=None):
    """rules: {program: tag}; delays: {program: seconds}; kv: extra key/value rows."""
    os.makedirs(data_dir, exist_ok=True)
    now = int(time.time() * 1000)
    db = sqlite3.connect(os.path.join(data_dir, "dopadam.db"))
    db.executescript(schema())
    for exe, tag in rules.items():
        delay = (delays or {}).get(exe)
        db.execute(
            "INSERT INTO tag_rules(id, kind, pattern, tag, delay_seconds, updated_at, deleted, dirty)"
            " VALUES(?, 'exe', ?, ?, ?, ?, 0, 1)"
            " ON CONFLICT(id) DO UPDATE SET tag = excluded.tag, delay_seconds = excluded.delay_seconds, deleted = 0",
            (f"exe:{exe}", exe, tag, delay, now),
        )
    for k, v in (kv or {}).items():
        db.execute("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, v))
    db.commit()
    db.close()


def query(data_dir, sql, args=()):
    db = sqlite3.connect(os.path.join(data_dir, "dopadam.db"), timeout=5)
    try:
        return db.execute(sql, args).fetchall()
    finally:
        db.close()


def start(agent_bin, data_dir, log_path, hidden=True, extra_env=None):
    """Starts the agent inside the private session; returns the Popen of `session.sh exec`."""
    env_args = [
        f"DOPADAM_DATA_DIR={data_dir}",
        "DOPADAM_NO_AUTOSTART=1",
        "DOPADAM_QUIET=1",
    ] + [f"{k}={v}" for k, v in (extra_env or {}).items()]
    cmd = [SESSION, "exec", "env", *env_args, agent_bin] + (["--hidden"] if hidden else [])
    log = open(log_path, "ab")
    return subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)


def start_program(argv, log_path):
    log = open(log_path, "ab")
    return subprocess.Popen([SESSION, "exec", *argv], stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
