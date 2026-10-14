import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeckConfigStore } from "./deck-config-store";
import { CLAUDE_TOS_NOTICE, acknowledgeClaudeTos, isClaudeTosAcknowledged, runAckClaudeTos } from "./session-tos";

const roots: string[] = [];
function store() {
  const home = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "deck-tos-")));
  roots.push(home);
  return createDeckConfigStore({ homeDir: home, xdgConfigHome: join(home, "xdg") });
}
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("legacy optional Claude acknowledgement command", () => {
  test("acknowledging explicitly records an ISO timestamp in crossRunner", () => {
    const s = store();
    expect(isClaudeTosAcknowledged(s)).toBe(false);
    const at = acknowledgeClaudeTos(s, new Date("2026-10-12T12:00:00.000Z"));
    expect(at).toBe("2026-10-12T12:00:00.000Z");
    expect(isClaudeTosAcknowledged(s)).toBe(true);
    expect(JSON.parse(readFileSync(s.paths.canonicalPath, "utf8")).crossRunner.claudeTosAcknowledgedAt).toBe(at);
  });

  test("keeps the rest of crossRunner intact and does not rewrite an existing acknowledgement", () => {
    const s = store();
    s.write({ crossRunner: { enabled: true, members: { lead: { runnerId: "claude", modelId: "opus", thinking: "high" } } } });
    const first = acknowledgeClaudeTos(s, new Date("2026-10-12T12:00:00.000Z"));
    const second = acknowledgeClaudeTos(s, new Date("2027-01-01T00:00:00.000Z"));
    expect(second).toBe(first);
    const saved = JSON.parse(readFileSync(s.paths.canonicalPath, "utf8")).crossRunner;
    expect(saved).toMatchObject({ enabled: true, members: { lead: { runnerId: "claude", modelId: "opus", thinking: "high" } }, claudeTosAcknowledgedAt: first });
  });

  test("the notice states the residual ambiguity plainly and what Deck does and does not do", () => {
    expect(CLAUDE_TOS_NOTICE).toContain("claude -p");
    expect(CLAUDE_TOS_NOTICE).toMatch(/not (?:been )?confirm/i);
    expect(CLAUDE_TOS_NOTICE).toMatch(/personal/i);
    expect(CLAUDE_TOS_NOTICE).toMatch(/never (?:read|touch)/i);
    expect(CLAUDE_TOS_NOTICE).toContain("optional and does not affect session readiness");
    expect(CLAUDE_TOS_NOTICE).not.toContain("stays blocked");
  });

  test("`ack-claude-tos --yes` records without prompting; the notice is always shown", async () => {
    const s = store();
    const out: string[] = [];
    const code = await runAckClaudeTos({ store: s, yes: true, write: (t) => out.push(t), readLine: async () => { throw new Error("must not prompt"); }, interactive: false, now: () => new Date("2026-10-12T00:00:00.000Z") });
    expect(code).toBe(0);
    expect(out.join("")).toContain("claude -p");
    expect(isClaudeTosAcknowledged(s)).toBe(true);
  });

  test("without --yes a non-interactive run refuses and records nothing", async () => {
    const s = store();
    const out: string[] = [];
    const code = await runAckClaudeTos({ store: s, yes: false, write: (t) => out.push(t), readLine: async () => "yes", interactive: false });
    expect(code).toBe(1);
    expect(out.join("")).toMatch(/--yes/);
    expect(isClaudeTosAcknowledged(s)).toBe(false);
    expect(existsSync(s.paths.canonicalPath)).toBe(false);
  });

  test("interactively, only an explicit `yes` records the acknowledgement", async () => {
    for (const [answer, expected] of [["yes", true], ["YES", true], ["y", false], ["", false], ["no", false]] as const) {
      const s = store();
      const code = await runAckClaudeTos({ store: s, yes: false, write: () => {}, readLine: async () => answer, interactive: true });
      expect(isClaudeTosAcknowledged(s)).toBe(expected);
      expect(code).toBe(expected ? 0 : 1);
    }
  });

  test("already acknowledged: reports it and succeeds", async () => {
    const s = store();
    acknowledgeClaudeTos(s, new Date("2026-10-12T12:00:00.000Z"));
    const out: string[] = [];
    expect(await runAckClaudeTos({ store: s, yes: false, write: (t) => out.push(t), readLine: async () => "", interactive: false })).toBe(0);
    expect(out.join("")).toMatch(/already acknowledged/i);
  });
});
