import React from "react";
import { expect, spyOn, test } from "bun:test";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { OpenCodeModelDiscoveryScreen, CodexModelDiscoveryScreen, ClaudeModelDiscoveryScreen } from "./developer-team-screens";

async function waitFor(assertion: () => void) {
  const deadline = Date.now() + 1_000;
  while (true) {
    try { assertion(); return; } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

for (const [runner, Screen, label] of [
  ["OpenCode", OpenCodeModelDiscoveryScreen, "Reading models from OpenCode…"],
  ["Codex", CodexModelDiscoveryScreen, "Reading models from Codex…"],
  ["Claude", ClaudeModelDiscoveryScreen, "Reading models from installed Claude…"],
] as const) {
  for (const terminal of ["unmount", "ready", "blocked"] as const) {
    test(`${runner} discovery animates while waiting and releases its timer on ${terminal}`, async () => {
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
      const instance = render(<Screen cursor={0} state={{ kind: "loading" }} />, { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream, debug: true, patchConsole: false });
      try {
        await waitFor(() => expect(output).toContain(`| ${label}`));
        for (const frame of ["/", "-", "\\", "|"]) {
          output = "";
          tick!();
          await waitFor(() => expect(output).toContain(`${frame} ${label}`));
        }
        expect(clear.mock.calls.some(([value]) => value === timer)).toBe(false);
        output = "";
        if (terminal === "unmount") instance.unmount();
        else instance.rerender(<Screen cursor={0} state={terminal === "ready" ? { kind: "ready" } : { kind: "blocked", errorMessage: "Discovery failed." }} />);
        await waitFor(() => expect(clear.mock.calls.some(([value]) => value === timer)).toBe(true));
        if (terminal !== "unmount") expect(output).not.toContain(label);
        if (terminal === "blocked") {
          expect(output).toContain("Discovery failed.");
          expect(output).toContain("Retry discovery");
          expect(output).toContain("Back");
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
}
