/**
 * Test-only harness: runs the REAL Pi 1.0 binary hermetically (isolated HOME and PI_CODING_AGENT_DIR, faux provider,
 * stdin ignored, no network) against a Deck package materialized by Deck's own planner/engine.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPiGlobalMaterialization, type PiGlobalMaterializationInput } from "./global-materialization";
import { applyPiGlobalPlan, createNodePiFileIO, planPiGlobalInstall } from "./pi-global-install";

const FAUX_EXTENSION = fileURLToPath(new URL("./__fixtures__/faux-cli-extension.js", import.meta.url));
const PROBE_EXTENSION = fileURLToPath(new URL("./__fixtures__/probe-cli-extension.js", import.meta.url));

export function findRealPi(): string | undefined {
  const candidates = [Bun.which("pi"), join(homedir(), ".bun", "bin", "pi")];
  return candidates.find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate!));
}

export type PiHarness = {
  root: string;
  agentDir: string;
  home: string;
  project: string;
  sessionsDir: string;
  cleanup(): void;
  /** Run pi in JSON print mode; returns parsed JSONL events plus raw stderr. */
  run(args: string[], env: Record<string, string>, options?: { timeoutMs?: number; persistSession?: boolean }): Promise<{ events: Array<Record<string, any>>; stderr: string; code: number }>;
};

export function createPiHarness(materialization: Omit<PiGlobalMaterializationInput, "agentDir" | "projectRoot" | "legacyDeckEvidence"> = {}): PiHarness {
  const pi = findRealPi();
  if (!pi) throw new Error("pi binary not found");
  const root = mkdtempSync(join(tmpdir(), "deck-pi-cli-"));
  const agentDir = join(root, "agent");
  const home = join(root, "home");
  const project = join(root, "project");
  for (const dir of [join(agentDir, "extensions"), home, project]) mkdirSync(dir, { recursive: true });
  copyFileSync(FAUX_EXTENSION, join(agentDir, "extensions", "faux.js"));
  copyFileSync(PROBE_EXTENSION, join(agentDir, "extensions", "probe.js"));
  const built = buildPiGlobalMaterialization({ agentDir, projectRoot: project, legacyDeckEvidence: false, ...materialization });
  const io = createNodePiFileIO();
  applyPiGlobalPlan(planPiGlobalInstall(built.desired, io), io);
  return {
    root, agentDir, home, project, sessionsDir: join(root, "sessions"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    async run(args, env, options = {}) {
      const sessionArgs = options.persistSession ? ["--session-dir", join(root, "sessions")] : ["--no-session"];
      const child = Bun.spawn([pi, "--mode", "json", "-p", ...sessionArgs, "--model", "faux/faux-1", ...args], {
        cwd: project,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: { PATH: process.env.PATH ?? "", HOME: home, PI_CODING_AGENT_DIR: agentDir, ...env },
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 90_000);
      const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
      const code = await child.exited;
      clearTimeout(timer);
      const events = stdout.split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
      return { events, stderr, code };
    },
  };
}
