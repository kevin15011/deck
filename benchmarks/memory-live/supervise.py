"""Linux attached R evaluator supervisor; never grants approval or resumes a run.

The launching owner must await this process through termination. SIGKILL of an
owner/supervisor cannot write a terminal receipt: classify that absence as
interrupted/unfinalized. Remote deferred processing is outside local containment.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
DRAIN_SECONDS = 10


def arm_parent_death(expected_parent, expected_start_ticks=None):
    # Compare with the parent's PRE-fork PID; checking only a newly observed PPID
    # would miss death between fork and prctl. No session/process-group escape.
    if sys.platform != 'linux' or expected_parent <= 1:
        raise ValueError('attached_linux_owner_required')
    if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGKILL, 0, 0, 0) != 0:
        raise ValueError('parent_death_guard_unavailable')
    identity = identify(expected_parent)
    if (os.getppid() != expected_parent or identity.get('state') in (None, 'Z')
            or expected_start_ticks is not None and identity.get('startTicks') != expected_start_ticks):
        raise ValueError('attached_owner_identity_mismatch')


def identify(pid):
    try:
        raw = Path(f'/proc/{pid}/stat').read_text()
        fields = raw[raw.rfind(')') + 2:].split()
        return dict(pid=pid, state=fields[0], ppid=int(fields[1]), pgid=int(fields[2]), sid=int(fields[3]), startTicks=fields[19])
    except FileNotFoundError:
        return dict(pid=pid, absent=True)


def private_bytes(path):
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError('private_path_must_be_absolute_without_symlinks')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        st = os.fstat(source.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or stat.S_IMODE(st.st_mode) != 0o600 or st.st_uid != os.getuid():
            raise ValueError('private_owned_regular_file_required')
        return source.read()


def load_plan(path, expected_hash, live, home):
    raw = private_bytes(path)
    if not re.fullmatch('[a-f0-9]{64}', expected_hash) or hashlib.sha256(raw).hexdigest() != expected_hash:
        raise ValueError('manifest_digest_mismatch')
    plan = json.loads(raw)
    run = plan.get('run', '')
    if not re.fullmatch(r'\d{8}_[a-f0-9]{6,16}(?:_[1-5])?', run):
        raise ValueError('invalid_run')
    root = Path(plan['evalRoot'])
    # Offline runs may use the evaluator's synthetic test-scratch layout too.
    allowed = root == home / '.deck-eval/runs' / run
    if not live:
        allowed |= root.parent.parent == home / '.deck-eval/test-scratch' and root.name == run
    if not allowed or path != root / 'plan.json' or root.resolve() != root:
        raise ValueError('manifest_root_mismatch')
    st = root.stat()
    if st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700:
        raise ValueError('private_owned_run_required')
    if plan.get('mode') != 'pilot' or plan.get('repeats') != 1 or plan.get('tracks') != ['R']:
        raise ValueError('supervisor_requires_r_pilot')
    if plan.get('liveApproved') is not live or plan.get('cleanupApproved') is not False:
        raise ValueError('exact_evaluation_approval_required')
    launcher_hash = hashlib.sha256((HERE / 'supervise.py').read_bytes()).hexdigest()
    if plan.get('harnessHashes', {}).get('supervise.py') != launcher_hash:
        raise ValueError('launcher_changed_since_manifest')
    deadline = plan.get('processing', {}).get('runDeadlineMs')
    if type(deadline) is not int or not 1 <= deadline <= 86400000:
        raise ValueError('invalid_run_deadline')
    # execute() independently validates all other frozen inputs and durable
    # single-use authority before credential access. Nothing here grants it.
    return plan


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def supervise(command, output, env, deadline_at, provenance, *, drain_seconds=DRAIN_SECONDS, heartbeat_seconds=5, boottime_deadline=None):
    output.mkdir(mode=0o700)  # exclusive: never overwrite or reuse old receipts
    sync_directory(output.parent)
    started = time.monotonic()
    # Convert once: wall-clock adjustments cannot extend the outer watchdog.
    hard_stop = (boottime_deadline if boottime_deadline is not None else time.clock_gettime(time.CLOCK_BOOTTIME) + max(0, deadline_at - time.time())) + drain_seconds
    child = None
    received_signal = None
    old_handlers = {}
    files = []

    def on_signal(sig, _frame):
        nonlocal received_signal
        received_signal = sig

    def create(name):
        fd = os.open(output / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_DSYNC, 0o600)
        stream = os.fdopen(fd, 'wb', buffering=0)
        files.append(stream)
        return stream

    try:
        journal, stdout, stderr = [create(name) for name in ('lifecycle.jsonl', 'stdout.log', 'stderr.log')]
        sync_directory(output)

        def emit(event, **data):
            record = dict(event=event, utc=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), elapsedSeconds=time.monotonic() - started, **data)
            journal.write((json.dumps(record) + '\n').encode())
            os.fsync(journal.fileno())

        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            old_handlers[sig] = signal.signal(sig, on_signal)
        if received_signal:
            return 128 + received_signal
        parent = os.getpid()
        parent_ticks = identify(parent)['startTicks']
        child = subprocess.Popen(command, cwd=HERE.parents[1], env=env, stdin=subprocess.DEVNULL,
                                 stdout=stdout, stderr=stderr, preexec_fn=lambda: arm_parent_death(parent, parent_ticks))
        emit('spawned', supervisor=identify(parent), owner=identify(os.getppid()), child=identify(child.pid),
             detached=False, deadlineAtMs=round(deadline_at * 1000), drainSeconds=drain_seconds, **provenance)
        next_beat = started
        reason = None
        while child.poll() is None:
            now = time.monotonic()
            if now >= next_beat:
                emit('heartbeat', child=identify(child.pid))
                next_beat = now + heartbeat_seconds
            if received_signal or time.clock_gettime(time.CLOCK_BOOTTIME) >= hard_stop:
                reason = 'supervisor_signal' if received_signal else 'deadline_drain_exhausted'
                # No new egress is allowed in drain: the evaluator receives this
                # same absolute deadline and its transport rejects late effects.
                emit('termination_requested', reason=reason, supervisorSignal=received_signal, signal='SIGKILL')
                child.kill()
                break
            time.sleep(.01)
        code = child.wait(timeout=5)
        for stream in (stdout, stderr):
            os.fsync(stream.fileno())
        emit('terminal', returncode=code, exitCode=code if code >= 0 else None,
             signal=signal.Signals(-code).name if code < 0 else None, reason=reason,
             supervisorSignal=received_signal, childAfterReap=identify(child.pid), measurementValidity='not_assessed',
             stdoutSha256=hashlib.sha256((output / 'stdout.log').read_bytes()).hexdigest(),
             stderrSha256=hashlib.sha256((output / 'stderr.log').read_bytes()).hexdigest())
        return 128 + received_signal if received_signal else (code if code >= 0 else 128 - code)
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
        for stream in files:
            stream.close()


def main():
    os.umask(0o077)
    # Required from the immediate owner's PRE-launch identity, never the PPID
    # discovered after startup (which may already be a subreaper/adopter).
    owner_pid = os.environ.get('DECK_EVAL_OWNER_PID', '')
    owner_ticks = os.environ.get('DECK_EVAL_OWNER_START_TICKS', '')
    if not owner_pid.isdecimal() or not owner_ticks.isdecimal():
        raise ValueError('prelaunch_owner_identity_required')
    arm_parent_death(int(owner_pid), owner_ticks)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--live', action='store_true')
    args = parser.parse_args()
    plan = load_plan(args.manifest, args.manifest_sha256, args.live, Path.home())
    bun = shutil.which('bun')
    if not bun:
        raise ValueError('bun_unavailable')
    # Explicit environment: no native credential/config preload inheritance, no
    # .env loading. The key FILE PATH is passed only for separately approved live
    # execution; this supervisor never opens it or records environment values.
    env = {k: os.environ[k] for k in ('PATH', 'HOME', 'LANG', 'TMPDIR') if k in os.environ}
    if args.live and 'SUPERMEMORY_EVAL_API_KEY_FILE' in os.environ:
        env['SUPERMEMORY_EVAL_API_KEY_FILE'] = os.environ['SUPERMEMORY_EVAL_API_KEY_FILE']
    deadline_ms = int(time.time() * 1000) + plan['processing']['runDeadlineMs']
    # Linux CLOCK_BOOTTIME shares its epoch across the attached Python/Bun
    # processes. Transfer the deadline itself, never reconvert UTC after launch.
    boottime_deadline_ms = time.clock_gettime_ns(time.CLOCK_BOOTTIME) // 1000000 + plan['processing']['runDeadlineMs']
    command = [bun, '--no-env-file', str(HERE / 'run.ts'), 'run' if args.live else 'dry-run',
               '--manifest', str(args.manifest), '--manifest-sha256', args.manifest_sha256]
    if args.live:
        command += ['--live', '--supervision-deadline-ms', str(deadline_ms),
                    '--supervision-boottime-deadline-ms', str(boottime_deadline_ms)]
    return supervise(command, Path(plan['evalRoot']) / 'supervision', env, deadline_ms / 1000,
                     dict(run=plan['run'], manifestSha256=args.manifest_sha256, launcherSha256=plan['harnessHashes']['supervise.py'],
                          boottimeDeadlineMs=boottime_deadline_ms,
                          mode='live' if args.live else 'offline_simulation_not_quality_evidence'),
                     boottime_deadline=boottime_deadline_ms / 1000)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        # Avoid dumping environment, credential paths or arbitrary subprocess errors.
        print('supervision_failed: inspect private plan and lifecycle receipts', file=sys.stderr)
        sys.exit(1)
