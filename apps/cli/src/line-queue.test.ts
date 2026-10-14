import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { LineQueue } from "./line-queue";

describe("LineQueue", () => {
  test("keeps lines written before anyone iterates (no lost input)", async () => {
    const input = new PassThrough();
    const queue = new LineQueue(input);
    input.write("one\ntwo\n");
    await new Promise((r) => setTimeout(r, 20));
    const got: string[] = [];
    const reader = (async () => { for await (const line of queue) got.push(line); })();
    input.write("three\n");
    input.end();
    await reader;
    expect(got).toEqual(["one", "two", "three"]);
  });

  test("next() resolves undefined at end of input and prompts are announced", async () => {
    const input = new PassThrough();
    const prompts: string[] = [];
    const queue = new LineQueue(input, (p) => prompts.push(p));
    input.end("answer\n");
    expect(await queue.next("Q? ")).toBe("answer");
    expect(await queue.next()).toBeUndefined();
    expect(prompts).toEqual(["Q? "]);
  });
});
