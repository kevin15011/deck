import React from "react";
import { expect, spyOn, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { RunnerDashboardScreens } from "./runner-dashboard-screens";
import { createDefaultRunnerDashboardState } from "../runner-dashboard/state";

async function waitFor(assertion: () => void) {
  const deadline = Date.now() + 1_000;
  while (true) {
    try { assertion(); return; } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

for (const terminal of ["unmount", "complete", "failed"] as const) {
  test(`install spinner advances without results and releases its timer on ${terminal}`, async () => {
    let tick: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const originalInterval = globalThis.setInterval;
    const interval = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, delay: number) => {
      if (delay !== 100) return originalInterval(callback, delay);
      tick = callback;
      timer = originalInterval(() => {}, 60_000);
      return timer;
    }) as typeof setInterval);
    const clear = spyOn(globalThis, "clearInterval");
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    let output = "";
    stdout.on("data", (chunk) => { output += chunk.toString(); });
    const state = createDefaultRunnerDashboardState({ runnerScope: "codex", screen: "install-progress" });
    const instance = render(<RunnerDashboardScreens state={state} />, { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, patchConsole: false });
    try {
      await waitFor(() => expect(output).toContain("| Installing…"));
      expect(tick).toBeDefined();
      for (const frame of ["/", "-", "\\", "|"]) {
        output = "";
        tick!();
        await waitFor(() => expect(output).toContain(`${frame} Installing…`));
      }
      instance.rerender(<RunnerDashboardScreens state={state} cancellationRequested />);
      await waitFor(() => expect(output).toContain("waiting for the active command to stop"));
      output = "";
      tick!();
      await waitFor(() => expect(output).toContain("/ Installing…"));
      expect(clear.mock.calls.some(([value]) => value === timer)).toBe(false);
      output = "";
      if (terminal === "unmount") instance.unmount();
      else instance.rerender(<RunnerDashboardScreens state={{ ...state, screen: "complete" }} installResults={terminal === "failed" ? [{ actionId: "install", status: "failed", message: "Installation failed.", diagnostics: [] }] : []} />);
      await waitFor(() => expect(clear.mock.calls.some(([value]) => value === timer)).toBe(true));
      if (terminal !== "unmount") {
        expect(output).not.toContain("Installing…");
        expect(output).toContain(terminal === "failed" ? "setup stopped before completion" : "setup complete");
      }
    } finally {
      instance.unmount();
      if (timer) clearInterval(timer);
      interval.mockRestore();
      clear.mockRestore();
      stdin.destroy();
      stdout.destroy();
    }
  });
}
