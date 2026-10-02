import { posix } from "node:path";

import { renderGuardedExtensionEntry, type DeckPiExtensionScope } from "./pi-activation-guard";
import type { PiDesiredFile } from "./pi-global-install";

/** Deck-managed local Pi package, registered in global `settings.json` `packages` as a path relative to the agent dir. */
export const PI_PACKAGE_REL_ROOT = "deck/package";
export const PI_PROFILE_REL_ROOT = "deck/profiles";
export const DECK_PI_PACKAGE_NAME = "deck-pi-developer-team";

export type DeckPiPackageInput = {
  /** Agent markdown files delivered inside the package (`agents/<id>.md`); consumed by the Deck subagent extension. */
  agents: readonly { id: string; content: string }[];
  /** Skill package files relative to `skills/` (e.g. `deck-lead/SKILL.md`). */
  skills: readonly { relPath: string; content: string }[];
  /** Extension implementations (ESM bundles). Each is wrapped by a guard entry so it is inert outside Deck sessions. */
  extensions: readonly { name: string; implementation: string; scope?: DeckPiExtensionScope }[];
  /** Lead system prompt profile, materialized outside the package and passed via `--system-prompt`. */
  profile: { teamId: string; content: string };
};

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertIdentifier(kind: string, value: string): void {
  if (!IDENTIFIER.test(value) || value.includes("..")) throw new Error(`Invalid ${kind} identifier "${value}".`);
}

function assertPackagePath(relPath: string): void {
  const normalized = posix.normalize(relPath);
  if (!relPath || relPath.includes("\\") || relPath.includes("\0") || posix.isAbsolute(relPath) || normalized !== relPath || normalized.startsWith("../") || normalized === "..") {
    throw new Error(`Invalid package path "${relPath}": must be a normalized relative POSIX path.`);
  }
}

function packageManifest(): string {
  return `${JSON.stringify({
    name: DECK_PI_PACKAGE_NAME,
    version: "0.0.0",
    private: true,
    type: "module",
    description: "Deck developer team for Pi (managed by Deck; do not edit).",
    keywords: ["pi-package"],
    pi: { extensions: ["./extensions"], skills: ["./skills"], prompts: ["./prompts"] },
    peerDependencies: { "@earendil-works/pi-coding-agent": "*", "@earendil-works/pi-ai": "*" },
  }, null, 2)}\n`;
}

/**
 * Pure builder for every file Deck owns under the Pi agent directory. Paths are POSIX, relative to the agent dir.
 * Extensions are emitted as `extensions/<name>/index.js` (guard) + `impl.js` because Pi discovers only `x.js` and
 * `dir/index.js` (never `.mjs`).
 */
export function buildDeckPiPackageFiles(input: DeckPiPackageInput): PiDesiredFile[] {
  const files: PiDesiredFile[] = [];
  const add = (relPath: string, content: string) => files.push({ relPath, content });

  add(`${PI_PACKAGE_REL_ROOT}/package.json`, packageManifest());

  for (const agent of [...input.agents].sort((left, right) => (left.id < right.id ? -1 : 1))) {
    assertIdentifier("agent", agent.id);
    add(`${PI_PACKAGE_REL_ROOT}/agents/${agent.id}.md`, agent.content);
  }
  for (const skill of [...input.skills].sort((left, right) => (left.relPath < right.relPath ? -1 : 1))) {
    assertPackagePath(skill.relPath);
    add(`${PI_PACKAGE_REL_ROOT}/skills/${skill.relPath}`, skill.content);
  }
  for (const extension of [...input.extensions].sort((left, right) => (left.name < right.name ? -1 : 1))) {
    assertIdentifier("extension", extension.name);
    add(`${PI_PACKAGE_REL_ROOT}/extensions/${extension.name}/index.js`, renderGuardedExtensionEntry({ implFile: "./impl.js", scope: extension.scope }));
    add(`${PI_PACKAGE_REL_ROOT}/extensions/${extension.name}/impl.js`, extension.implementation);
  }
  // Pi has no Deck prompt templates yet; keep the declared directory present without adding a loadable template.
  add(`${PI_PACKAGE_REL_ROOT}/prompts/.gitkeep`, "");

  assertIdentifier("team", input.profile.teamId);
  add(`${PI_PROFILE_REL_ROOT}/${input.profile.teamId}/system-prompt.md`, input.profile.content);
  return files;
}
