// Test-only global Pi extension (plain JS so Pi's loader needs no TypeScript): a scripted "faux" provider.
// FAUX_SCRIPT selects the lead behavior: "delegate" calls the Deck `subagent` tool, anything else answers text.
// FAUX_CHILD_TOOL/FAUX_CHILD_TOOL_INPUT make a child call one tool first. Children (DECK_PI_CHILD=1) answer with their role so the lead can prove which child ran.
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import fs from "node:fs";

export default function (pi) {
  const core = createFauxCore({ api: "faux-cli", provider: "faux", models: [{ id: "faux-1", name: "Faux 1" }] });
  pi.on("session_start", () => { if (process.env.FAUX_READY_FILE && process.env.DECK_PI_CHILD !== "1") fs.writeFileSync(process.env.FAUX_READY_FILE, "ready"); });
  const log = (entry) => { if (process.env.FAUX_LOG) fs.appendFileSync(process.env.FAUX_LOG, `${JSON.stringify(entry)}\n`); };
  pi.registerProvider("faux", {
    name: "faux", baseUrl: "http://127.0.0.1:1", apiKey: "x", api: "faux-cli",
    streamSimple: (model, context, options) => {
      const child = process.env.DECK_PI_CHILD === "1";
      const hasResult = context.messages.some((message) => message.role === "toolResult");
      log({ child, role: process.env.DECK_PI_ROLE, roles: context.messages.map((message) => message.role), text: JSON.stringify(context.messages), system: context.systemPrompt ?? "" });
      const textBlocks = context.messages.flatMap(message => typeof message.content === "string" ? [message.content] : (message.content ?? []).map(block => block.text ?? ""));
      const board = textBlocks.map(text => /DECK_PI_TASK_BOARD\n([^\n]+)\nEND_DECK_PI_TASK_BOARD/.exec(text)).find(Boolean);
      const jobs = board ? JSON.parse(board[1]).jobs : [];
      const pending = jobs.find(job => job.outcomeId && ["pending", "reviewing"].includes(job.integration));
      let reply;
      if (process.env.FAUX_SCRIPT === "tool" && !hasResult) reply = fauxAssistantMessage([fauxToolCall(process.env.FAUX_TOOL, JSON.parse(process.env.FAUX_TOOL_INPUT ?? "{}"))], { stopReason: "toolUse" });
      else if (child && process.env.FAUX_CHILD_TOOL && !hasResult) reply = fauxAssistantMessage([fauxToolCall(process.env.FAUX_CHILD_TOOL, JSON.parse(process.env.FAUX_CHILD_TOOL_INPUT ?? "{}"))], { stopReason: "toolUse" });
      else if (child && process.env.FAUX_CHILD_FAIL === "1") reply = fauxAssistantMessage("SCRIPTED_FAILURE", { stopReason: "error", errorMessage: "Scripted child failure" });
      else if (child) reply = fauxAssistantMessage(`CHILD_OK ${process.env.DECK_PI_ROLE}`);
      else if (process.env.FAUX_SCRIPT === "delegate" && !hasResult) reply = fauxAssistantMessage([fauxToolCall("subagent", JSON.parse(process.env.FAUX_DELEGATE ?? "{}"))], { stopReason: "toolUse" });
      else if (pending?.integration === "pending") reply = fauxAssistantMessage([fauxToolCall("subagent", { action: "review", taskId: pending.taskId })], { stopReason: "toolUse" });
      else if (pending) reply = fauxAssistantMessage([fauxToolCall("subagent", { action: "resolve", taskId: pending.taskId, outcomeId: pending.outcomeId, disposition: "integrated", summary: "Faux integration fixture inspected the report" })], { stopReason: "toolUse" });
      else reply = fauxAssistantMessage(process.env.FAUX_REPLY ?? (jobs.some(job => ["queued", "running"].includes(job.execution)) ? "LEAD_AVAILABLE" : "LEAD_DONE"));
      const delay = child ? Number(process.env.FAUX_CHILD_DELAY_MS ?? 0) : hasResult && !pending ? Number(process.env.FAUX_PARENT_DELAY_MS ?? 0) : 0;
      core.setResponses([delay ? async () => { await new Promise(resolve => setTimeout(resolve, delay)); return reply; } : reply]);
      return core.streamSimple(model, context, options);
    },
    models: [{ id: "faux-1", name: "Faux 1", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }],
  });
}
