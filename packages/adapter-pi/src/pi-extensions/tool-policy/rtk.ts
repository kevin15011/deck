import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { pinRtkRewrite } from "../../../../core/src/owned-tools/rtk-hook";

export type RtkResult = Readonly<{ kind: "rewritten"; command: string } | { kind: "unchanged" } | { kind: "unavailable" }>;
export type RtkRewriter = Readonly<{ rewrite(command: string): Promise<RtkResult> }>;

const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 512 * 1024;

/**
 * Asks the Deck-owned RTK binary for an equivalent of a bash command (`rtk hook claude`, the same protocol the
 * Claude/Codex hooks use) and pins the executable word to the owned absolute path. Every failure mode returns
 * "unchanged": a rewrite problem must never block a tool call.
 */
export function createRtkRewriter(options: { binary: string; timeoutMs?: number }): RtkRewriter {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async rewrite(command) {
      if (!existsSync(options.binary)) return { kind: "unavailable" };
      const request = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
      const stdout = await new Promise<string | undefined>((resolve) => {
        let settled = false;
        const finish = (value: string | undefined) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(options.binary, ["hook", "claude"], { stdio: ["pipe", "pipe", "ignore"], shell: false });
        } catch {
          resolve(undefined);
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        const timer = setTimeout(() => { child.kill("SIGKILL"); finish(undefined); }, timeoutMs);
        child.stdout?.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_OUTPUT_BYTES) { child.kill("SIGKILL"); finish(undefined); return; }
          chunks.push(chunk);
        });
        child.on("error", () => finish(undefined));
        child.on("close", (code) => finish(code === 0 ? Buffer.concat(chunks).toString("utf8") : undefined));
        child.stdin?.on("error", () => { /* RTK may exit before reading */ });
        child.stdin?.end(request);
      });
      if (!stdout?.trim()) return { kind: "unchanged" };
      try {
        const hook = (JSON.parse(stdout) as { hookSpecificOutput?: { hookEventName?: string; updatedInput?: { command?: unknown } } }).hookSpecificOutput;
        if (hook?.hookEventName !== "PreToolUse" || typeof hook.updatedInput?.command !== "string") return { kind: "unchanged" };
        const pinned = pinRtkRewrite(hook.updatedInput.command, options.binary);
        return pinned === undefined ? { kind: "unchanged" } : { kind: "rewritten", command: pinned };
      } catch {
        return { kind: "unchanged" };
      }
    },
  };
}
