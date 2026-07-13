import { createHash, randomBytes } from "node:crypto";
import type { RunnerModelEntry, RunnerModelInventory, RunnerModelProvider } from "@deck/core";
import type { ModelDiscoveryFileSystem } from "./opencode-models-cli";
import type { OpenCodeDiscoveryContext } from "./model-discovery-context";

export const MODEL_INVENTORY_TTL_MS = 5 * 60_000;
export const MODEL_INVENTORY_LKG_MAX_AGE_MS = 24 * 60 * 60_000;
type Entry = { inventory: RunnerModelInventory; discoveredAt: number };
export type MemoryDiscovery = { inventory: RunnerModelInventory; discoveredAt: number; source: "memory" | "live" };

/** The in-process cache stores normalized runner data only, bounded to eight fingerprints. */
export class ModelInventoryCache {
  #entries = new Map<string, Entry>();
  #inFlight = new Map<string, Promise<MemoryDiscovery>>();
  #now: () => number;
  constructor(options?: { now?: () => number }) { this.#now = options?.now ?? Date.now; }
  async getOrDiscover(fingerprint: string, mode: "prefer-cache" | "rescan" | undefined, discover: () => Promise<RunnerModelInventory>, canCommit: () => boolean = () => true): Promise<MemoryDiscovery> {
    const existing = this.#entries.get(fingerprint);
    if (mode !== "rescan" && existing && this.#now() - existing.discoveredAt < MODEL_INVENTORY_TTL_MS) {
      this.#entries.delete(fingerprint); this.#entries.set(fingerprint, existing);
      return { ...existing, source: "memory" };
    }
    const inFlight = this.#inFlight.get(fingerprint);
    if (inFlight) return inFlight;
    const pending = discover().then((inventory) => {
      if (!canCommit()) throw { code: "timeout", message: "OpenCode model discovery timed out. Try again.", retryable: true };
      const entry = { inventory, discoveredAt: this.#now() };
      this.#entries.delete(fingerprint); this.#entries.set(fingerprint, entry);
      while (this.#entries.size > 8) this.#entries.delete(this.#entries.keys().next().value!);
      return { ...entry, source: "live" as const };
    }).finally(() => this.#inFlight.delete(fingerprint));
    this.#inFlight.set(fingerprint, pending); return pending;
  }
}

/** Hashes only the collector's safe schema-2 DTO, never process.env or secret-bearing source bytes. */
export async function buildDiscoveryFingerprint(input: OpenCodeDiscoveryContext): Promise<string> {
  const canonical = JSON.stringify(input);
  return createHash("sha256").update(canonical).digest("hex");
}

/** Keeps last-known-good snapshots segregated by the real runner and canonical project/workspace scope. */
export function buildLastKnownGoodScopeKey(input: { runnerRealPath: string; projectRoot: string; workspaceRoot: string }): string {
  return createHash("sha256").update(JSON.stringify({ schema: 2, runnerRealPath: input.runnerRealPath, projectRoot: input.projectRoot, workspaceRoot: input.workspaceRoot })).digest("hex");
}

type PersistedLastKnownGood = {
  schemaVersion: 1;
  source: "runner-resolved";
  fingerprint: string;
  discoveredAt: number;
  inventory: RunnerModelInventory;
};

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validToken(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value
    && Buffer.byteLength(value, "utf8") <= maxBytes && !/[\x00-\x1f\x7f]/.test(value);
}


function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

/** Reconstructs only the normalized DTO accepted from private on-disk storage. */
function normalizePersistedInventory(value: unknown): RunnerModelInventory | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!hasOnlyKeys(raw, ["providers", "modelsByProvider", "diagnostics"]) || !Array.isArray(raw.providers)
    || !raw.modelsByProvider || typeof raw.modelsByProvider !== "object" || Array.isArray(raw.modelsByProvider)
    || (raw.diagnostics !== undefined && (!Array.isArray(raw.diagnostics) || !raw.diagnostics.every((item) => typeof item === "string" && Buffer.byteLength(item, "utf8") <= 1024)))) return undefined;
  const providers: RunnerModelProvider[] = [];
  const providerIds = new Set<string>();
  for (const value of raw.providers) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const provider = value as Record<string, unknown>;
    if (!hasOnlyKeys(provider, ["id", "displayName", "source"]) || !validToken(provider.id, 512)
      || !validToken(provider.displayName, 1024) || provider.source !== "runner-resolved" || providerIds.has(provider.id)) return undefined;
    providerIds.add(provider.id);
    providers.push({ id: provider.id, displayName: provider.displayName, source: "runner-resolved" });
  }
  const rawModels = raw.modelsByProvider as Record<string, unknown>;
  if (Object.keys(rawModels).some((providerId) => !providerIds.has(providerId))) return undefined;
  const modelsByProvider: Record<string, RunnerModelEntry[]> = {};
  const modelIds = new Set<string>();
  for (const provider of providers) {
    const values = rawModels[provider.id] ?? [];
    if (!Array.isArray(values) || values.length > 10_000) return undefined;
    modelsByProvider[provider.id] = [];
    for (const value of values) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      const model = value as Record<string, unknown>;
      if (!hasOnlyKeys(model, ["id", "providerId", "modelId", "displayName", "supportsTools", "supportsReasoning", "variants", "metadataSource", "source"])
        || !validToken(model.id, 512) || !validToken(model.providerId, 512) || !validToken(model.modelId, 512)
        || !validToken(model.displayName, 4096) || model.providerId !== provider.id || model.id !== `${model.providerId}/${model.modelId}`
        || model.source !== "runner-resolved" || (model.metadataSource !== "runner" && model.metadataSource !== "runner+cache")
        || (model.supportsTools !== undefined && typeof model.supportsTools !== "boolean")
        || (model.supportsReasoning !== undefined && typeof model.supportsReasoning !== "boolean")
        || !Array.isArray(model.variants) || model.variants.length > 64 || !model.variants.every((variant) => validToken(variant, 128))
        || modelIds.has(model.id)) return undefined;
      modelIds.add(model.id);
      modelsByProvider[provider.id].push({
        id: model.id, providerId: model.providerId, modelId: model.modelId, displayName: model.displayName,
        variants: [...model.variants], metadataSource: model.metadataSource, source: "runner-resolved",
        ...(model.supportsTools === undefined ? {} : { supportsTools: model.supportsTools }),
        ...(model.supportsReasoning === undefined ? {} : { supportsReasoning: model.supportsReasoning }),
      });
    }
  }
  return { providers, modelsByProvider, ...(raw.diagnostics === undefined ? {} : { diagnostics: [...raw.diagnostics] }) };
}

/** Private, normalized, fingerprint-matched 24-hour last-known-good storage. */
export class LastKnownGoodStore {
  constructor(
    private readonly dependencies: { fs: ModelDiscoveryFileSystem; now: () => number },
    private readonly directory: string,
    private readonly scopeHash: string,
  ) {}

  private get path(): string { return `${this.directory}/${this.scopeHash}.json`; }

  private async isSafeRegularPath(path: string): Promise<boolean> {
    try {
      const entry = await this.dependencies.fs.lstat?.(path);
      return !entry || !entry.isSymbolicLink();
    } catch (error) {
      if (isNotFoundError(error)) return true;
      throw error;
    }
  }

  async read(fingerprint: string): Promise<{ inventory: RunnerModelInventory; discoveredAt: number } | undefined> {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) return undefined;
    try {
      if (!await this.isSafeRegularPath(this.directory) || !await this.isSafeRegularPath(this.path)) return undefined;
      const directoryStat = await this.dependencies.fs.stat(this.directory);
      if ((directoryStat.mode & 0o077) !== 0) return undefined;
      const stat = await this.dependencies.fs.stat(this.path);
      if ((stat.mode & 0o077) !== 0) return undefined;
      const body = await this.dependencies.fs.readFile(this.path);
      let parsed: unknown;
      try { parsed = JSON.parse(body); }
      catch { return undefined; }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
      const snapshot = parsed as Record<string, unknown>;
      if (!hasOnlyKeys(snapshot, ["schemaVersion", "source", "fingerprint", "discoveredAt", "inventory"])
        || snapshot.schemaVersion !== 1 || snapshot.source !== "runner-resolved" || snapshot.fingerprint !== fingerprint
        || typeof snapshot.discoveredAt !== "number" || !Number.isFinite(snapshot.discoveredAt)
        || snapshot.discoveredAt > this.dependencies.now() || this.dependencies.now() - snapshot.discoveredAt > MODEL_INVENTORY_LKG_MAX_AGE_MS) return undefined;
      const inventory = normalizePersistedInventory(snapshot.inventory);
      return inventory ? { inventory, discoveredAt: snapshot.discoveredAt } : undefined;
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      throw error;
    }
  }

  async write(fingerprint: string, inventory: RunnerModelInventory, discoveredAt: number): Promise<void> {
    const normalized = normalizePersistedInventory(inventory);
    if (!normalized || !/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isFinite(discoveredAt)
      || discoveredAt > this.dependencies.now() || this.dependencies.now() - discoveredAt > MODEL_INVENTORY_LKG_MAX_AGE_MS) return;
    const snapshot: PersistedLastKnownGood = { schemaVersion: 1, source: "runner-resolved", fingerprint, discoveredAt, inventory: normalized };
    const temporary = `${this.path}.${randomBytes(16).toString("hex")}.tmp`;
    await this.dependencies.fs.mkdir(this.directory, 0o700);
    await this.dependencies.fs.chmod?.(this.directory, 0o700);
    if (!await this.isSafeRegularPath(this.directory) || !await this.isSafeRegularPath(this.path)) return;
    try {
      await this.dependencies.fs.writeFile(temporary, JSON.stringify(snapshot), 0o600);
      await this.dependencies.fs.chmod?.(temporary, 0o600);
      if (!await this.isSafeRegularPath(temporary)) return;
      await this.dependencies.fs.rename(temporary, this.path);
      await this.dependencies.fs.chmod?.(this.path, 0o600);
    } finally {
      await this.dependencies.fs.unlink?.(temporary).catch(() => undefined);
    }
  }
}

function isNormalizedInventory(value: unknown): value is RunnerModelInventory {
  return normalizePersistedInventory(value) !== undefined;
}
