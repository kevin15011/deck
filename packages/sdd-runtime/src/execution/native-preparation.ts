import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, openSync, readFileSync, readSync, realpathSync, writeSync } from "node:fs";
import { assertNoContributionSymlink } from "../../../core/src/runner-contributions";
import { dirname, join } from "node:path";
import { loadPreparedSessionStartRecord } from "@deck/core/session/start-context";
import { parsePreparationRequest, type PreparationDelegation, type PreparationEffectRecord, type PreparationScope } from "@deck/core/session/preparation";
import { ProjectPreparationService } from "./project-preparation";
export type NativePreparationBinding = { parentId: string; taskId: string; attempt: number; roleId: string; generation: string; launchId: string; nativeSessionId: string; current(): boolean };

/** Parent-owned coordinator. Child messages cannot select a role, scope or delegation. */
export class NativePreparationCoordinator {
  private readonly service: ProjectPreparationService;
  private readonly delegations = new Map<string, PreparationDelegation>();
  private scope?: PreparationScope;
  private configDigest?: string;
  private journal?: string;
  private parent?: string;
  constructor(private readonly environment: Readonly<Record<string, string | undefined>>, private readonly runnerId: string, provider?: import("@deck/core").SkillDiscoverySourceProviderV1) {
    this.service = new ProjectPreparationService(provider ? { registryProvider: id => id === runnerId ? provider : undefined } : {});
  }
  private config() {
    const file = join(this.environment.XDG_CONFIG_HOME ?? join(this.environment.HOME ?? "", ".config"), "deck/config.json");
    try { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error; }
  }
  close() { this.scope = undefined; this.parent = undefined; this.delegations.clear(); }
  async open(root: string, parent: string, parentFile: string) {
    this.close();
    const digest = this.config();
    const record = await loadPreparedSessionStartRecord(root, this.environment);
    if (!record?.preparation || this.config() !== digest || record.preparation.scope.projectRoot !== realpathSync(root)
      || record.preparation.scope.epoch !== record.epoch || record.preparation.scope.members.some(m => m.runnerId !== this.runnerId)) throw new Error("native-preparation-scope-unavailable");
    this.configDigest = digest; this.scope = record.preparation.scope; this.parent = parent;
    this.journal = `${parentFile}.deck-preparation.jsonl`;
    const records = this.records();
    for (const reconciled of this.service.reconcile(this.scope, records)) this.record(reconciled);
    await this.service.prepareRegistryEvidence(this.scope, this.runnerId);
    return this.service.status(this.scope);
  }
  private current() {
    if (!this.scope || this.config() !== this.configDigest) { this.close(); throw new Error("native-preparation-scope-revoked"); }
    return this.scope;
  }
  status() { return this.service.status(this.current()); }
  delegate(value: unknown, taskId: string, attempt: number) {
    const delegation = this.service.delegate(value, this.current(), { taskId, attempt });
    this.delegations.set(taskId, delegation);
  }
  validate(value: unknown, cwd: string) {
    const scope = this.current();
    if (realpathSync(cwd) !== scope.projectRoot) throw new Error("native-preparation-root-mismatch");
    return this.service.delegate(value, scope, { taskId: "validation", attempt: 1 });
  }
  async repair(binding: NativePreparationBinding, value: unknown) {
    const request = parsePreparationRequest(value), delegation = this.delegations.get(binding.taskId);
    if (!delegation || binding.roleId !== "deck-setup" || binding.parentId !== this.parent || binding.attempt !== delegation.attempt) throw new Error("native-preparation-delegation-unavailable");
    return this.service.repair(request, { delegation, ...binding, runnerId: this.runnerId,
      current: () => binding.current() && this.delegations.get(binding.taskId) === delegation && binding.parentId === this.parent ? this.current() : undefined,
      previous: () => this.records(), record: value => this.record(value),
    });
  }
  private file() {
    if (!this.journal) throw new Error("native-preparation-journal-unavailable");
    assertNoContributionSymlink(this.journal);
    const fd = openSync(this.journal, constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.mode & 0o077 || (process.getuid && stat.uid !== process.getuid()) || stat.size > 1024 * 1024) {
      closeSync(fd); throw new Error("native-preparation-journal-untrusted");
    }
    return fd;
  }
  private records(): PreparationEffectRecord[] {
    const fd = this.file();
    try {
      const size = fstatSync(fd).size, bytes = Buffer.alloc(size);
      if (readSync(fd, bytes, 0, size, 0) !== size) throw new Error("native-preparation-journal-changed");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text && !text.endsWith("\n")) throw new Error("native-preparation-journal-incomplete");
      return text.split("\n").filter(Boolean).map(line => {
        const record = JSON.parse(line);
        if (!["intent", "completed", "uncertain", "reconciled"].includes(record.state)
          || [record.effectId, record.delegationId, record.component, record.before, record.after].some(v => typeof v !== "string" || !v || v.length > 128)) throw new Error("native-preparation-journal-invalid");
        return record;
      });
    } finally { closeSync(fd); }
  }
  private record(value: PreparationEffectRecord) {
    const fd = this.file();
    try { const bytes = Buffer.from(JSON.stringify(value) + "\n"); if (writeSync(fd, bytes) !== bytes.length) throw new Error("native-preparation-journal-incomplete"); fsyncSync(fd);
      const directory = openSync(dirname(this.journal!), constants.O_RDONLY | constants.O_DIRECTORY);
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
    finally { closeSync(fd); }
  }
}
