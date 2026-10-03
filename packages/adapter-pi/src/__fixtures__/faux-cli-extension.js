// Test-only global Pi extension (plain JS so Pi's loader needs no TypeScript): a scripted "faux" provider.
// FAUX_SCRIPT selects the lead behavior: "delegate" calls the Deck `subagent` tool, anything else answers text.
// Children (DECK_PI_CHILD=1) answer with their role so the lead can prove which child ran.
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import fs from "node:fs";

export default function (pi) {
  const core = createFauxCore({ api: "faux-cli", provider: "faux", models: [{ id: "faux-1", name: "Faux 1" }] });
  const log = (entry) => { if (process.env.FAUX_LOG) fs.appendFileSync(process.env.FAUX_LOG, `${JSON.stringify(entry)}\n`); };
  pi.registerProvider("faux", {
    name: "faux", baseUrl: "http://127.0.0.1:1", apiKey: "x", api: "faux-cli",
    streamSimple: (model, context, options) => {
      const child = process.env.DECK_PI_CHILD === "1";
      const hasResult = context.messages.some((message) => message.role === "toolResult");
      log({ child, role: process.env.DECK_PI_ROLE, roles: context.messages.map((message) => message.role), text: JSON.stringify(context.messages), system: context.systemPrompt ?? "" });
      let reply;
      if (child) reply = fauxAssistantMessage(`CHILD_OK ${process.env.DECK_PI_ROLE}`);
      else if (process.env.FAUX_SCRIPT === "delegate" && !hasResult) reply = fauxAssistantMessage([fauxToolCall("subagent", JSON.parse(process.env.FAUX_DELEGATE ?? "{}"))], { stopReason: "toolUse" });
      else if (process.env.FAUX_SCRIPT === "tool" && !hasResult) reply = fauxAssistantMessage([fauxToolCall(process.env.FAUX_TOOL, JSON.parse(process.env.FAUX_TOOL_INPUT ?? "{}"))], { stopReason: "toolUse" });
      else reply = fauxAssistantMessage(process.env.FAUX_REPLY ?? "LEAD_DONE");
      core.setResponses([reply]);
      return core.streamSimple(model, context, options);
    },
    models: [{ id: "faux-1", name: "Faux 1", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }],
  });
}
