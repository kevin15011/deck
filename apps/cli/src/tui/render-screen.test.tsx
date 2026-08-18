import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToString } from "ink";

import type { AgentApplyResult } from "@deck/adapter-pi";
import { ScreenFrame } from "./screen-frame";
import { CompleteScreen } from "./app";
import { HomeScreen } from "./screens/home-screen";
import { DoctorScreen, runDoctorScreenDiagnostics } from "./screens/doctor-screen";
import type { DoctorDiagnosticsResult } from "../doctor-command/types";

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
    const loaded = await runDoctorScreenDiagnostics(async (_overrides, projectRoot) => {
      calls.push({ projectRoot });
      return result;
    }, "/verified/project");
    const output = renderToString(<DoctorScreen projectRoot="/verified/project" runDiagnostics={async () => loaded} />);

    expect(calls[0]).toEqual({ projectRoot: "/verified/project" });
    expect(JSON.stringify(loaded)).toContain("scope checked");
    expect(output).toContain("Running diagnostics");
  });
});
