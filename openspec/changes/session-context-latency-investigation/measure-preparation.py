"""Read-only aggregate of existing preparation diagnostics; no conversation output.
Usage: python3 measure-preparation.py SESSION_ROOT PROJECT_ROOT
Historical observations are not a controlled runner comparison.
"""
import collections
import json
import pathlib
import statistics
import sys

root, project = pathlib.Path(sys.argv[1]), sys.argv[2]
counts = collections.Counter()
phases = collections.defaultdict(list)
sessions = malformed = 0
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
                runner = event.get('source', {}).get('runnerId')
                if runner:
                    counts[runner] += 1
                data = event.get('data', {})
                if (runner and event.get('kind') == 'diagnostic'
                        and data.get('code') == 'turn.preparation'
                        and isinstance(data.get('previousPhaseDurationMs'), (int, float))):
                    phases[(runner, data.get('previousPhase'))].append(data['previousPhaseDurationMs'])
print(json.dumps({
    'scope': 'Retained repository sessions, potentially historical builds; not the community machine.',
    'sessions': sessions, 'eventCountsByRunner': dict(counts), 'malformedLines': malformed,
    'preparationPhaseObservations': [
        {'runner': runner, 'phase': phase, 'n': len(values),
         'medianMs': statistics.median(values), 'maxMs': max(values)}
        for (runner, phase), values in sorted(phases.items())
    ],
    'limitations': [
        'Phase populations differ; missing terminal phase records are not imputed.',
        'Do not sum phase medians or compare runners as equivalent workloads.',
        'turn.started is adapter-specific, not uniform model readiness or time to first answer.',
        'Concurrent local appends can change subsequent rerun counts.',
    ],
}, indent=2))
