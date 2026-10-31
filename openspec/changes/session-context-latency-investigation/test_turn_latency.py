"""Check attempt boundaries in the read-only measurement, not model behavior."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('measurement', pathlib.Path(__file__).with_name('measure-turn-latency.py'))
measurement = importlib.util.module_from_spec(spec)
spec.loader.exec_module(measurement)


class CorrelationTest(unittest.TestCase):
    def test_interleaved_tasks_and_new_attempt_do_not_reuse_output(self):
        collector = measurement.Milestones()

        def emit(task, second, kind, data):
            collector.apply({'sessionId': 's', 'ts': f'2026-10-22T00:00:{second:02d}Z',
                             'source': {'taskId': task, 'runnerId': 'claude'}, 'kind': kind, 'data': data})

        def start(task, second, attempt):
            emit(task, second, 'diagnostic', {'code': 'turn.preparation', 'phase': 'checking-runner', 'attempt': attempt})

        start('a', 0, 1)
        start('b', 1, 1)
        emit('a', 2, 'turn.started', {})
        emit('a', 3, 'message.completed', {'role': 'user', 'text': 'not output'})
        emit('b', 4, 'message.delta', {'text': 'b'})
        emit('a', 5, 'message.delta', {'text': 'a'})
        emit('a', 6, 'message.delta', {'text': 'later delta'})
        emit('a', 7, 'turn.completed', {'status': 'completed'})
        emit('a', 8, 'message.delta', {'text': 'late ignored'})
        start('a', 10, 2)
        emit('a', 11, 'message.delta', {'text': 'internal ignored', 'internal': True})
        emit('a', 12, 'turn.completed', {'status': 'failed'})
        report = collector.report()['runners'][0]
        self.assertEqual(report['attempts'], 3)
        self.assertEqual(report['withoutOutput'], 1)
        self.assertEqual(report['metrics']['preparationToFirstOutput']['medianMs'], 4000)
        self.assertEqual(report['metrics']['nativeStartToFirstOutput']['medianMs'], 3000)


if __name__ == '__main__':
    unittest.main()
