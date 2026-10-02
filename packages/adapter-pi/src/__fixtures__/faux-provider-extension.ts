/**
 * Test-only Pi extension factory (from the Phase 0 spike harness): registers a scripted "faux" provider so a real
 * Pi runtime can run end to end offline. Used by SDK contract tests via
 * `DefaultResourceLoader({ extensionFactories: [createFauxProviderExtension(...)] })`.
 */
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionFactory } from "../pi-extension-types";

export type FauxScriptStep =
  | { text: string }
  | { toolCall: { name: string; input: Record<string, unknown> }; text?: string };

export type FauxProviderExtensionOptions = {
  provider?: string;
  modelId?: string;
  /** Consumed in order; once exhausted the extension answers with `fallbackText`. */
  script?: FauxScriptStep[];
  fallbackText?: string;
  /** Observes every request Pi sends to the provider (roles and text per message). */
  onRequest?: (request: { roles: string[]; text: string }) => void;
};

export const FAUX_PROVIDER_ID = "faux";
export const FAUX_MODEL_ID = "faux-1";

export function createFauxProviderExtension(options: FauxProviderExtensionOptions = {}): ExtensionFactory {
  const provider = options.provider ?? FAUX_PROVIDER_ID;
  const modelId = options.modelId ?? FAUX_MODEL_ID;
  const script = [...(options.script ?? [])];
  return (pi) => {
    const core = createFauxCore({ api: "faux-deck-test", provider, models: [{ id: modelId, name: "Faux" }] });
    core.setResponses([]);
    pi.registerProvider(provider, {
      name: provider,
      baseUrl: "http://127.0.0.1:1",
      apiKey: "faux",
      api: "faux-deck-test",
      streamSimple: (model: never, context: { messages: Array<{ role: string; content: unknown }> }, streamOptions: never) => {
        options.onRequest?.({ roles: context.messages.map((message) => message.role), text: JSON.stringify(context.messages) });
        const hasToolResult = context.messages.some((message) => message.role === "toolResult");
        const step = hasToolResult ? undefined : script.shift();
        const message = step && "toolCall" in step
          ? fauxAssistantMessage([...(step.text ? [fauxText(step.text)] : []), fauxToolCall(step.toolCall.name, step.toolCall.input as never)], { stopReason: "toolUse" })
          : fauxAssistantMessage(step && "text" in step ? step.text : (options.fallbackText ?? "FAUX_REPLY_TEXT"));
        core.setResponses([message]);
        return core.streamSimple(model, context as never, streamOptions);
      },
      models: [{ id: modelId, name: "Faux", input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 4096 }],
    } as never);
  };
}
