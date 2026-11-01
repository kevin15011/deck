"""Real process fault probes. Test children are Python only, never the evaluator."""
import hashlib
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

SCRIPT = Path(__file__).resolve().parents[1] / 'supervise.py'
spec = importlib.util.spec_from_file_location('supervise', SCRIPT)
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

def events(root):
    path = root / 'lifecycle.jsonl'
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

def wait_for(predicate):
    end = time.monotonic() + .8
    while time.monotonic() < end:
        value = predicate()
        if value:
            return value
        time.sleep(.002)
    raise AssertionError('bounded probe did not complete')

def supervise_case(base, name, code, deadline=.3):
    root = base / name
    return root, s.supervise([sys.executable, '-c', code], root, {}, time.time() + deadline, {}, drain_seconds=.02, heartbeat_seconds=.01)

with tempfile.TemporaryDirectory(prefix='deck-supervision-') as temp:
    base = Path(temp)
    # QSUP-1: hold the supervisor before main(), kill its original owner, then
    # let an actual subreaper adopt it. The pre-launch identity must reject the
    # adopter before even reading a plan. The marker replaces only external work.
    assert ctypes.CDLL(None).prctl(36, 1, 0, 0, 0) == 0  # PR_SET_CHILD_SUBREAPER
    for scenario in ('normal', 'adopted', 'wrong-start', 'missing'):
        ready_r, ready_w = os.pipe()
        go_r, go_w = os.pipe()
        marker = base / ('initialized-' + scenario)
        owner = os.fork()
        if owner == 0:
            identity = s.identify(os.getpid())
            os.environ['DECK_EVAL_OWNER_PID'] = str(identity['pid'])
            os.environ['DECK_EVAL_OWNER_START_TICKS'] = identity['startTicks']
            if scenario == 'wrong-start': os.environ['DECK_EVAL_OWNER_START_TICKS'] = '0'
            if scenario == 'missing': os.environ.pop('DECK_EVAL_OWNER_PID')
            supervisor = os.fork()
            if supervisor == 0:
                os.close(ready_r); os.close(go_w)
                os.write(ready_w, str(os.getpid()).encode()); os.close(ready_w)
                os.read(go_r, 1); os.close(go_r)
                sys.argv = ['supervise.py', '--manifest', '/unused', '--manifest-sha256', '0' * 64]
                def reached_plan(*args):
                    marker.touch()
                    raise SystemExit(0)
                s.load_plan = reached_plan
                try: s.main()
                except ValueError: os._exit(1)
                except SystemExit as e: os._exit(e.code)
                os._exit(99)
            os.close(ready_r); os.close(ready_w); os.close(go_r); os.close(go_w)
            _, status = os.waitpid(supervisor, 0)
            os._exit(os.waitstatus_to_exitcode(status))
        os.close(ready_w); os.close(go_r)
        supervisor = int(os.read(ready_r, 64)); os.close(ready_r)
        if scenario == 'adopted':
            os.kill(owner, signal.SIGKILL); os.waitpid(owner, 0)
            wait_for(lambda: s.identify(supervisor).get('ppid') == os.getpid())
        os.write(go_w, b'x'); os.close(go_w)
        _, status = os.waitpid(supervisor if scenario == 'adopted' else owner, 0)
        assert marker.exists() == (scenario == 'normal'), scenario + ': lost/mismatched owner reached plan loading'
        assert (os.waitstatus_to_exitcode(status) == 0) == (scenario == 'normal')

    root, result = supervise_case(base, 'normal', 'import sys; print("out"); print("err",file=sys.stderr)')
    assert result == 0 and events(root)[-1]['exitCode'] == 0
    assert events(root)[-1]['measurementValidity'] == 'not_assessed'
    assert (root / 'stdout.log').read_text() == 'out\n'
    assert (root / 'stderr.log').read_text() == 'err\n'
    for path in root.iterdir():
        assert path.stat().st_mode & 0o777 == 0o600
    assert root.stat().st_mode & 0o777 == 0o700
    terminal = events(root)[-1]
    assert terminal['stdoutSha256'] == hashlib.sha256((root / 'stdout.log').read_bytes()).hexdigest()
    child = events(root)[0]['child']
    assert child['pgid'] == os.getpgrp() and child['sid'] == os.getsid(0)
    assert terminal['childAfterReap']['absent']
    try:
        s.supervise([sys.executable, '-c', 'raise SystemExit(99)'], root, {}, time.time() + 1, {})
        raise AssertionError('existing receipts were reused')
    except FileExistsError:
        pass
    root, result = supervise_case(base, 'signal', 'import os,signal; os.kill(os.getpid(),signal.SIGTERM)')
    assert result == 143 and events(root)[-1]['signal'] == 'SIGTERM'
    root, result = supervise_case(base, 'deadline', 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(10)', .02)
    assert result != 0 and events(root)[-1]['reason'] == 'deadline_drain_exhausted'
    assert events(root)[-1]['signal'] == 'SIGKILL'

    # Supervisor death and its own owner's death both kill the child. No terminal
    # receipt is invented on SIGKILL; zombie state means no further local effects.
    for loss in ('supervisor', 'owner', 'term'):
        root = base / loss
        supervisor_code = f'''import sys,time; sys.path.insert(0,{str(SCRIPT.parent)!r}); import supervise as s
s.arm_parent_death(__import__('os').getppid())
s.supervise([sys.executable,'-c','import time; time.sleep(10)'],__import__('pathlib').Path({str(root)!r}),{{}},time.time()+10,{{}})'''
        if loss == 'owner':
            code = f'import subprocess,sys,time; p=subprocess.Popen([sys.executable,"-B","-c",{supervisor_code!r}]); time.sleep(10)'
        else:
            code = supervisor_code
        owner = subprocess.Popen([sys.executable, '-B', '-c', code])
        try:
            spawned = wait_for(lambda: next((e for e in events(root) if e['event'] == 'spawned'), None))
            if loss == 'term': owner.terminate()
            else: owner.kill()
            owner.wait()
            wait_for(lambda: s.identify(spawned['child']['pid']).get('state') in (None, 'Z'))
            if loss == 'term':
                terminal = events(root)[-1]
                assert terminal['event'] == 'terminal' and terminal['supervisorSignal'] == signal.SIGTERM
                assert terminal['childAfterReap']['absent']
            else:
                assert not any(e['event'] == 'terminal' for e in events(root))
        finally:
            if owner.poll() is None:
                owner.kill(); owner.wait()

    # Exact digest, launcher bytes, approval, private files and R-only selection
    # fail before spawning anything. No old run or credential file is opened.
    run = '20261031_aabbcc'
    home = base / 'home'
    root = home / '.deck-eval/runs' / run
    root.mkdir(parents=True, mode=0o700)
    plan = root / 'plan.json'
    payload = dict(run=run, evalRoot=str(root), mode='pilot', repeats=1, tracks=['R'], liveApproved=False, cleanupApproved=False,
                   processing=dict(runDeadlineMs=3600000), harnessHashes={'supervise.py': hashlib.sha256(SCRIPT.read_bytes()).hexdigest()})
    def write_plan():
        plan.write_text(json.dumps(payload)); plan.chmod(0o600)
        return hashlib.sha256(plan.read_bytes()).hexdigest()
    digest = write_plan()
    s.load_plan(plan, digest, False, home)
    # Actual command invocation: this waiting process supplies its own identity
    # before Popen. A fake Bun executable is the only replaced external edge.
    bin_dir = base / 'bin'
    bin_dir.mkdir()
    bun = bin_dir / 'bun'
    bun.write_text(f'#!{sys.executable}\nimport sys\nassert sys.argv[1] == "--no-env-file"\nprint("synthetic evaluator terminal")\n')
    bun.chmod(0o700)
    identity = s.identify(os.getpid())
    launch_env = dict(PATH=str(bin_dir), HOME=str(home), DECK_EVAL_OWNER_PID=str(identity['pid']),
                      DECK_EVAL_OWNER_START_TICKS=identity['startTicks'])
    launched = subprocess.run([sys.executable, '-I', '-B', str(SCRIPT), '--manifest', str(plan), '--manifest-sha256', digest],
                              env=launch_env, capture_output=True, timeout=1)
    assert launched.returncode == 0, launched.stderr
    assert events(root / 'supervision')[-1]['exitCode'] == 0
    assert events(root / 'supervision')[0]['owner']['startTicks'] == identity['startTicks']
    assert (root / 'supervision/stdout.log').read_text() == 'synthetic evaluator terminal\n'
    for mutation in ('digest', 'launcher', 'approval', 'mode', 'permissions'):
        original = json.loads(json.dumps(payload))
        if mutation == 'launcher': payload['harnessHashes']['supervise.py'] = '0' * 64
        if mutation == 'mode': payload['tracks'] = ['R', 'N']
        digest = write_plan()
        if mutation == 'permissions': plan.chmod(0o644)
        try:
            s.load_plan(plan, '0' * 64 if mutation == 'digest' else digest, mutation == 'approval', home)
            raise AssertionError('unsafe plan accepted: ' + mutation)
        except ValueError:
            pass
        payload = original

    digest = write_plan()
    link = root / 'linked.json'
    link.symlink_to(plan)
    try:
        s.load_plan(link, digest, False, home)
        raise AssertionError('symlink plan accepted')
    except ValueError:
        pass
    hardlink = root / 'hardlinked.json'
    os.link(plan, hardlink)
    try:
        s.load_plan(plan, digest, False, home)
        raise AssertionError('multiply-linked plan accepted')
    except ValueError:
        pass

print('supervision boundaries passed')
