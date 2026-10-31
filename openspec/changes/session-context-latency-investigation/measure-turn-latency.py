"""Aggregate existing task-attempt milestones without exposing conversation contents.
Usage: python3 measure-turn-latency.py SESSION_ROOT PROJECT_ROOT
No inference, network or source-session writes. Event times are observations, not causal attribution.
"""
import collections
import datetime
import json
import pathlib
import statistics
import sys


def milliseconds(timestamp):
    return datetime.datetime.fromisoformat(timestamp.replace('Z', '+00:00')).timestamp() * 1000


def summarize(values):
    values = sorted(values)
    return {'n': len(values), 'medianMs': round(statistics.median(values), 3),
            'p95Ms': round(values[max(0, (95 * len(values) + 99) // 100 - 1)], 3),
            'maxMs': round(values[-1], 3)}


class Milestones:
    def __init__(self):
        self.active = {}
        self.attempts = []
        self.steps = collections.defaultdict(list)

    def apply(self, event):
        data, source = event.get('data', {}), event.get('source', {})
        task, runner = source.get('taskId'), source.get('runnerId')
        if not task or not runner:
            return
        key = (event['sessionId'], task)
        if event['kind'] == 'diagnostic' and data.get('code') == 'turn.preparation-detail':
            for step in data.get('steps', []):
                self.steps[(runner, step['step'], data['outcome'])].append(step['durationMs'])
        if event['kind'] == 'diagnostic' and data.get('code') == 'turn.preparation' and data.get('phase') == 'checking-runner':
            record = {'runner': runner, 'attempt': data['attempt'], 'start': milliseconds(event['ts'])}
            self.active[key] = record
            self.attempts.append(record)
            return
        record = self.active.get(key)
        if not record or record['runner'] != runner:
            return
        now = milliseconds(event['ts'])
        if event['kind'] == 'turn.started':
            record.setdefault('nativeStart', now)
            if isinstance(data.get('claudeCodeVersion'), str):
                record['version'] = data['claudeCodeVersion']
        if event['kind'] in ('message.delta', 'message.completed') and data.get('role') not in ('user', 'system') and not data.get('internal'):
            text = data.get('text', data.get('delta', ''))
            if isinstance(text, str) and text.strip():
                record.setdefault('firstOutput', now)
                record.setdefault('firstActivity', now)
        if event['kind'] in ('tool.started', 'reasoning.delta') and not data.get('internal'):
            record.setdefault('firstActivity', now)
        if event['kind'] == 'turn.completed':
            record['end'] = now
            record['status'] = data.get('status', 'unknown')
            self.active.pop(key, None)

    def report(self):
        groups = collections.defaultdict(list)
        for attempt in self.attempts:
            groups[attempt['runner']].append(attempt)
        result = []
        for runner, records in sorted(groups.items()):
            metrics = {}
            for name, before, after in [('preparationToNativeStart', 'start', 'nativeStart'),
                                        ('preparationToFirstActivity', 'start', 'firstActivity'),
                                        ('preparationToFirstOutput', 'start', 'firstOutput'),
                                        ('nativeStartToFirstOutput', 'nativeStart', 'firstOutput')]:
                values = [r[after] - r[before] for r in records if before in r and after in r and r[after] >= r[before]]
                if values:
                    metrics[name] = summarize(values)
            result.append({'runner': runner, 'attempts': len(records),
                           'withoutOutput': sum('firstOutput' not in r for r in records),
                           'terminalStatuses': dict(collections.Counter(r.get('status', 'not-observed') for r in records)),
                           'observedVersions': sorted({r['version'] for r in records if 'version' in r}),
                           'metrics': metrics})
        return {'runners': result, 'preparationSteps': [
            {'runner': key[0], 'step': key[1], 'outcome': key[2], **summarize(values)}
            for key, values in sorted(self.steps.items())]}


def main():
    root, project = pathlib.Path(sys.argv[1]), sys.argv[2]
    collector, sessions, malformed = Milestones(), 0, 0
    for directory in sorted(root.iterdir()):
        try:
            meta = json.loads((directory / 'session.json').read_text())
        except (OSError, ValueError):
            continue
        if meta.get('projectRoot') != project:
            continue
        sessions += 1
        for segment in sorted((directory / 'events').glob('*.jsonl')):
            with segment.open() as stream:
                for line in stream:
                    try:
                        event = json.loads(line)
                    except ValueError:
                        malformed += 1
                        continue
                    collector.apply(event)
    print(json.dumps({'kind': 'historical-task-attempt-milestones', 'sessions': sessions,
                      'malformedLines': malformed, **collector.report(), 'limitations': [
        'Historical local builds and unequal workloads; not a controlled runner benchmark.',
        'First output is a nonempty assistant message event, not first model token or browser paint.',
        'First activity includes tool starts and reasoning deltas; neither implies a rendered user-visible message.',
        'Native start has runner-specific semantics; tool/approval/compaction waits may precede output.',
        'No timing is assigned to missing milestones; medians must not be added.',
        'Correlation uses task event order; the old ledger has no universal attempt ID on native events.',
    ]}, indent=2))


if __name__ == '__main__':
    main()
