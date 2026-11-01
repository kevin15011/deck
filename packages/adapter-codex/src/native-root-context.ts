import type { RunnerLaunchInput, RunnerLaunchPlan } from "@deck/core";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareCodexNativeRole } from "./native-role";
import { CODEX_ROOT_LEAD_BOOTSTRAP } from "./role-bootstrap";

/** Codex persists a trusted project entry on first startup. That native bookkeeping
 * is not a role generation change; all other config, role, skill and hook inputs are. */
export function readCodexRootGeneration(codexHome: string): string {
  const role = prepareCodexNativeRole(codexHome, "deck-lead");
  const fd = openSync(join(role.source.root, "config.toml"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let source: string;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("codex-session-generation-unverified");
    const bytes = Buffer.alloc(1024 * 1024 + 1), size = readSync(fd, bytes, 0, bytes.length, 0);
    if (size !== stat.size) throw new Error("codex-session-generation-unverified");
    source = bytes.subarray(0, size).toString("utf8");
  } finally { closeSync(fd); }
  if (createHash("sha256").update(source).digest("hex") !== role.source.files["config.toml"]) throw new Error("codex-session-generation-unverified");
  const config = Bun.TOML.parse(source) as Record<string, any>;
  if (config.projects && typeof config.projects === "object") {
    for (const [path, project] of Object.entries(config.projects) as [string, any][]) {
      if (project?.trust_level === "trusted" && Object.keys(project).length === 1) delete config.projects[path];
    }
    if (Object.keys(config.projects).length === 0) delete config.projects;
  }
  return JSON.stringify({ ...role, preparation: undefined, source: { ...role.source, files: { ...role.source.files,
    "config.toml": createHash("sha256").update(JSON.stringify(config)).digest("hex"),
  } } });
}

/** Only Deck-created roots acquire this receipt. It stores identity, never a
 * transcript or historical CLI override. Unknown/pre-receipt sessions stay native. */
export function withCodexRootContext(plan: RunnerLaunchPlan, input: RunnerLaunchInput, codexHome: string): RunnerLaunchPlan {
  if (input.teamId !== "developer-team") return plan;
  const role = prepareCodexNativeRole(codexHome, "deck-lead");
  if (!role.hooks.some(hook => hook.event === "sessionStart") || role.preparation?.some(finding => ["codex-hooks-preserved", "codex-refresh-deferred"].includes(finding.code))) return plan;
  const directory = join(role.source.root, "deck/root-sessions");
  const generation = readCodexRootGeneration(codexHome);
  const bootstrap = createHash("sha256").update(CODEX_ROOT_LEAD_BOOTSTRAP).digest("hex");
  const fresh = input.mode === "exec" || input.mode === "interactive";
  let boundSession: string | undefined;
  const privateDirectory = () => {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.mode & 0o077 || typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("codex-root-receipt-untrusted");
  };
  const readReceipt = (path: string, sessionId: string) => {
    privateDirectory();
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 4096 || stat.mode & 0o077 || typeof process.getuid === "function" && stat.uid !== process.getuid()) return false;
      const bytes = Buffer.alloc(4097), size = readSync(fd, bytes, 0, bytes.length, 0), after = fstatSync(fd);
      if (size !== stat.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) return false;
      const receipt = JSON.parse(bytes.subarray(0, size).toString("utf8"));
      return receipt.version === 1 && receipt.sessionId === sessionId && receipt.teamId === "developer-team"
        && receipt.roleId === "deck-lead" && receipt.bootstrap === bootstrap
        && typeof receipt.createdGeneration === "string" && /^[a-f0-9]{64}$/.test(receipt.createdGeneration);
    } finally { closeSync(fd); }
  };
  // Preserve durable native developer instructions. The verified hook composes
  // the bootstrap alongside them instead of replacing the whole native field.
  const args = plan.args.filter((arg, index, all) => !(arg === "-c" && all[index + 1] === `developer_instructions=${JSON.stringify(CODEX_ROOT_LEAD_BOOTSTRAP)}`)
    && arg !== `developer_instructions=${JSON.stringify(CODEX_ROOT_LEAD_BOOTSTRAP)}`);
  return { ...plan, args, nativeSessionStartContext(event) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(event.sessionId) || !["startup", "resume", "compact"].includes(event.source)) return;
    if (boundSession && boundSession !== event.sessionId) return;
    if (input.mode === "resume-by-id" && input.sessionId !== event.sessionId) return;
    // Current installed role, skill and hook bytes must still match this launch.
    // A later launch may use a verified upgraded generation; the receipt retains
    // the original generation without pinning the session to obsolete content.
    if (readCodexRootGeneration(codexHome) !== generation) throw new Error("codex-session-generation-unverified");
    const path = join(directory, `${event.sessionId}.json`);
    if (fresh && !boundSession) {
      if (event.source !== "startup") return;
      mkdirSync(directory, { mode: 0o700, recursive: true }); privateDirectory();
      writeFileSync(path, JSON.stringify({ version: 1, sessionId: event.sessionId, teamId: "developer-team", roleId: "deck-lead",
        bootstrap, createdGeneration: role.generation, projectRoot: realpathSync(input.projectRoot) }), { flag: "wx", mode: 0o600 });
    } else {
      if (!boundSession && event.source !== "resume") return;
      try { if (!readReceipt(path, event.sessionId)) return; } catch { return; }
    }
    boundSession = event.sessionId;
    return CODEX_ROOT_LEAD_BOOTSTRAP;
  } };
}
