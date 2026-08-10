import { describe, expect, test } from "bun:test";

import {
  INTERNAL_SERENA_MCP_PROBE_TOKEN,
  runInternalSerenaMcp,
} from "./internal-serena-mcp";

const ready = {
  state: "ready" as const,
  evidence: {
    capabilityId: "serena" as const,
    state: "ready" as const,
    resolvedExecutablePath: "/fixtures/deck-data/tools/serena/bin/serena",
    source: "existing-deck-tool" as const,
    probe: "serena-help" as const,
    fingerprint: "fixture",
  },
  revalidate: async (evidence: import("@deck/core").SerenaReadinessEvidence) => ({ valid: true as const, evidence }),
};

describe("deck internal serena-mcp", () => {
  test("proxies only the validated launcher with fixed arguments and inherited stdio", async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const result = await runInternalSerenaMcp({
      resolveReadiness: async () => ready,
      spawnInherited: async (command, args) => {
        calls.push({ command, args });
        return { wait: async () => ({ exitCode: 23, signal: null }), forwardSignal: () => undefined };
      },
      writeStderr: () => undefined,
    });

    expect(calls).toEqual([{
      command: "/fixtures/deck-data/tools/serena/bin/serena",
      args: ["start-mcp-server", "--context", "ide", "--project-from-cwd"],
    }]);
    expect(result).toEqual({ exitCode: 23 });
  });

  test("returns bounded actionable diagnostics without bootstrap when no launcher is available", async () => {
    const stderr: string[] = [];
    let spawns = 0;
    const result = await runInternalSerenaMcp({
      resolveReadiness: async () => ({
        state: "missing",
        diagnostic: { code: "serena-not-ready", message: "missing\n".repeat(500) },
      }),
      spawnInherited: async () => {
        spawns += 1;
        return { wait: async () => ({ exitCode: 0, signal: null }), forwardSignal: () => undefined };
      },
      writeStderr: (message) => stderr.push(message),
    });

    expect(result).toEqual({ exitCode: 1 });
    expect(spawns).toBe(0);
    expect(stderr.join(" ")).toContain("serena-not-ready");
    expect(stderr.join(" ").length).toBeLessThan(550);
  });

  test("preserves a child signal for the CLI dispatcher", async () => {
    const result = await runInternalSerenaMcp({
      resolveReadiness: async () => ready,
      spawnInherited: async () => ({ wait: async () => ({ exitCode: null, signal: "SIGTERM" }), forwardSignal: () => undefined }),
      writeStderr: () => undefined,
    });
    expect(result).toEqual({ exitCode: 1, signal: "SIGTERM" });
  });


  test("forwards parent termination signals to the child and removes every handler after it exits", async () => {
    const handlers = new Map<NodeJS.Signals, () => void>();
    const removed: NodeJS.Signals[] = [];
    const forwarded: NodeJS.Signals[] = [];
    let scheduledEscalations = 0;
    let cancelledEscalations = 0;
    let finish: ((outcome: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | undefined;
    const result = runInternalSerenaMcp({
      resolveReadiness: async () => ready,
      spawnInherited: async () => ({
        wait: () => new Promise((resolve) => { finish = resolve; }),
        forwardSignal: (signal) => { forwarded.push(signal); },
      }),
      onSignal: (signal, handler) => {
        handlers.set(signal, handler);
        return () => {
          handlers.delete(signal);
          removed.push(signal);
        };
      },
      supportedSignals: ["SIGINT", "SIGTERM", "SIGHUP"],
      scheduleTerminationEscalation: () => {
        scheduledEscalations += 1;
        return () => { cancelledEscalations += 1; };
      },
      writeStderr: () => undefined,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    handlers.get("SIGTERM")?.();
    expect(forwarded).toEqual(["SIGTERM"]);
    expect(scheduledEscalations).toBe(1);
    finish?.({ exitCode: null, signal: "SIGTERM" });
    await expect(result).resolves.toEqual({ exitCode: 1, signal: "SIGTERM" });
    expect(removed).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    expect(cancelledEscalations).toBe(1);
    expect(handlers.size).toBe(0);
  });

  test("exports a stable capability probe token", () => {
    expect(INTERNAL_SERENA_MCP_PROBE_TOKEN).toBe("deck-serena-mcp-proxy-v1");
  });
});
