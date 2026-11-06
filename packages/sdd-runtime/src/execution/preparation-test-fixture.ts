import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreparationEffectRecord, PreparationInvocation, PreparationScope } from "@deck/core/session/preparation";
import { ProjectPreparationService } from "./project-preparation";

const dirs: string[] = [];
export function cleanupPreparationFixtures() { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); }
export function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "deck-preparation-"))); dirs.push(root); mkdirSync(join(root, "openspec"));
  const file = join(root, "openspec/config.yaml");
  writeFileSync(file, "schema: spec-driven\ntesting:\n  strict_tdd: true # old policy\n  commands:\n    test: bun test\n");
  const scope: PreparationScope = { projectRoot: root, sessionId: "s", epoch: "e", policyDigest: "p", members: [
    { memberId: "lead", runnerId: "claude", bindingId: "lead", capabilities: { "codebase-memory": { enabled: false } } },
    { memberId: "setup", runnerId: "claude", bindingId: "setup", capabilities: { "codebase-memory": { enabled: false } } },
    { memberId: "quality", runnerId: "codex", bindingId: "quality", capabilities: { "codebase-memory": { enabled: true } } },
  ] };
  const service = createPreparationService(root), snapshot = service.status(scope);
  const request = { snapshotId: snapshot.snapshotId, components: ["retired-testing-policy"] };
  const delegation = service.delegate(request, scope, { taskId: "setup-task", attempt: 1 });
  const records: PreparationEffectRecord[] = [];
  let active = true;
  const invocation: PreparationInvocation = { delegation, roleId: "deck-setup", generation: "g", runnerId: "claude", nativeSessionId: "native", launchId: "launch", current: () => active ? scope : undefined, record: r => { records.push(r); }, previous: () => records };
  return { service, snapshot, scope, request, invocation, records, file, revoke: () => { active = false; } };
}

export function createPreparationService(root: string, options: ConstructorParameters<typeof ProjectPreparationService>[0] = {}) {
  if (!dirs.includes(root)) throw new Error("preparation requires a private project fixture");
  return new ProjectPreparationService({ ...options, stateRoot: join(root, "private-state") });
}
