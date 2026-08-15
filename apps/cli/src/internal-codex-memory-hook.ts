import { forwardCodexTrustedHook } from "../../../packages/adapter-codex/assets/codex/hooks/developer-team-execution";

export async function runInternalCodexMemoryHook(input?: { stdin?: string }): Promise<{ exitCode: number; output: string }> {
  try {
    const text = input?.stdin ?? await new Response(Bun.stdin.stream()).text();
    if (Buffer.byteLength(text, "utf8") > 1024 * 1024) return { exitCode: 1, output: JSON.stringify({ decision: "block", reason: "invalid-evidence" }) + "\n" };
    const parsed = JSON.parse(text);
    const output = await forwardCodexTrustedHook(parsed);
    return { exitCode: 0, output: JSON.stringify(output) + "\n" };
  } catch {
    return { exitCode: 1, output: JSON.stringify({ decision: "block", reason: "invalid-evidence" }) + "\n" };
  }
}
