import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPiHarness, findRealPi } from "../../pi-cli-harness";

function timeoutProbe(stage: string, data: Record<string, unknown> = {}) {
  const observer = Reflect.get(globalThis, "__deckTimeoutProbe");
  if (typeof observer === "function") {
    try { observer(stage, data); } catch { /* Diagnostics must not alter test control flow. */ }
  }
}

for (const mode of ["fullscreen", "regular"]) test.skipIf(!["linux", "darwin"].includes(process.platform) || !findRealPi() || !Bun.which("python3"))(`real interactive Pi ${mode}: automatic integration preserves scroll/editor and quiet panel`, async () => {
  timeoutProbe("interactive.begin", { mode });
  const harness = createPiHarness({ installOptions: { modelAssignments: { "deck-investigate": "faux/faux-1" } } });
  timeoutProbe("interactive.harness.ready", { mode, root: harness.root });
  try {
    const settingsPath = join(harness.agentDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ ...JSON.parse(readFileSync(settingsPath, "utf8")), tuiMode: mode }));
    timeoutProbe("interactive.spawn.before", { mode });
    const proc = Bun.spawn(["python3", join(import.meta.dir, "../../__fixtures__/interactive-pi-probe.py"), findRealPi()!, harness.root, harness.agentDir, harness.project, mode], {
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { PATH: process.env.PATH ?? "", HOME: harness.home, PI_CODING_AGENT_DIR: harness.agentDir, TERM: "xterm-256color", PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1",
        DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", DECK_PI_MEMORY: "disabled", FAUX_SCRIPT: "delegate", FAUX_CHILD_DELAY_MS: "1500", FAUX_READY_FILE: join(harness.root, "ready"),
        ...(process.env.DECK_TIMEOUT_PROBE_DIR ? { DECK_TIMEOUT_PROBE_DIR: process.env.DECK_TIMEOUT_PROBE_DIR } : {}),
        FAUX_DELEGATE: JSON.stringify({ agent: "deck-investigate", title: "Inspect memory", task: "Check fixture evidence" }) },
    });
    timeoutProbe("interactive.spawn.after", { mode, pid: proc.pid });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text().then(text => { timeoutProbe("interactive.stdout.eof", { mode, bytes: text.length }); return text; }),
      new Response(proc.stderr).text().then(text => { timeoutProbe("interactive.stderr.eof", { mode, bytes: text.length }); return text; }),
      proc.exited.then(code => { timeoutProbe("interactive.exited", { mode, code }); return code; }),
    ]);
    timeoutProbe("interactive.join.after", { mode, code });
    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ mode, integratedWithoutPrompt: true, editorPreserved: true, minimized: true });
  } finally { timeoutProbe("interactive.cleanup.before", { mode }); harness.cleanup(); timeoutProbe("interactive.cleanup.after", { mode }); }
}, 30000);
