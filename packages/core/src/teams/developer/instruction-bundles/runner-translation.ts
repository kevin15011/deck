import type { CapabilityInstructionBundle } from "./index";

/**
 * Runner-neutral translation engine for canonical package instructions.
 *
 * Canonical fragments were authored from upstream package documentation that
 * describes particular hosts' hooks. Each adapter that materializes them owns a
 * small rule table (sections replaced by heading, single lines replaced or
 * dropped) and calls this engine, so no runner vocabulary lives in core.
 */
export type InstructionSectionRule = { heading: RegExp; replacement: string };
export type InstructionLineRule = { match: RegExp; replacement: string | undefined };
export type InstructionTranslationRules = { sections: readonly InstructionSectionRule[]; lines: readonly InstructionLineRule[] };

function headingLevel(line: string): number {
  const match = /^(#{1,6})\s/.exec(line);
  return match ? match[1]!.length : 0;
}

function replaceSections(lines: string[], rules: readonly InstructionSectionRule[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const rule = rules.find((candidate) => candidate.heading.test(line));
    if (!rule) { out.push(line); continue; }
    const level = headingLevel(line);
    let end = index + 1;
    while (end < lines.length) {
      const next = headingLevel(lines[end]!);
      if (next > 0 && next <= level) break;
      end++;
    }
    out.push(...rule.replacement.replace(/\n$/, "").split("\n"));
    if (end < lines.length) out.push("");
    index = end - 1;
  }
  return out;
}

function translateMarkdown(markdown: string, rules: InstructionTranslationRules): string {
  const withSections = replaceSections(markdown.split("\n"), rules.sections);
  const out: string[] = [];
  for (const line of withSections) {
    const rule = rules.lines.find((candidate) => candidate.match.test(line));
    if (!rule) out.push(line);
    else if (rule.replacement !== undefined) out.push(rule.replacement);
  }
  return out.join("\n");
}

export function translateCapabilityInstructions(
  bundle: CapabilityInstructionBundle | undefined,
  rules: InstructionTranslationRules,
): CapabilityInstructionBundle | undefined {
  if (!bundle) return undefined;
  return {
    instructions: Object.freeze(bundle.instructions.map((fragment) => ({ ...fragment, markdown: translateMarkdown(fragment.markdown, rules) }))),
  };
}
