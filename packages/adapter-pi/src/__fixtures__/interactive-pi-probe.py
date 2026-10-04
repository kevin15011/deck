"""Hermetic PTY probe of real Pi with a scripted provider; no external services."""
import errno
import fcntl
import glob
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time

binary, root, agent_dir, project, mode = sys.argv[1:]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 110, 0, 0))
output = ""
overall_deadline = time.monotonic() + 23

def child_setup():
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

process = subprocess.Popen([binary, "--model", "faux/faux-1", "--session-dir", os.path.join(root, "sessions")],
                           stdin=slave, stdout=slave, stderr=slave, cwd=project, env=dict(os.environ), preexec_fn=child_setup)
os.close(slave)

def read_output(delay=0.05):
    global output
    if select.select([master], [], [], delay)[0]:
        try:
            data = os.read(master, 65536).decode("utf-8", "replace")
            output = (output + data)[-500000:]
            if "\x1b[6n" in data:
                os.write(master, b"\x1b[1;1R")
        except OSError as error:
            if error.errno != errno.EIO:
                raise

def wait_for(predicate, description, seconds=12):
    deadline = min(time.monotonic() + seconds, overall_deadline)
    while not predicate():
        if process.poll() is not None or time.monotonic() >= deadline:
            raise AssertionError(description + "; terminal tail: " + repr(output[-1200:]))
        read_output()

def entries():
    result = []
    for path in glob.glob(os.path.join(root, "sessions", "*.jsonl")):
        for line in open(path, encoding="utf-8"):
            try:
                result.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return result

def latest_jobs():
    snapshots = [entry["data"]["jobs"] for entry in entries() if entry.get("customType") == "deck-subagents-v1"]
    return snapshots[-1] if snapshots else []

try:
    wait_for(lambda: os.path.exists(os.path.join(root, "ready")), "interactive session_start readiness missing")
    os.write(master, b"delegate\r")
    wait_for(lambda: any(job["state"] == "running" for job in latest_jobs()), "background task did not start")
    wait_for(lambda: "SUBAGENTS" in output if mode == "fullscreen" else "Subagents:" in output, "native panel/status did not mount")
    # Scrolling and typing must remain usable while the background task and native follow-up run.
    os.write(master, b"\x1b[5~\x1b[6~EDITOR_KEPT")
    wait_for(lambda: any(job.get("integration") == "integrated" for job in latest_jobs()), "no automatic Lead integration")
    wait_for(lambda: "LEAD_DONE" in output, "no automatic final synthesis")
    # No second user message has been submitted yet.
    users = [entry for entry in entries() if entry.get("message", {}).get("role") == "user"]
    assert len(users) == 1, "completion required or invented another user prompt"
    os.write(master, b"\r")
    def editor_submitted():
        for entry in entries():
            message = entry.get("message", {})
            if message.get("role") != "user":
                continue
            content = message.get("content", "")
            text = content if isinstance(content, str) else "".join(block.get("text", "") for block in content)
            if text == "EDITOR_KEPT":
                return True
        return False
    wait_for(editor_submitted, "editor text was lost or focus was stolen")
    os.write(master, b"/subagents toggle\r")
    wait_for(lambda: "minimized" in output, "panel minimization did not update")
    if mode == "regular":
        assert "SUBAGENTS" not in output, "floating overlay leaked into regular mode"
    print(json.dumps({"mode": mode, "integratedWithoutPrompt": True, "editorPreserved": True, "minimized": True}))
finally:
    if process.poll() is None:
        try:
            os.write(master, b"\x03")
            time.sleep(0.1)
            os.write(master, b"\x03")
            deadline = time.monotonic() + 3
            while process.poll() is None and time.monotonic() < deadline:
                read_output()
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, OSError):
            pass
    process.wait(timeout=3)
    os.close(master)
