import { expect, test } from "bun:test";
import { dirname } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";
import { SubagentPanel, panelVisible, panelLines } from "./panel";
import type { Job } from "./jobs";
const themeModule = await import(Bun.resolveSync("./modes/interactive/theme/theme.js", dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")))));
const theme = themeModule.loadThemeFromPath(fileURLToPath(new URL("./modes/interactive/theme/dark.json", import.meta.resolve("@earendil-works/pi-coding-agent"))), "truecolor");

const coding = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const native = await import(Bun.resolveSync("@earendil-works/pi-tui", dirname(coding)));
class Terminal {
  columns = 110; rows = 30; kittyProtocolActive = false; output = ""; input?: (s: string) => void;
  start(input: (s: string) => void) { this.input = input; }
  stop() {} async drainInput() {} write(s: string) { this.output += s; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
const job = { id: "12345678", parent: "a", childId: "b", agent: "deck-investigate", task: "Inspect source", state: "running", created: 1000, started: 1000, lastActivity: 2000, activity: [{ at: 2000, kind: "tool", text: "read started" }], output: "" } as Job;
function setup(Tui: any, jobs: () => Job[] = () => [job]) {
  const terminal = new Terminal(); const tui = new Tui(terminal); let typed = ""; let host: any; let status = "";
  const document = { invalidate() {}, render() { return Array.from({ length: 80 }, (_, i) => `Conversation ${i}`).concat(`EDITOR ${native.CURSOR_MARKER}${typed}`); }, handleInput(s: string) { typed += s; } };
  tui.addChild(document); tui.setFocus(document); tui.start();
  const panel = new SubagentPanel(jobs);
  panel.open({ hasUI: true, mode: "tui", ui: {
    getEditorText: () => typed, setStatus: (_k: string, v: string) => status = v,
    setWidget: (_k: string, factory: any) => { host?.dispose?.(); host = factory?.(tui, theme); if (host) expect(host.render(100)).toEqual([]); },
  } } as never);
  tui.renderNow(true);
  return { panel, tui, terminal, typed: () => typed, status: () => status, close() { panel.close(); tui.stop(); } };
}
test("production fullscreen panel stays viewport-anchored through native scrolling; input/focus and sticky minimize survive updates", () => {
  const s = setup(native.TuiAltScreen);
  try {
    const row = () => s.tui.getScreenLines().findIndex((line: string) => line.includes("SUBAGENTS"));
    expect(row()).toBe(1);
    const screenRow = s.tui.getScreenLines().find((line: string) => line.includes("Investigate"));
    expect(screenRow).toContain(theme.fg("accent", "Investigate"));
    expect(screenRow).toContain(theme.fg("accent", "Reading"));
    s.terminal.input!("typing"); s.tui.renderNow(); expect(s.typed()).toBe("typing");
    const old = s.tui.viewportTop; s.tui.scrollBy(-20); s.tui.renderNow(true);
    expect(s.tui.viewportTop).not.toBe(old); expect(row()).toBe(1);
    s.tui.scrollToBottom(); s.tui.renderNow(true); expect(row()).toBe(1);
    expect(s.tui.getScreenLines().at(-1)).toContain("EDITOR");
    s.panel.toggle(); s.panel.update(); s.tui.renderNow(true); expect(row()).toBe(-1); expect(s.status()).toContain("minimized"); expect(s.status()).not.toContain("/subagents");
    s.panel.toggle(); s.tui.renderNow(true); expect(row()).toBe(1);
    s.terminal.columns = 70; s.tui.renderNow(true); expect(row()).toBe(-1); expect(s.status()).toContain("Ru1");
    s.terminal.columns = 110; s.terminal.rows = 18; s.tui.renderNow(true); expect(row()).toBe(-1);
  } finally { s.close(); }
});
test("finishing one job keeps the remaining clock live and the completed panel minimizable", async () => {
  const started = Date.now() - 4000;
  const jobs = [
    { ...job, id: "apply", agent: "deck-apply-fast", created: started, started },
    { ...job, id: "quality", agent: "deck-quality", created: started, started },
  ] as Job[];
  const s = setup(native.TuiAltScreen, () => jobs);
  const clock = (name: string) => s.tui.getScreenLines().find((line: string) => line.includes(name))?.match(/\d{2}:\d{2}:\d{2}/)?.[0];
  try {
    jobs[0]!.state = "completed"; jobs[0]!.ended = started + 2000;
    s.panel.update(); s.tui.renderNow();
    expect(s.tui.getScreenLines().join("\n")).toContain("Co1");
    expect(clock("Apply Fast")).toBeUndefined();
    const runningClock = clock("Quality");
    expect(runningClock).toBeDefined();
    // No manual update/render: exercise the panel's timer after a sibling completes.
    // Wall-clock rounding and monotonic timer scheduling need not share a boundary.
    // Observe real refreshes within two ticks instead of assuming the first tick changes the second.
    const deadline = performance.now() + 3000;
    while (clock("Quality") === runningClock && performance.now() < deadline) await Bun.sleep(25);
    expect(clock("Quality")).not.toBe(runningClock);
    expect(clock("Apply Fast")).toBeUndefined();
    jobs[1]!.state = "completed"; jobs[1]!.ended = Date.now();
    s.panel.update(); s.tui.renderNow();
    expect(s.status()).toContain("Co2");
    s.panel.toggle(); s.tui.renderNow();
    expect(s.tui.getScreenLines().some((line: string) => line.includes("SUBAGENTS"))).toBe(false);
    s.panel.toggle(); s.tui.renderNow();
    expect(s.tui.getScreenLines().some((line: string) => line.includes("SUBAGENTS"))).toBe(true);
  } finally { s.close(); }
});
test("four executing slots remain individually visible while history is aggregate-only", () => {
  const jobs = Array.from({ length: 4 }, (_, i) => ({ ...job, id: `slot-${i}`, agent: `deck-slot-${i}`, title: `Visible title ${i}`, state: i === 3 ? "cancelling" : "running" })) as Job[];
  jobs.unshift({ ...job, agent: "deck-old-history", title: "OLD_CARD", state: "completed", integration: "pending", outcomeId: "ready" });
  jobs.push({ ...job, agent: "deck-queued-card", title: "QUEUED_CARD", state: "queued" }, { ...job, agent: "deck-failed-card", title: "FAILED_CARD", state: "failed", integration: "blocked" });
  const s = setup(native.TuiAltScreen, () => jobs);
  try {
    const screen = s.tui.getScreenLines().map(stripVTControlCharacters).join("\n");
    for (let i = 0; i < 4; i++) { expect(screen).toContain(`Slot ${i}`); expect(screen).toContain(`Visible title ${i}`); }
    for (const hidden of ["OLD_CARD", "QUEUED_CARD", "FAILED_CARD", "+", "more"]) expect(screen).not.toContain(hidden);
    for (const count of ["Qu1", "Co1", "Fa1", "Le1", "Bl1"]) {
      expect(screen).toContain(count); expect(s.status()).toContain(count);
    }
    expect(screen).toContain("EDITOR");
    s.terminal.input!("still typing"); expect(s.typed()).toBe("still typing");
    s.terminal.rows = 18; s.tui.renderNow(true);
    expect(s.tui.getScreenLines().join("\n")).not.toContain("SUBAGENTS");
    expect(s.status()).toContain("Ru3");
  } finally { s.close(); }
  const regular = setup(native.TuiMainScreen, () => jobs);
  try { expect(regular.status()).toContain("Le1"); expect(regular.status()).toContain("Cg1"); }
  finally { regular.close(); }
});
test("regular mode installs no floating overlay and leaves terminal scrolling/input alone", () => {
  const s = setup(native.TuiMainScreen);
  try {
    expect(s.tui.captureRenderState().previousLines.some((l: string) => l.includes("SUBAGENTS"))).toBe(false);
    expect(s.status()).toContain("Ru1"); expect(s.status()).not.toContain("/subagents");
    s.terminal.input!("regular typing"); expect(s.typed()).toBe("regular typing");
    expect(typeof s.tui.scrollBy).toBe("undefined");
  } finally { s.close(); }
});
test("compact row uses real native theme ANSI with cell-safe segment bounds", () => {
  const active = { ...job, agent: "deck-apply-fast", title: "Short title", activity: [] } as Job;
  const lines = panelLines([active], 42, 84000, theme);
  expect(stripVTControlCharacters(lines[1]!)).toBe(" Apply Fast 00:01:23 Working");
  expect(lines[1]).toContain("\x1b[");
  expect(lines[1]!.length).toBeGreaterThan(native.visibleWidth(lines[1]));
  expect(lines[1]).toContain(theme.fg("accent", "Apply Fast"));
  expect(lines[1]).toContain(theme.fg("muted", "00:01:23"));
  expect(lines[1]).toContain(theme.fg("accent", "Working"));
  expect(stripVTControlCharacters(lines[2]!)).toBe(" Short title");
  for (const [state, integration, color, label] of [
    ["cancelling", undefined, "warning", "Cancelling"],
  ] as const) {
    const row = panelLines([{ ...active, state, integration } as Job], 42, 84000, theme)[1]!;
    expect(row).toContain(theme.fg(color, label));
    expect(native.visibleWidth(row)).toBeLessThanOrEqual(42);
  }
  for (const width of [1, 2, 4, 12, 20, 42]) {
    const rendered = panelLines([{ ...active, agent: "deck-very-long-role\x1b[31m界", title: "\x1b]0;unsafe\x07Title", state: "interrupted", integration: "reviewing" } as Job], width, 84000, theme);
    expect(rendered.every(l => native.visibleWidth(l) <= width)).toBe(true);
    expect(rendered.every(l => /^[\x20-\x7e]*$/.test(stripVTControlCharacters(l)))).toBe(true);
  }
});
test("history has one colored counter row; narrow overflow stays explicit and falls back to complete status", () => {
  const jobs = [
    { ...job, state: "completed", integration: "integrated" },
    { ...job, state: "failed", integration: "blocked" },
  ] as Job[];
  const lines = panelLines(jobs, 42, 84000, theme);
  expect(lines).toHaveLength(2);
  expect(stripVTControlCharacters(lines[1]!)).toBe(" Co1 Fa1 In1 Bl1");
  for (const [color, label] of [["success", "Co1"], ["error", "Fa1"], ["success", "In1"], ["warning", "Bl1"]] as const) expect(lines[1]).toContain(theme.fg(color, label));
  for (const width of [1, 2, 4, 12, 20, 42]) {
    const rows = panelLines(jobs, width, 84000, theme);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => native.visibleWidth(row) <= width)).toBe(true);
  }
  const attention = [{ ...job, state: "interrupted", integration: "pending", reminded: true, deliveryBlocked: true }, { ...job, state: "cancelled" }, { ...job, state: "queued" }, { ...job, state: "completed", integration: "reviewing" }] as Job[];
  const s = setup(native.TuiAltScreen, () => attention);
  try {
    expect(s.tui.getScreenLines().join("\n")).not.toContain("SUBAGENTS");
    for (const label of ["It1", "Ca1", "Qu1", "Le1", "Re1", "De1", "Ac1"]) expect(s.status()).toContain(label);
    expect(stripVTControlCharacters(panelLines(attention, 20, 84000, theme)[1]!)).toEndWith("!");
  } finally { s.close(); }
});
test("all counter labels use two distinct letters and cancelled is not warning-colored", () => {
  const jobs = [
    { ...job, state: "running" }, { ...job, state: "cancelling" }, { ...job, state: "queued" },
    { ...job, state: "completed", integration: "integrated" },
    { ...job, state: "failed", integration: "blocked" },
    { ...job, state: "interrupted", integration: "pending", reminded: true, deliveryBlocked: true },
    { ...job, state: "cancelled" }, { ...job, state: "completed", integration: "reviewing" },
  ] as Job[];
  const row = panelLines(jobs, 120, 84000, theme).at(-1)!;
  const counters = stripVTControlCharacters(row).trim().split(" ");
  expect(counters).toHaveLength(11);
  expect(counters.every(counter => /^[A-Z][a-z]\d+$/.test(counter))).toBe(true);
  expect(new Set(counters.map(counter => counter.slice(0, 2))).size).toBe(counters.length);
  expect(row).toContain(theme.fg("muted", "Ca1"));
  expect(row).not.toContain(theme.fg("warning", "Ca1"));
  expect(row).toContain(theme.fg("warning", "Bl2"));
  const regular = setup(native.TuiMainScreen, () => jobs);
  try {
    const labels = [...regular.status().matchAll(/\b([A-Z][a-z])\d+\b/g)].map(match => match[1]);
    expect(labels).toHaveLength(13);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("Ru"); expect(labels).toContain("Cg");
  } finally { regular.close(); }
});
test("active stage is observed, unknown tools remain neutral and retry requires real evidence", () => {
  expect(panelLines([job], 42).join("\n")).toContain("Reading");
  const withEvent = (kind: string, text: string) => panelLines([{ ...job, activity: [{ at: 2000, kind, text }] } as Job], 42).join("\n");
  expect(withEvent("tool", "editing: edit started")).toContain("Editing");
  expect(withEvent("tool", "testing: bash started")).toContain("Testing");
  expect(withEvent("tool", "network_helper started")).toContain("Working");
  expect(withEvent("retry", "auto_retry_start: attempt 2")).toContain("Retrying");
  expect(withEvent("retry", "auto_retry_end: attempt 2")).toContain("Working");
  expect(withEvent("tool", "reading: read completed")).toContain("Working");
  expect(withEvent("report", "editing: edit started")).toContain("Working");
  expect(withEvent("retry", "waiting for provider")).toContain("Working");
});
test("bounds, safe text previews and large editor fallback", () => {
  expect(panelVisible(110, 30, "x\n".repeat(20), false, "fullscreen")).toBe(false);
  expect(panelVisible(110, 30, "", true, "fullscreen")).toBe(false);
  const lines = panelLines([{ ...job, task: "\x1b[31m界".repeat(300) }], 42, 12000);
  expect(lines.every(l => l.length <= 42 && !l.includes("\x1b"))).toBe(true);
  const controls = panelLines([{ ...job, task: "\x1b]0;title\x07Hello\r\nworld\x00\t" }], 42, 12000);
  expect(controls.every(l => /^[\x20-\x7e]*$/.test(l))).toBe(true);
  expect(lines.join("\n")).not.toContain("ago");
});
test("human names, clock durations and frozen terminal elapsed without technical noise", () => {
  for (const [seconds, clock] of [[0, "00:00:00"], [3661, "01:01:01"], [90061, "25:01:01"]] as const) {
    const text = panelLines([{ ...job, agent: "deck-apply-fast" }], 42, 1000 + seconds * 1000).join("\n");
    expect(text).toContain(`Apply Fast`); expect(text).toContain(clock);
    for (const noise of [job.id, "deck-", "*", "/subagents", "tool:", "ago"]) expect(text).not.toContain(noise);
  }
  const completed = { ...job, state: "completed", ended: 3662000 } as Job;
  expect(panelLines([completed], 42, 4000000)).toEqual(panelLines([completed], 42, 9000000));
  expect(panelLines([completed], 42).join("\n")).toContain("Co1");
  for (const state of ["queued", "failed", "interrupted", "cancelling", "cancelled"] as const) {
    expect(panelLines([{ ...job, state }], 42, 1000).join("\n")).toContain({ queued: "Qu1", failed: "Fa1", interrupted: "It1", cancelling: "Cancelling", cancelled: "Ca1" }[state]);
  }
});
test("word wrapping, oversized words and ellipsis only when summary space runs out", () => {
  const render = (task: string) => panelLines([{ ...job, task }], 20, 1000).slice(2, -1);
  expect(render("Correcting memory recovery when Pi reloads")).toEqual([" Correcting memory", " recovery when Pi..."]);
  expect(render("Correcting memory recovery")).toEqual([" Correcting memory", " recovery"]);
  expect(render("x".repeat(25))).toEqual([" " + "x".repeat(19), " " + "x".repeat(6)]);
  expect(render("x".repeat(60)).at(-1)).toBe(" " + "x".repeat(16) + "...");
  for (const width of [1, 2, 4, 20, 42]) expect(panelLines([{ ...job, task: "x".repeat(60) }], width).every(l => l.length <= width)).toBe(true);
});
test("viewport budget retains whole blocks and prioritizes active and attention over completed", () => {
  const jobs = [
    { ...job, agent: "deck-completed", state: "completed", ended: 2000 },
    { ...job, agent: "deck-apply-fast", task: "Correcting memory recovery when Pi reloads and restoring the original session" },
    { ...job, agent: "deck-quality", state: "failed", task: "Checking the native viewport and focus through scrolling" },
  ] as Job[];
  const lines = panelLines(jobs, 42, 1000);
  expect(lines.length).toBeLessThanOrEqual(11);
  expect(lines.join("\n")).toContain("Apply Fast"); expect(lines.join("\n")).not.toContain("Quality");
  expect(lines.join("\n")).toContain("Co1"); expect(lines.join("\n")).toContain("Fa1"); expect(lines.join("\n")).not.toContain("more");
  expect(lines.filter(l => l.includes("00:00:00"))).toHaveLength(1);
});
test("result delivery and Lead integration stay distinct; short titles replace internal prompts", () => {
  const ready = { ...job, title: "Memory recovery", task: "INTERNAL_ASSIGNMENT_DO_NOT_RENDER", state: "completed", ended: 2000, outcomeId: "outcome", integration: "pending" } as Job;
  const render = (extra: Partial<Job>) => panelLines([{ ...ready, ...extra }], 42).join("\n");
  expect(render({})).toContain("Le1"); expect(render({})).not.toContain("Memory recovery");
  expect(render({})).not.toContain("INTERNAL_ASSIGNMENT");
  expect(render({ integration: "reviewing" })).toContain("Re1");
  expect(render({ integration: "integrated" })).toContain("In1");
  expect(render({ deliveryBlocked: true })).toContain("De1");
  expect(render({ admitted: true, reminded: true })).toContain("Ac1");
});
