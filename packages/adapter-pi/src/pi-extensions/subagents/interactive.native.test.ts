import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPiHarness, findRealPi } from "../../pi-cli-harness";

for (const mode of ["fullscreen", "regular"]) test.skipIf(process.platform !== "linux" || !findRealPi() || !Bun.which("python3"))(`real interactive Pi ${mode}: automatic integration preserves scroll/editor and quiet panel`, async () => {
  const harness = createPiHarness({ installOptions: { modelAssignments: { "deck-investigate": "faux/faux-1" } } });
  try {
    const settingsPath = join(harness.agentDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ ...JSON.parse(readFileSync(settingsPath, "utf8")), tuiMode: mode }));
    const proc = Bun.spawn(["python3", join(import.meta.dir, "../../__fixtures__/interactive-pi-probe.py"), findRealPi()!, harness.root, harness.agentDir, harness.project, mode], {
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
      env: { PATH: process.env.PATH ?? "", HOME: harness.home, PI_CODING_AGENT_DIR: harness.agentDir, TERM: "xterm-256color", PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1",
        DECK_PI_SESSION: "1", DECK_PI_ROLE: "lead", DECK_PI_MEMORY: "disabled", FAUX_SCRIPT: "delegate", FAUX_CHILD_DELAY_MS: "1500", FAUX_READY_FILE: join(harness.root, "ready"),
        FAUX_DELEGATE: JSON.stringify({ agent: "deck-investigate", title: "Inspect memory", task: "Check fixture evidence" }) },
    });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ mode, integratedWithoutPrompt: true, editorPreserved: true, minimized: true });
  } finally { harness.cleanup(); }
}, 30000);
