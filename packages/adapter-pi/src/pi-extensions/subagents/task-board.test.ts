import { describe, expect, test } from "bun:test";
import { taskBoard } from "./task-board";

describe("Pi continuation answer ordering", () => {
  test("requires bookkeeping and resolution before the user-facing answer", () => {
    const board = taskBoard([], true)!;
    expect(board).toContain("Finish necessary tools, checks, OpenSpec/working-brief updates and task resolution before the user-facing answer");
    expect(board).toContain("Make that answer the last action of this turn, then yield immediately");
    expect(board).toContain("This does not require waiting for running children");
    expect(board).toContain("handle later outcomes in separate continuations with the same ordering");
    expect(board).toContain("do not repeat a synthesis for a stale wake");
  });

  test("does not create a continuation when nothing is outstanding", () => {
    expect(taskBoard([], false)).toBeUndefined();
  });
});
