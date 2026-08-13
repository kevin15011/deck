import React from "react";
import { describe, expect, test } from "bun:test";
import { render, renderToString } from "ink";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import type { AgentApplyResult } from "@deck/adapter-pi";
import { ScreenFrame } from "./screen-frame";
import { CompleteScreen } from "./app";
import { HomeScreen } from "./screens/home-screen";
import { DoctorScreen } from "./screens/doctor-screen";
import type { DoctorDiagnosticsResult } from "../doctor-command/types";

function createInkHarness() {
  const chunks: Array<Buffer | null> = [];
  const stdin = new EventEmitter() as EventEmitter & { isTTY: boolean; setRawMode: () => void; setEncoding: () => void; read: () => Buffer | null; ref: () => void; unref: () => void };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.setEncoding = () => {};
  stdin.read = () => chunks.shift() ?? null;
  stdin.ref = () => {};
  stdin.unref = () => {};
  const stdout = new PassThrough() as PassThrough & { columns: number; rows: number; isTTY: boolean };
  stdout.columns = 100;
  stdout.rows = 30;
  stdout.isTTY = true;
  let output = "";
  stdout.on("data", (chunk) => { output += chunk.toString(); });
  return {
    stdin,
    stdout,
    output: () => output,
    close() { stdin.removeAllListeners(); stdout.removeAllListeners(); stdout.end(); stdout.destroy(); },
  };
}

describe("page based TUI screens", () => {
  test("renders a framed home screen without transcript-style previous output", () => {
    const output = renderToString(
      <ScreenFrame title="Deck" help="j/k: navigate • enter: select • q: quit">
        <HomeScreen cursor={0} />
      </ScreenFrame>,
    );

    expect(output).toContain("Deck");
    expect(output).toContain("Your AI environment, configured.");
    expect(output).toContain("Start installation");
    // T3.1: the upgrade-tools placeholder is now the real "Update Deck" action.
    expect(output).toContain("Update Deck");
    expect(output).not.toContain("Upgrade tools");
    expect(output).not.toContain("Pi Environment Preflight");
  });

  test("can render a frame using the full terminal dimensions", () => {
    const output = renderToString(
      <ScreenFrame title="Deck" help="help" width={100} height={24}>
        <HomeScreen cursor={0} />
      </ScreenFrame>,
    );

    expect(output).toContain("Deck");
    expect(output).toContain("help");
  });

  test("CompleteScreen distinguishes agent and skill results", () => {
    const results: AgentApplyResult[] = [
      { agentId: "deck-lead", kind: "agent", status: "created" },
      { agentId: "deck-lead", kind: "skill", status: "created" },
      { agentId: "deck-quality", kind: "agent", status: "unchanged" },
      { agentId: "deck-quality", kind: "skill", status: "updated" },
    ];

    const output = renderToString(
      <ScreenFrame title="Complete" help="help">
        <CompleteScreen results={[]} developerTeamResults={results} />
      </ScreenFrame>,
    );

    // Both agent and skill rows for the same agentId should appear
    expect(output).toContain("deck-lead");
    expect(output).toContain("deck-quality");

    // Rows must distinguish agent vs skill
    expect(output).toContain("agent");
    expect(output).toContain("skill");
  });

  test("CompleteScreen shows rollback failure in install results", () => {
    const output = renderToString(
      <ScreenFrame title="Complete" help="help">
        <CompleteScreen
          results={[{ tool: "Developer Team", success: false, message: "Verification failed. Changes rolled back." }]}
          developerTeamResults={[]}
        />
      </ScreenFrame>,
    );

    expect(output).toContain("Developer Team");
    expect(output).toContain("Verification failed");
    expect(output).toContain("rolled back");
  });

  test("CompleteScreen shows rollback failure with diagnostics in install results", () => {
    const output = renderToString(
      <ScreenFrame title="Complete" help="help">
        <CompleteScreen
          results={[{ tool: "Developer Team", success: false, message: "Verification failed. Changes rolled back.\nDetails: Missing description field;" }]}
          developerTeamResults={[]}
        />
      </ScreenFrame>,
    );

    expect(output).toContain("Developer Team");
    expect(output).toContain("Verification failed");
    expect(output).toContain("Details");
  });

  test("DoctorScreen passes the verified project root to diagnostics instead of falling back to cwd", async () => {
    const harness = createInkHarness();
    const calls: Array<{ projectRoot?: string }> = [];
    const result: DoctorDiagnosticsResult = {
      runtimes: [],
      memory: [],
      mcp: [{ category: "Supermemory Project Scope", status: "ok", items: [{ status: "ok", message: "scope checked" }] }],
      hasCriticalErrors: false,
      deck: [],
      binaryCheck: [],
      runnerConfig: [],
      summary: { ok: 1, warning: 0, error: 0, sections: ["Supermemory Project Scope"] },
    };
    const instance = render(
      <DoctorScreen
        projectRoot="/verified/project"
        runDiagnostics={async (_overrides, projectRoot) => {
          calls.push({ projectRoot });
          return result;
        }}
      />,
      { stdin: harness.stdin as never, stdout: harness.stdout as never, debug: false, exitOnCtrlC: false, patchConsole: false },
    );

    try {
      const deadline = Date.now() + 5_000;
      while (calls.length === 0 || !harness.output().includes("scope checked")) {
        if (Date.now() >= deadline) throw new Error("Timed out waiting for DoctorScreen diagnostics call");
        await instance.waitUntilRenderFlush();
      }

      expect(calls[0]).toEqual({ projectRoot: "/verified/project" });
      expect(harness.output()).toContain("scope checked");
    } finally {
      instance.unmount();
      harness.close();
    }
  });
});
