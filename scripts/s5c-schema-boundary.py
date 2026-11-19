#!/usr/bin/env python3
"""S5c: actual predecessor refusal, byte preservation and supported reopening.
Only owned temporary fixture state is modified. No provider turn is dispatched.
"""
import argparse, hashlib, json, os, signal, sqlite3, subprocess, tempfile, time
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser()
p.add_argument('--binary', type=Path, default=repo / 'dist/deck2')
p.add_argument('--old', type=Path, default=repo / 'target/review-s7a-d9d409cd/dist/deck2')
p.add_argument('--seed', type=Path)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)
root = Path(tempfile.mkdtemp(prefix='schema-boundary-', dir=a.output.resolve()))
fake = root / 'codex'
fake.write_bytes((repo / 'crates/host/tests/fake_native.py').read_bytes())
fake.chmod(0o700)
(root / 'mode').write_text('normal')
records = []


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def connect(db):
    return sqlite3.connect(f'file:{db}?mode=ro', uri=True)


def rows(db):
    with connect(db) as c:
        return {table: c.execute(f'SELECT * FROM {table} ORDER BY rowid').fetchall()
                for (table,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall()}


def version(db):
    with connect(db) as c:
        return c.execute("SELECT value FROM meta WHERE key='schema'").fetchone()[0]


def launch(binary, project, state, label, expect_ready=True):
    log = root / (label + '.log')
    prior = (state / 'launcher.json').read_bytes() if (state / 'launcher.json').exists() else None
    with log.open('w') as stream:
        host = subprocess.Popen([str(binary.resolve()), 'serve', *(['--foreground'] if binary == a.binary else []), '--project', str(project), '--state-dir', str(state), '--codex', str(fake), '--no-open'], stdout=stream, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 20
            ready = False
            while host.poll() is None and time.monotonic() < deadline:
                ready = (state / 'launcher.json').exists() and (state / 'launcher.json').read_bytes() != prior and 'Deck host ready' in log.read_text()
                if ready:
                    break
                time.sleep(.05)
            if expect_ready:
                assert ready, f'{label}: failed startup; see {log}'
            else:
                assert not ready and host.poll() not in (None, 0), f'{label}: predecessor accepted incompatible state'
                assert ('Unsupported or corrupt state' in log.read_text() or label == 'rollback-fault' and 'Cannot publish' in log.read_text()), f'{label}: failed for unrelated reason'
        finally:
            if host.poll() is None:
                host.send_signal(signal.SIGINT)
                try:
                    host.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    host.kill()
                    host.wait(timeout=5)
    return {'label': label, 'ready': ready, 'exit_code': host.returncode, 'log': str(log)}


result = {'root': str(root), 'binary_sha256': sha(a.binary), 'predecessor_sha256': sha(a.old), 'runs': records}
try:
    # A genuine predecessor creates this no-helper state, rather than relabeling
    # a current database that still contains newer fields/tables.
    project = root / 'project'
    project.mkdir()
    state = root / 'legacy'
    records.append(launch(a.old, project, state, 'legacy-create'))
    db = state / 'state.db'
    assert version(db) == '8'
    original = rows(db)
    assert 'changes' in original
    records.append(launch(a.binary, project, state, 'legacy-migrate'))
    migrated = rows(db)
    assert version(db) == '9', 'lifecycle-capable binary did not publish incompatible schema'
    for table, body in original.items():
        if table not in ['meta','definitions','configurations']:
            assert migrated[table] == body, f'legacy {table} changed during migration'
        elif table in ['definitions','configurations']:
            assert migrated[table][:len(body)] == body, f'legacy {table} history changed'
    assert dict(migrated['meta']) | {'schema': '8'} == dict(original['meta'])
    before = sha(db)
    logical = rows(db)
    records.append(launch(a.old, project, state, 'legacy-old-rejection', False))
    assert sha(db) == before and rows(db) == logical, 'predecessor changed rejected state'
    records.append(launch(a.binary, project, state, 'legacy-reopen'))
    assert rows(db) == logical, 'supported reopen changed settled state'
    result['legacy_preserved'] = True

    rollback_state = root / 'rollback'
    records.append(launch(a.old, project, rollback_state, 'rollback-create'))
    rollback_db = rollback_state / 'state.db'
    with sqlite3.connect(rollback_db) as c:
        c.execute("CREATE TRIGGER fail_seven BEFORE UPDATE ON meta WHEN NEW.key='schema' AND NEW.value='9' BEGIN SELECT RAISE(ABORT,'late injected fault'); END")
    before = sha(rollback_db)
    logical = rows(rollback_db)
    records.append(launch(a.binary, project, rollback_state, 'rollback-fault', False))
    assert sha(rollback_db) == before and rows(rollback_db) == logical
    assert version(rollback_db) == '8'
    result['rollback_preserved'] = True
    assert not (root / 'dispatches').exists(), 'fixture unexpectedly dispatched a provider turn'
    result['passed'] = True
finally:
    (a.output / 'schema-boundary.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'passed': True, 'root': str(root), 'runs': len(records)}))
