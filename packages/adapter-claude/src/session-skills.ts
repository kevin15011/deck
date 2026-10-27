import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { NativeSkillsDescriptor } from "@deck/core/session/driver";

export const SESSION_SKILLS_PLUGIN_NAME = "deck-developer-team";
export const skillHash = (text: string) => createHash("sha256").update(text).digest("hex");
export class ClaudeSkillsError extends Error {
  readonly code = "claude-session-skills-unverified";
  constructor() { super("claude-session-skills-unverified: Sync the Claude Deck team generation before starting a session; its selection or team plugin could not be verified."); }
}

/** Recheck the selection and exact canonical plugin file set immediately before every child launch. */
export function verifyClaudeSessionSkills(value: NativeSkillsDescriptor): void {
  try {
    if (value.pluginName !== SESSION_SKILLS_PLUGIN_NAME || !/^[a-f0-9]{64}$/.test(value.contentHash)) throw new Error();
    for (const target of [value.root, dirname(value.selectionPath)]) {
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
      const stat = lstatSync(path);
      if (!stat.isFile() || (stat.mode & 0o077) !== 0 || typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error();
      return readFileSync(path, "utf8");
    };
    const selection = readPrivate(value.selectionPath);
    if (skillHash(selection) !== value.selectionHash || JSON.parse(selection).contentHash !== value.contentHash) throw new Error();
    const observed: Record<string, string> = {};
    const walk = (path: string) => {
      for (const name of readdirSync(path)) {
        const file = join(path, name), key = relative(value.root, file);
        const stat = lstatSync(file);
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
    if (JSON.stringify(Object.entries(observed).sort()) !== JSON.stringify(Object.entries(value.files).sort())) throw new Error();
    if (JSON.parse(readPrivate(join(value.root, ".claude-plugin/plugin.json"))).name !== SESSION_SKILLS_PLUGIN_NAME) throw new Error();
  } catch { throw new ClaudeSkillsError(); }
}

/** Plugin MCP must never bypass the session's routing, binding or suppression decisions.
 * Even an unselected plugin server is denied: absence from the child set is not fallback consent.
 * Call only after verifyClaudeSessionSkills has validated the complete generation.
 */
export function claudeSessionPluginMcpDenials(value: NativeSkillsDescriptor): string[] {
  if (!Object.hasOwn(value.files, ".mcp.json")) return [];
  const config = JSON.parse(readFileSync(join(value.root, ".mcp.json"), "utf8"));
  return Object.keys(config.mcpServers ?? {}).map(id => `plugin:${value.pluginName}:${id}`);
}
