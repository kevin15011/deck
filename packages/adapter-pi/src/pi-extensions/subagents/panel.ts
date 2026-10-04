import { truncateToVisualLines } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "../shared/pi-api";
import { clean, type Job } from "./jobs";

/** Preview is ASCII cell-safe; full Unicode reports remain available through inspect. */
const preview = (s: string, width: number) => clean(s).replace(/\s+/g, " ").replace(/[^\x20-\x7e]/g, "?").slice(0, Math.max(0, width));
// ASCII normalization deliberately keeps one character equal to one terminal cell.
function wrapPreview(text: string, width: number, maxLines: number): string[] {
  const words = preview(text, Infinity).trim().split(/ +/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let word of words) {
    if (line && line.length + 1 + word.length > width) { lines.push(line); line = ""; }
    while (word.length > width) { lines.push(word.slice(0, width)); word = word.slice(width); }
    if (word) line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    const dots = ".".repeat(Math.min(3, width));
    lines[maxLines - 1] = lines[maxLines - 1]!.slice(0, width - dots.length).trimEnd() + dots;
  }
  return lines;
}

/** Collapsed native tool cards show a short status; raw reports are opt-in via expansion/details. */
export function toolCard(text: string, expanded = false) {
  return { invalidate() {}, render(width: number): string[] {
    const columns = Math.max(1, Math.floor(width));
    if (!expanded) return wrapPreview(text, columns, 2);
    const lines = clean(text, 48000).split("\n").flatMap(line => wrapPreview(line, columns, 50));
    return lines.length > 200 ? [...lines.slice(0, 199), "...".slice(0, columns)] : lines;
  } };
}

/** Execution and Lead disposition are separate aggregate dimensions. */
function panelCounts(jobs: Job[], theme?: Pick<import("@earendil-works/pi-coding-agent").Theme, "fg">, includeActive = false): string {
  const count = (label: string, color: "success" | "error" | "warning" | "accent" | "muted", predicate: (j: Job) => boolean, always = false) => {
    const n = jobs.filter(predicate).length;
    const text = n || always ? `${label}${n}` : "";
    return text && theme ? theme.fg(color, text) : text;
  };
  return [
    count("Co", "success", j => j.state === "completed", true),
    count("Fa", "error", j => j.state === "failed", true),
    count("In", "success", j => j.integration === "integrated", true),
    count("Bl", "warning", j => j.integration === "blocked" || (j.integration !== "integrated" && !j.outcomeId && ["failed", "interrupted"].includes(j.state)), true),
    count("Qu", "warning", j => j.state === "queued"),
    count("Le", "warning", j => j.integration === "pending"),
    count("Re", "accent", j => j.integration === "reviewing"),
    // Keep every two-letter label unique: In = integrated, It = interrupted.
    count("It", "warning", j => j.state === "interrupted"),
    count("Ca", "muted", j => j.state === "cancelled"),
    count("De", "warning", j => Boolean(j.deliveryBlocked && !j.admitted)),
    count("Ac", "warning", j => j.integration === "pending" && Boolean(j.reminded)),
    includeActive ? count("Ru", "accent", j => j.state === "running") : "",
    // Ca = cancelled; Cg preserves the distinct in-progress cancelling state.
    includeActive ? count("Cg", "warning", j => j.state === "cancelling") : "",
  ].filter(Boolean).join(" ");
}

export function panelLines(jobs: Job[], width: number, now = Date.now(), theme?: Pick<import("@earendil-works/pi-coding-agent").Theme, "fg">): string[] {
  width = Math.max(1, Math.floor(width));
  const contentWidth = Math.max(1, width - 1);
  const fg = (color: "accent" | "muted" | "success" | "warning" | "error", text: string) => text && theme ? theme.fg(color, text) : text;
  const lines = [fg("accent", preview(" SUBAGENTS", width))];
  const selected = jobs.filter(j => j.state === "running" || j.state === "cancelling");
  for (const j of selected) {
    const elapsed = Math.max(0, Math.floor(((j.ended ?? now) - (j.started ?? j.created)) / 1000));
    const duration = [Math.floor(elapsed / 3600), Math.floor(elapsed / 60) % 60, elapsed % 60].map(n => String(n).padStart(2, "0")).join(":");
    const name = j.agent.replace(/^deck-/, "").split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
    const event = j.activity.at(-1);
    // Only actual start evidence establishes an active stage, never silence or a report.
    const stage = event?.kind === "retry" && event.text.startsWith("auto_retry_start") ? "Retrying"
      : event?.kind === "tool" && event.text.includes("started") ? (/^(reading|editing|testing):/.exec(event.text)?.[1] ?? (/^read started/.test(event.text) ? "reading" : "working")) : "Working";
    const execution = j.state === "completed" ? "Done" : j.state.charAt(0).toUpperCase() + j.state.slice(1);
    const activity = j.state === "running" ? stage.charAt(0).toUpperCase() + stage.slice(1)
      : j.deliveryBlocked && !j.admitted ? `${execution} / Delivery`
      : j.integration === "pending" && j.reminded ? `${execution} / Act`
      : j.integration === "pending" ? `${execution} / Lead`
      : j.integration === "reviewing" ? `${execution} / Review`
      : j.integration === "integrated" ? "Integrated"
      : j.integration === "blocked" ? `${execution} / Blocked`
      : j.state === "completed" ? "Completed" : execution;
    const color = j.state === "running" ? "accent"
      : j.integration === "integrated" ? "success"
      : j.state === "failed" ? "error"
      : ["interrupted", "cancelled", "cancelling", "queued"].includes(j.state) ? "warning"
      : j.deliveryBlocked && !j.admitted || j.integration === "pending" || j.integration === "blocked" ? "warning"
      : j.integration === "reviewing" ? "accent"
      : j.state === "completed" ? "success" : "warning";
    // Allocate ASCII terminal cells before coloring; never slice ANSI sequences.
    // On tiny widths retain the state first, then the full clock, then the role.
    const state = preview(activity, contentWidth);
    const clock = contentWidth >= state.length + duration.length + 1 ? duration : "";
    const labelWidth = contentWidth - state.length - (clock ? clock.length + 1 : 0) - 1;
    const label = labelWidth > 0 ? wrapPreview(name, labelWidth, 1)[0] ?? "" : "";
    const segments = [fg("accent", label), fg("muted", clock), fg(color, state)].filter(Boolean);
    lines.push((width > 1 ? " " : "") + segments.join(" "));
    const summary = wrapPreview(j.title ?? j.task, contentWidth, selected.length > 2 ? 1 : 2);
    lines.push(...summary.map(line => fg("muted", width > 1 ? ` ${line}` : line)));
  }
  if (jobs.length) {
    const summary = panelCounts(jobs, theme);
    // Native Text sizing preserves ANSI. Overflow is explicit; the overlay visibility
    // guard switches to the complete status rather than hiding attention counters.
    const overflow = panelCounts(jobs).length > contentWidth;
    const row = overflow
      ? (contentWidth > 1 ? truncateToVisualLines(summary, 1, contentWidth - 1, 0, "start").visualLines[0] ?? "" : "") + fg("warning", "!")
      : summary;
    lines.push((width > 1 ? " " : "") + row);
  }
  return lines;
}
export function panelVisible(width: number, height: number, editor: string, minimized: boolean, mode: string) {
  const editorRows = editor.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length * 2 / Math.max(1, width - 4))), 0);
  return !minimized && mode === "fullscreen" && width >= 100 && height >= 24 && editorRows + 8 < height / 2;
}
export function jobDetails(j: Job): string {
  return clean(`${j.title ?? j.agent} | ${j.agent} | ${j.state}\nTask: ${j.id}\nAttempt: ${j.attempt ?? 1}\nOutcome ID: ${j.outcomeId ?? "not ready"}\nDelivery: ${j.admitted ? "admitted" : "pending"}\nLead integration: ${j.integration ?? "not ready"}\nFailure kind: ${j.failureKind ?? "none"}\nExit: ${j.exitCode ?? "not recorded"}${j.signal ? ` (${j.signal})` : ""}\nResolution: ${j.integrationNote ?? "none"}\nParent: ${j.parent}\nChild: ${j.childId}\nAssignment: ${j.task}\nStarted: ${j.started ? new Date(j.started).toISOString() : "not started"}\n\nObserved activity / untrusted reports:\n${j.activity.map(a => `${new Date(a.at).toISOString()} [${a.kind}] ${a.text}`).join("\n")}\n\nOutcome (untrusted):\n${j.output || "No final report"}`, 48000);
}

export class SubagentPanel {
  minimized = false;
  suspended = false;
  private stopOverlay?: () => void;
  private render?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private ctx?: ExtensionContext;
  private epoch = 0;
  constructor(private jobs: () => Job[], private persistencePending: () => boolean = () => false) {}
  open(ctx: ExtensionContext) {
    this.close(); this.ctx = ctx;
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    this.timer = setInterval(() => this.update(), 1000); this.timer.unref?.(); this.update();
    const epoch = this.epoch;
    // The zero-row host widget supplies Pi's existing renderer, not a transcript panel.
    // Own a native overlay handle so disposal cannot accidentally pop another extension's overlay.
    ctx.ui.setWidget("deck-subagent-overlay-host", (tui, theme) => {
      if (epoch !== this.epoch) return { render: () => [], invalidate() {} };
      this.render = () => tui.requestRender();
      if (tui.mode === "fullscreen") {
        const handle = tui.showOverlay({
          invalidate() {},
          render: width => panelLines(this.jobs(), width, Date.now(), theme),
        }, {
          anchor: "top-right", width: 42, maxHeight: 18, nonCapturing: true,
          margin: { top: 1, right: 1, bottom: 10 },
          visible: (w, h) => {
            const rows = panelLines(this.jobs(), 42).length;
            return this.jobs().length > 0 && panelCounts(this.jobs()).length <= 41 && rows <= Math.min(18, h - 11)
              && panelVisible(w, h, ctx.ui.getEditorText(), this.minimized || this.suspended, tui.mode);
          },
        });
        this.stopOverlay = () => handle.hide();
      }
      return { render: () => [], invalidate() {}, dispose: () => { if (epoch === this.epoch) { this.stopOverlay?.(); this.stopOverlay = undefined; } } };
    });
  }
  toggle() { this.minimized = !this.minimized; this.update(); }
  update() {
    if (!this.ctx?.hasUI) return;
    const jobs = this.jobs();
    try { this.ctx.ui.setStatus("deck-subagents", jobs.length ? `Subagents: ${panelCounts(jobs, undefined, true)}${this.persistencePending() ? " / state not saved" : ""}${this.minimized ? " (minimized)" : ""}` : undefined); } catch { /* UI failure cannot stop task delivery. */ }
    try { this.render?.(); } catch { /* A stale renderer must not escape the refresh timer. */ }
  }
  close() {
    this.epoch++; if (this.timer) clearInterval(this.timer); this.timer = undefined;
    this.stopOverlay?.(); this.stopOverlay = undefined; this.render = undefined;
    this.ctx?.ui.setStatus("deck-subagents", undefined);
    this.ctx?.ui.setWidget("deck-subagent-overlay-host", undefined); this.ctx = undefined;
  }
}
