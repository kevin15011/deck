import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./test";

// Protect actual CLI composition: selection must not turn a one-module edit or empty tier into a full run.
test("working-tree import selection executes only the affected test and propagates failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-tier-selection-"));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  };
  try {
    mkdirSync(join(root, "tests"));
    writeFileSync(join(root, "bunfig.toml"), "[test]\n");
    writeFileSync(join(root, "tests/quarantine.yaml"), "entries: []\n");
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(root, `module${i}.ts`), "export const value = 1;\n");
      writeFileSync(join(root, `module${i}.test.ts`), `import {test,expect} from 'bun:test';import {value} from './module${i}';test('value',()=>expect(value).toBe(1));\n`);
    }
    git("init", "-q"); git("add", ".");
    git("-c", "user.name=Deck Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
    writeFileSync(join(root, "module0.ts"), "export const value = 2;\n");
    const messages: string[] = [];
    const log = console.log;
    console.log = (...args) => messages.push(args.join(" "));
    try {
      expect(await main(["--changed", "--list"], root)).toBe(0);
      expect(messages[0]).toContain("Selected 1/20");
      expect(messages[1]).toBe("module0.test.ts");
    } finally { console.log = log; }
    expect(await main(["--changed"], root)).toBe(1);
    expect(await main(["--tier", "e2e"], root)).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A failed parallel batch must not hide required install tests or be overwritten
// by the successful serial batch's exit status.
test("install batch runs after a failed parallel batch and preserves its failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-tier-batches-"));
  try {
    mkdirSync(join(root, "tests"));
    writeFileSync(join(root, "bunfig.toml"), "[test]\n");
    writeFileSync(join(root, "tests/quarantine.yaml"), "entries: []\n");
    writeFileSync(join(root, "regular.test.ts"), `import {test,expect} from 'bun:test';import {writeFileSync} from 'node:fs';test('regular failure',()=>{writeFileSync('parallel-finished','yes');expect(false).toBe(true)});`);
    const directory = join(root, "packages/adapter-codex/src");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "runner-adapter.tools.int.test.ts"), `import {test,expect} from 'bun:test';import {existsSync,writeFileSync} from 'node:fs';test('serial effect',()=>{expect(existsSync('parallel-finished')).toBe(true);writeFileSync('serial-finished','yes')});`);
    expect(Bun.spawnSync(["git", "init", "-q"], { cwd: root }).exitCode).toBe(0);
    expect(await main(["--tier", "all"], root)).toBe(1);
    expect(await Bun.file(join(root, "serial-finished")).text()).toBe("yes");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
