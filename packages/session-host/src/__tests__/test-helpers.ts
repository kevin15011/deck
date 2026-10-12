import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];

/** Real (symlink-free) temp directory; macOS /var is a symlink and several path guards reject it. */
export function tempDir(prefix = "dk-"): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), prefix));
  created.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function tempSubdir(base: string, name: string): string {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Minimal deterministic clock matching the host Clock port. */
export class FakeClock {
  private current = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.current;
  setTimeout = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.current + ms, fn });
    return id;
  };
  clearTimeout = (id: unknown): void => { this.timers.delete(id as number); };
  get pending(): number { return this.timers.size; }
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.current = due[1].at;
      due[1].fn();
    }
    this.current = target;
  }
}
