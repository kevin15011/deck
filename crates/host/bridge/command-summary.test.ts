import {expect, test} from 'bun:test';
import {summarizeCommand} from './command-summary';

const leaks = ['hunter2', 's3cr3t', 'sk-live', 'abc123token', 'pa55', 'Bearer', 'evil.example'];
test('summaries keep the tool and drop scripts, flags, URIs and secrets', () => {
  const cases = [
    "python3 -c 'import os; print(os.environ[\"s3cr3t\"])'",
    "cat <<EOF\nhunter2\nEOF",
    'curl -H "Authorization: Bearer abc123token" https://u:pa55@evil.example/x',
    'git remote add origin https://user:pa55@evil.example/repo.git',
    'API_KEY=sk-live node server.js --password hunter2',
    'mysql -phunter2 -e "select 1"',
    'git config user.password hunter2',
    'echo hunter2',
    'rg "s3cr3t" src',
    'bash -lc "echo s3cr3t"',
    'docker login -u me -p hunter2',
    'git commit -m "s3cr3t"',
    'git commit -m s3cr3t',
    'git tag -a v1 -m hunter2',
    'npm run deploy hunter2',
  ];
  for (const command of cases) {
    const summary = summarizeCommand(command);
    for (const leak of leaks) expect(summary).not.toContain(leak);
    expect(summary.length).toBeLessThan(120);
  }
});

test('recognizable executable and subcommand survive', () => {
  expect(summarizeCommand('git status')).toBe('git status');
  expect(summarizeCommand('rtk cargo test --lib')).toBe('cargo test');
  expect(summarizeCommand('cd crates/host && cargo build')).toBe('cd crates/host …');
  expect(summarizeCommand('ls -la src')).toStartWith('ls');
});
