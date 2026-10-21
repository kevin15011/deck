/** Private daemon-owned project registry and bounded, home-confined folder discovery. */
import { createHash } from "node:crypto";
import { existsSync, opendirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertPrivateFile, writePrivateFile } from "./paths";

export type WorkspaceProject = { projectId: string; path: string; name: string; createdAt: string; available: boolean };
export type ProjectTrust = { projectId: string; projectRoot: string; trusted: boolean; revision: number };
type StoredProject = Omit<WorkspaceProject, "available"> & { hidden?: boolean; opencodeTrust?: { trusted: boolean; revision: number } };
type ProjectMutation =
  | { type: "project.register"; commandId: string; path: string; name?: string }
  | { type: "project.rename"; commandId: string; projectId: string; name: string }
  | { type: "project.remove"; commandId: string; projectId: string }
  | { type: "project.trust"; commandId: string; projectId: string; runnerId: "opencode"; trusted: boolean; expectedRevision: number };
type ProjectMutationData = { project: WorkspaceProject } | { projectId: string; removed: true };
type ProjectReceipt = { type?: ProjectMutation["type"]; fingerprint: string; project?: WorkspaceProject; data?: ProjectMutationData };
const MAX_PROJECTS = 1000;
const within = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
export const projectIdentity = (path: string) => `project-${createHash("sha256").update(path).digest("hex").slice(0, 24)}`;

export class ProjectStore {
  private readonly file: string;
  readonly home: string;
  private records: StoredProject[] = [];
  private registrations: Record<string, ProjectReceipt> = {};
  constructor(private readonly options: { stateRoot: string; home: string; now?: () => number }) {
    this.file = join(options.stateRoot, "projects.json");
    this.home = realpathSync(options.home);
    if (existsSync(this.file)) {
      assertPrivateFile(this.file);
      if (statSync(this.file).size > 16 * 1024 * 1024) throw new Error("project-store-too-large");
      const stored = JSON.parse(readFileSync(this.file, "utf8"));
      const value: unknown = Array.isArray(stored) ? stored : stored?.v === 1 ? stored.projects : undefined;
      if (!Array.isArray(value) || value.length > MAX_PROJECTS || !value.every(p => p && typeof p.path === "string" && isAbsolute(p.path) && p.projectId === projectIdentity(p.path) && typeof p.name === "string" && p.name.length <= 160 && typeof p.createdAt === "string" && (p.hidden === undefined || typeof p.hidden === "boolean") && (p.opencodeTrust === undefined || typeof p.opencodeTrust.trusted === "boolean" && Number.isSafeInteger(p.opencodeTrust.revision) && p.opencodeTrust.revision >= 1))) throw new Error("project-store-invalid");
      this.records = value;
      if (!Array.isArray(stored)) {
        if (!stored.registrations || typeof stored.registrations !== "object" || Array.isArray(stored.registrations) || Object.keys(stored.registrations).length > 1000) throw new Error("project-store-invalid");
        this.registrations = stored.registrations;
      }
    }
  }
  list(): WorkspaceProject[] { return this.records.filter(p => !p.hidden).map(p => this.view(p)); }
  get(projectId: string, includeHidden = false): WorkspaceProject | undefined { const project = this.records.find(p => p.projectId === projectId && (includeHidden || !p.hidden)); return project ? this.view(project) : undefined; }
  /** The daemon owns this registry; prepared sessions never memoize grant decisions. */
  projectTrust(projectId: string): ProjectTrust {
    const record = this.records.find(p => p.projectId === projectId);
    if (!record) throw new Error("project-unknown");
    return {projectId, projectRoot:record.path, trusted:record.opencodeTrust?.trusted === true && this.available(record.path), revision:record.opencodeTrust?.revision ?? 0};
  }
  register(path: string, name?: string, restore = true, persist = true): WorkspaceProject {
    const canonical = this.canonical(path);
    const entered = path === "~" ? this.home : path.startsWith("~/") ? join(this.home, path.slice(2)) : path;
    if (this.records.some(p => p.hidden && p.path === resolve(entered) && p.path !== canonical)) throw new Error("project-identity-changed");
    const known = this.records.find(p => p.projectId === projectIdentity(canonical) && p.path === canonical);
    // Explicit Add may restore an already-known hidden CLI root outside home. It cannot
    // enroll a new outside-home root or widen directory browsing.
    if (!within(this.home, canonical) && !(restore && known?.hidden)) throw new Error("project-outside-home");
    if (name !== undefined) this.validName(name);
    return this.remember(canonical, name?.trim(), restore, persist);
  }
  registerCommand(commandId: string, path: string, name?: string): { project: WorkspaceProject; duplicate?: true } {
    const result = this.executeCommand({ type: "project.register", commandId, path, ...(name === undefined ? {} : { name }) });
    return { ...(result.data as { project: WorkspaceProject }), ...(result.duplicate ? { duplicate: true } : {}) };
  }
  executeCommand(command: ProjectMutation): { data: ProjectMutationData; duplicate?: true } {
    // Revisionless clients cannot replay legacy authorization, even with a retained receipt.
    if (command.type === "project.trust" && (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0)) throw new Error("project-trust-invalid");
    // Keep the original registration fingerprint shape for receipts from older builds.
    const fingerprint = command.type === "project.register" ? JSON.stringify([command.path, command.name ?? null])
      : command.type === "project.rename" ? JSON.stringify([command.type, command.projectId, command.name]) : command.type === "project.trust" ? JSON.stringify([command.type, command.projectId, command.runnerId, command.trusted, command.expectedRevision]) : JSON.stringify([command.type, command.projectId]);
    const previous = Object.hasOwn(this.registrations, command.commandId) ? this.registrations[command.commandId] : undefined;
    if (previous) {
      if ((previous.type ?? "project.register") !== command.type || previous.fingerprint !== fingerprint) throw new Error("command-id-reused");
      return { data: structuredClone(previous.data ?? { project: previous.project! }), duplicate: true };
    }
    const oldRecords = structuredClone(this.records), oldReceipts = structuredClone(this.registrations);
    try {
      let data: ProjectMutationData;
      if (command.type === "project.register") data = { project: this.register(command.path, command.name, true, false) };
      else {
        const project = this.records.find(p => p.projectId === command.projectId);
        if (!project) throw new Error("project-unknown");
        if (command.type === "project.trust") {
          if (command.runnerId !== "opencode" || typeof command.trusted !== "boolean") throw new Error("project-trust-invalid");
          if (command.trusted && !this.available(project.path)) throw new Error("project-unavailable");
          const revision = project.opencodeTrust?.revision ?? 0;
          if (command.expectedRevision !== revision) throw new Error("project-trust-conflict");
          if (revision === Number.MAX_SAFE_INTEGER) throw new Error("project-trust-invalid");
          // Every accepted consent consumes its revision, including unchanged-state
          // revocation. The durable fence survives bounded command-receipt eviction.
          project.opencodeTrust = {trusted:command.trusted, revision:revision + 1};
          data = {project:this.view(project)};
        } else if (command.type === "project.rename") {
          this.validName(command.name); project.name = command.name.trim(); data = { project: this.view(project) };
        } else { project.hidden = true; data = { projectId: project.projectId, removed: true }; }
      }
      this.registrations[command.commandId] = { type: command.type, fingerprint, data };
      const keys = Object.keys(this.registrations);
      for (let i = 0; i < keys.length - 1000; i++) delete this.registrations[keys[i]!];
      // Mutation and replay receipt commit together, including an explicit restoration.
      this.save();
      return { data };
    } catch (error) { this.records = oldRecords; this.registrations = oldReceipts; throw error; }
  }
  private validName(name: string): void { if (!name.trim() || name.length > 160 || /[\x00-\x1f]/.test(name)) throw new Error("project-name-invalid"); }
  private view(record: StoredProject): WorkspaceProject { const { hidden: _hidden, opencodeTrust: _trust, ...project } = record; return { ...project, available: this.available(project.path) }; }
  /** Import old session roots, including unavailable directories, without widening folder browsing. */
  importLegacy(path: string): WorkspaceProject {
    if (!isAbsolute(path) || path.length > 4096 || path.includes("\0")) throw new Error("project-path-invalid");
    // Session roots were canonicalized at creation. Re-resolving a replaced path would
    // silently change project identity and memory scope when it became a symlink.
    return this.remember(resolve(path));
  }
  directories(input: { path?: unknown; prefix?: unknown; limit?: unknown }): { root: string; path: string; directories: { name: string; path: string }[]; truncated: boolean } {
    if (input.path !== undefined && typeof input.path !== "string" || input.prefix !== undefined && typeof input.prefix !== "string" || input.limit !== undefined && (!Number.isInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 100)) throw new Error("directory-query-invalid");
    const raw = (input.path as string | undefined) ?? "~/";
    const path = this.canonical(raw);
    if (!within(this.home, path)) throw new Error("directory-outside-home");
    const prefix = (input.prefix as string | undefined) ?? "";
    if (prefix.length > 255 || /[/\\\x00]/.test(prefix)) throw new Error("directory-prefix-invalid");
    const limit = (input.limit as number | undefined) ?? 40;
    const directories: { name: string; path: string }[] = [];
    const dir = opendirSync(path);
    let scanned = 0, truncated = false;
    try {
      for (;;) {
        const entry = dir.readSync();
        if (!entry) break;
        if (++scanned > 2000) { truncated = true; break; }
        if (!entry.name.startsWith(prefix) || !prefix.startsWith(".") && entry.name.startsWith(".") || /[\x00-\x1f]/.test(entry.name)) continue;
        const child = join(path, entry.name);
        try {
          const target = realpathSync(child);
          if (!within(this.home, target) || !statSync(target).isDirectory()) continue;
          if (directories.length === limit) { truncated = true; break; }
          directories.push({ name: entry.name, path: child });
        } catch { /* Inaccessible or dangling entries are not suggestions. */ }
      }
    } finally { dir.closeSync(); }
    directories.sort((a, b) => a.name.localeCompare(b.name));
    return { root: this.home, path, directories, truncated };
  }
  private canonical(path: string): string {
    if (typeof path !== "string" || !path || path.length > 4096 || path.includes("\0")) throw new Error("project-path-invalid");
    const expanded = path === "~" ? this.home : path.startsWith("~/") ? join(this.home, path.slice(2)) : path;
    if (!isAbsolute(expanded)) throw new Error("project-path-invalid");
    const canonical = realpathSync(expanded);
    if (!statSync(canonical).isDirectory()) throw new Error("project-not-directory");
    return canonical;
  }
  private available(path: string): boolean { try { return realpathSync(path) === path && statSync(path).isDirectory(); } catch { return false; } }
  private remember(path: string, name?: string, restore = false, persist = true): WorkspaceProject {
    const projectId = projectIdentity(path);
    let record = this.records.find(p => p.projectId === projectId);
    if (!record) {
      if (this.records.length >= MAX_PROJECTS) throw new Error("project-limit");
      record = { projectId, path, name: name ?? basename(path).replace(/[\x00-\x1f]/g, " ").slice(0, 160), createdAt: new Date((this.options.now ?? Date.now)()).toISOString() };
      this.records.push(record);
      if (persist) this.save();
    } else {
      const changed = name !== undefined && record.name !== name || restore && record.hidden;
      if (name !== undefined) record.name = name;
      if (restore) delete record.hidden;
      if (changed && persist) this.save();
    }
    return this.view(record);
  }
  private save() { writePrivateFile(this.file, JSON.stringify({ v: 1, projects: this.records, registrations: this.registrations })); }
}
