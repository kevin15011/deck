import { describe, expect, test } from "bun:test";
import type { RunnerAdapter } from "../runner-adapter";
import type { RunnerSessionDriver } from "./driver";

describe("RunnerSessionDriver typing", () => {
  test("getSessionDriver is an optional member of RunnerAdapter", () => {
    // An adapter lacking the method must still satisfy the type (compile-time via tsc).
    type Without = Omit<RunnerAdapter, "getSessionDriver">;
    const assignable = (a: Without): RunnerAdapter => a as RunnerAdapter;
    expect(typeof assignable).toBe("function");
    type Opt = RunnerAdapter["getSessionDriver"];
    const probe: Opt = undefined;
    expect(probe).toBeUndefined();
  });
  test("driver shape exposes protocol and tested versions", () => {
    const d: Pick<RunnerSessionDriver, "runnerId" | "protocol" | "testedVersions"> = {
      runnerId: "claude", protocol: "claude-stream-json", testedVersions: { min: "2.1.0", maxTested: "2.1.296" },
    };
    expect(d.protocol).toBe("claude-stream-json");
  });
});
