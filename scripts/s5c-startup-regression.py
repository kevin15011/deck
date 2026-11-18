#!/usr/bin/env python3
"""Owned process-edge fault: delay the first real daemon's rendezvous by 2 s.
Protects: cold startup stays one bounded handshake, without a prototype-only cap.
Oracle: pinned CBM's default bootstrap contract admits a startup within 30 s.
Fails if: Deck truncates that contract and the client exits before rendezvous.
No account daemon is inspected or signalled: traverse only this driver's children.
"""
import argparse, json, os, pathlib, signal, subprocess, time
p = argparse.ArgumentParser()
p.add_argument('--binary', required=True)
p.add_argument('--driver', required=True)
p.add_argument('--output', required=True)
p.add_argument('--expect-failure', action='store_true')
a = p.parse_args()
out = pathlib.Path(a.output); out.mkdir(parents=True, exist_ok=True)
env = dict(os.environ, DECK2_CBM_BINARY=str(pathlib.Path(a.binary).resolve()))
def descendants(pid):
    result = set()
    pending = [pid]
    while pending:
        current = pending.pop()
        for task in pathlib.Path(f'/proc/{current}/task').glob('*'):
            try:
                children = [int(n) for n in (task/'children').read_text().split()]
            except OSError:
                continue
            for child in children:
                if child not in result:
                    result.add(child); pending.append(child)
    return result
started = time.monotonic(); held = None; held_fd = None; evidence = {}
with (out/'native.log').open('w') as log:
    child = subprocess.Popen(['nice','-n','10',a.driver,'--exact','actual_rust_supervisor_prepares_and_queries_scoped_index','--ignored','--nocapture','--test-threads=1'], env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        while child.poll() is None:
            if held is None:
                for pid in descendants(child.pid):
                    try:
                        args = pathlib.Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
                        if b'--cbm-daemon-internal' not in args:
                            continue
                        held_fd = os.pidfd_open(pid)
                        signal.pidfd_send_signal(held_fd, signal.SIGSTOP)
                        held = pid
                        evidence = dict(pid=pid, stopped_at_s=round(time.monotonic()-started,3), identity=pathlib.Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[19])
                        time.sleep(2)
                        signal.pidfd_send_signal(held_fd, signal.SIGCONT)
                        evidence['resumed_at_s'] = round(time.monotonic()-started,3)
                        break
                    except (OSError, ProcessLookupError):
                        continue
            if time.monotonic()-started > 300:
                raise TimeoutError('Owned native driver exceeded qualification bound')
            time.sleep(.005)
    finally:
        if held:
            try: signal.pidfd_send_signal(held_fd, signal.SIGCONT)
            except ProcessLookupError: pass
            os.close(held_fd)
        if child.poll() is None:
            child.terminate(); child.wait(timeout=15)
record = dict(binary=env['DECK2_CBM_BINARY'], driver=a.driver, exit_code=child.returncode, duration_s=round(time.monotonic()-started,3), daemon_hold=evidence, protects=__doc__, expected_failure=a.expect_failure)
(out/'result.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record))
assert evidence, 'No owned daemon was delayed; no startup evidence'
assert (child.returncode != 0) == a.expect_failure, 'Unexpected qualification result'
if a.expect_failure:
    assert 'before response' in (out/'native.log').read_text(), 'Failure did not reach initialization boundary'
