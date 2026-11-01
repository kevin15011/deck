import assert from "node:assert/strict";

/** Read textual model input, never telemetry, tool schemas or arbitrary object fields. */
export function modelVisibleText(body: any): string {
  const text: string[] = typeof body.instructions === "string" ? [body.instructions] : [];
  if (typeof body.input === "string") text.push(body.input);
  else if (Array.isArray(body.input)) for (const item of body.input) {
    if (item?.type !== "message") continue;
    if (typeof item.content === "string") text.push(item.content);
    else if (Array.isArray(item.content)) for (const part of item.content) {
      if (["input_text", "output_text"].includes(part?.type) && typeof part.text === "string") text.push(part.text);
    }
  }
  return text.join("\n");
}

/** Metadata identifies the native request phase; it never proves context delivery. */
export function codexRequestPhase(body: any): "startup" | "prior-history" | "resumed-task" {
  const encoded = body.client_metadata?.["x-codex-turn-metadata"];
  assert.equal(typeof encoded, "string", "missing native request phase");
  const meta = JSON.parse(encoded);
  if (meta.request_kind === "turn" && meta.compaction == null) {
    if (meta.history_initialization === "new") return "startup";
    if (meta.history_initialization === "cold_resume") return "resumed-task";
  }
  if (meta.request_kind === "compaction" && meta.history_initialization === "cold_resume" && meta.compaction?.phase === "pre_turn") return "prior-history";
  throw new Error("unknown native request phase");
}

type Project = { root: string; scope: string };
export function assertCodexContextSequence(startup: any[], resumed: any[], expected: {
  prior: Project; current: Project; required: string[]; forbidden?: string[]; memoryEnabled: boolean;
}) {
  assert(startup.length > 0, "missing startup task request");
  let compacted = false, continued = false;
  const check = (body: any, phase: ReturnType<typeof codexRequestPhase>) => {
    const text = modelVisibleText(body);
    const project = phase === "resumed-task" ? expected.current : expected.prior;
    const context = {
      phase, required: expected.required.every(value => text.includes(value)),
      excluded: (expected.forbidden ?? []).every(value => !text.includes(value)),
      project: text.includes(project.root), memoryScope: text.includes(project.scope),
    };
    assert(context.required, `${phase}: missing required role context`);
    assert(context.excluded, `${phase}: forbidden role context`);
    assert(context.project, `${phase}: missing project context`);
    assert(!expected.memoryEnabled || context.memoryScope, `${phase}: missing memory scope`);
    return context;
  };
  const checks = startup.map(body => {
    assert.equal(codexRequestPhase(body), "startup", "unexpected startup phase");
    return check(body, "startup");
  });
  for (const body of resumed) {
    const phase = codexRequestPhase(body);
    if (phase === "prior-history") {
      assert(!continued, "compaction after rebuilt task request");
      compacted = true;
    } else {
      assert.equal(phase, "resumed-task", "unexpected resumed phase");
      assert(compacted, "missing pre-turn history compaction");
      continued = true;
    }
    checks.push(check(body, phase));
  }
  assert(compacted, "missing pre-turn history compaction");
  assert(continued, "missing rebuilt task request");
  return checks;
}
