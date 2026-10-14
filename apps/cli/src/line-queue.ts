/** Buffers stdin lines from the moment it is created, so lines typed before the consumer starts are never lost. */
import { createInterface } from "node:readline";

export class LineQueue implements AsyncIterable<string> {
  private readonly buffer: string[] = [];
  private waiters: Array<(r: IteratorResult<string>) => void> = [];
  private ended = false;
  private readonly close: () => void;

  constructor(input: NodeJS.ReadableStream, private readonly onPrompt?: (prompt: string) => void) {
    const rl = createInterface({ input, terminal: false });
    rl.on("line", (line) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter({ value: line, done: false }); else this.buffer.push(line);
    });
    rl.on("close", () => {
      this.ended = true;
      for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true });
    });
    this.close = () => rl.close();
  }

  /** Next line, or undefined at end of input. */
  next(prompt?: string): Promise<string | undefined> {
    if (prompt) this.onPrompt?.(prompt);
    if (this.buffer.length > 0) return Promise.resolve(this.buffer.shift());
    if (this.ended) return Promise.resolve(undefined);
    return new Promise((resolve) => { this.waiters.push((r) => resolve(r.done ? undefined : r.value)); });
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return { next: async () => { const line = await this.next(); return line === undefined ? { value: undefined as never, done: true } : { value: line, done: false }; } };
  }

  dispose(): void { this.close(); }
}
