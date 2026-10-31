import { validateCodebaseAvailability } from "@deck/core/session/codebase-availability";
import { isCodebaseMemoryEnabled, type NormalizedDeckConfig } from "@deck/core";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { NativeSkillsDescriptor } from "@deck/core/session/driver";

export const SESSION_SKILLS_PLUGIN_NAME = "deck-developer-team";
export const skillHash = (text: string) => createHash("sha256").update(text).digest("hex");
export class ClaudeSkillsError extends Error {
  readonly code = "claude-session-skills-unverified";
  readonly finding: import("@deck/core/session/driver").RunnerPreparationFinding;
  constructor(readonly check = "unspecified") {
    super(`claude-session-skills-unverified: ${check}. Check private path permissions and selection binding, then prepare again; originals are preserved.`);
    this.finding = { kind: "B", code: this.code, item: check, message: this.message };
  }
}

/** Recheck the selection and exact canonical plugin file set immediately before every child launch. */
export function verifyClaudeSessionSkills(value: NativeSkillsDescriptor): void {
  let check = "descriptor";
  try {
    if (value.pluginName !== SESSION_SKILLS_PLUGIN_NAME || !/^[a-f0-9]{64}$/.test(value.contentHash)) throw new Error();
    check = "ancestor-permissions";
    for (const target of [value.root, dirname(value.selectionPath), ...(value.sourceSelection ? [dirname(value.sourceSelection.path)] : [])]) {
      let path = target;
      for (;;) {
        const stat = lstatSync(path);
        if (!stat.isDirectory() || (stat.mode & 0o022) !== 0 && !(stat.uid === 0 && (stat.mode & 0o1000) !== 0) || typeof process.getuid === "function" && stat.uid !== process.getuid() && stat.uid !== 0) throw new Error();
        const parent = dirname(path);
        if (parent === path) break;
        path = parent;
      }
    }
    const readPrivate = (path: string) => {
      check = "private-file-permissions";
      const stat = lstatSync(path);
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error();
      return readFileSync(path, "utf8");
    };
    if (value.sourceSelection) {
      check = "source-selection-changed";
      if (skillHash(readPrivate(value.sourceSelection.path)) !== value.sourceSelection.hash) throw new Error();
    }
    const selection = readPrivate(value.selectionPath);
    check = "selection-digests";
    if (skillHash(selection) !== value.selectionHash || JSON.parse(selection).contentHash !== value.contentHash) throw new Error();
    const observed: Record<string, string> = {};
    const walk = (path: string) => {
      for (const name of readdirSync(path)) {
        const file = join(path, name), key = relative(value.root, file);
        const stat = lstatSync(file);
        check = "plugin-file-set-and-permissions";
        if (stat.isDirectory()) {
          if ((stat.mode & 0o077) !== 0 || !Object.keys(value.files).some(k => k.startsWith(key + "/"))) throw new Error();
          walk(file);
        } else {
          if (!Object.hasOwn(value.files, key)) throw new Error();
          observed[key] = skillHash(readPrivate(file));
        }
      }
    };
    walk(value.root);
    check = "plugin-file-digests";
    if (JSON.stringify(Object.entries(observed).sort()) !== JSON.stringify(Object.entries(value.files).sort())) throw new Error();
    const identity = JSON.parse(readPrivate(join(value.root, ".claude-plugin/plugin.json")));
    check = "plugin-identity";
    if (identity.name !== SESSION_SKILLS_PLUGIN_NAME) throw new Error();
  } catch { throw new ClaudeSkillsError(check); }
}

/** A native capability denial must be paired with its exact managed replacement. */
export function claudeSessionOverrideDenials(value: NativeSkillsDescriptor, overrides: readonly string[]): string[] {
  if (overrides.some(id => id !== "codebase-memory")) throw new Error("session-capability-override-unlisted");
  const config = Object.hasOwn(value.files, ".mcp.json") ? JSON.parse(readFileSync(join(value.root, ".mcp.json"), "utf8")) : { mcpServers: {} };
  if (Object.keys(config.mcpServers ?? {}).some(id => ["serena", "context-mode", "web-search"].includes(id))) throw new Error("claude-session-generation-unverified");
  if (overrides.some(id => !Object.hasOwn(config.mcpServers ?? {}, id))) throw new Error("claude-mcp-override-unpaired");
  return overrides.map(id => `plugin:${value.pluginName}:${id}`);
}

/** Trusted host intent, rechecked at admission and immediately before supervised spawn. */
export function validateClaudeSessionIntent(value: NativeSkillsDescriptor, config: NormalizedDeckConfig): void {
  verifyClaudeSessionSkills(value);
  const selected = JSON.parse(readFileSync(value.selectionPath, "utf8"));
  if (selected.capabilities?.includes("rtk") && config.packageInstructions.claude?.rtk !== true)
    throw new ClaudeSkillsError("rtk-intent-changed");
  if (selected.capabilities?.includes("codebase-memory") && !isCodebaseMemoryEnabled(config, "claude"))
    throw new Error("claude-codebase-memory-selection-stale: Review and publish a replacement Claude generation before launching.");
  if (selected.capabilities?.includes("web-search") === true && !config.webSearch.enabled)
    throw new Error("claude-web-search-selection-stale: Review and publish a replacement Claude generation before launching.");
}

/** Shared native/session omission policy. Availability never excuses generation or intent checks. */
export function claudeCodebaseDenials(input: {
  skills: NativeSkillsDescriptor; projectRoot: string; invocationId: string;
  route: "native" | "managed"; overrides: readonly string[];
  availability?: import("@deck/core/session/codebase-availability").CodebaseAvailabilityDisposition;
}): string[] {
  verifyClaudeSessionSkills(input.skills);
  const paired = claudeSessionOverrideDenials(input.skills, input.overrides);
  if (!input.availability) return paired;
  validateCodebaseAvailability(input.availability, input);
  const selected = JSON.parse(readFileSync(input.skills.selectionPath, "utf8"));
  if (!selected.capabilities?.includes("codebase-memory") || input.overrides.includes("codebase-memory")) throw new Error("codebase-availability-evidence-invalid");
  // This also verifies the exact installed declaration exists. Never deny a same-name user server.
  return claudeSessionOverrideDenials(input.skills, ["codebase-memory"]);
}
