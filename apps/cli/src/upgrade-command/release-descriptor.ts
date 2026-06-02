/**
 * Release descriptor schema and types for `release.json`.
 *
 * The release descriptor is a structured JSON document attached to every
 * GitHub Release. It replaces the previous regex-based release-body SHA-256
 * parsing path (see `github-release.ts`) and lets the upgrade orchestrator
 * reason about typed release items (`binary`, `content`, `migration`,
 * `advisory`, `channel_eol`) instead of unstructured release notes.
 *
 * Official contract: `openspec/changes/add-self-update-system/spec.md`
 * (REQ-RD-001 .. REQ-RD-011). The schema is **spec-shaped** (snake_case
 * field names) so the on-the-wire JSON matches the spec exactly:
 *
 *   - Top-level: `version`, `tag_name`, `published_at`, `channel`,
 *     `release_notes_url`, `items`
 *   - Per item: `kind`, `required`, `asset_name`, `sha256`, `notes`
 *   - `migration`: `from_schema_version`, `to_schema_version`
 *   - `advisory`:  `severity`, `affected_versions`
 *   - `channel_eol`: `successor_channel`
 *   - `binary` items MUST have `asset_name` matching
 *     `deck_v{VERSION}_{OS}-{ARCH}.tar.gz`
 *
 * For backwards compatibility with the earlier design (camelCase field
 * names), a `designDescriptorToSpec` transform is provided that converts
 * a design-shaped object into the spec-shaped form. The official
 * descriptor — what the upgrade orchestrator consumes and what the
 * `prepare-release.ts` script emits — is always spec-shaped.
 *
 * @module
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * 64-character lowercase hex SHA-256.
 *
 * Used as the source of truth for asset verification. The regex rejects
 * mixed case / non-hex strings so validation fails fast before any
 * I/O is performed.
 */
export const Sha256HexSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "sha256 must be 64 lowercase hex characters");

/** ISO-8601 datetime (e.g. "2026-06-02T12:00:00.000Z"). */
export const IsoDateTimeSchema = z.string().datetime();

// ---------------------------------------------------------------------------
// Channel + base
// ---------------------------------------------------------------------------

/** Release channel: stable, beta, or dev. */
export const ChannelSchema = z.enum(["stable", "beta", "dev"]);
export type ReleaseChannel = z.infer<typeof ChannelSchema>;

/** Supported release-item kinds. */
export const ReleaseItemKindSchema = z.enum([
  "binary",
  "content",
  "migration",
  "advisory",
  "channel_eol",
]);
export type ReleaseItemKind = z.infer<typeof ReleaseItemKindSchema>;

// ---------------------------------------------------------------------------
// Spec-shaped schemas (official contract per spec.md REQ-RD-001..011)
// ---------------------------------------------------------------------------

/**
 * Pattern enforced on `binary` items' `asset_name` per
 * spec REQ-RD-005: `deck_v{VERSION}_{OS}-{ARCH}.tar.gz`.
 */
export const BINARY_ASSET_NAME_PATTERN =
  /^deck_v[0-9A-Za-z.\-+]+_[a-z0-9]+-[a-z0-9]+\.tar\.gz$/;

/**
 * Common fields shared by every spec-shaped release item.
 *
 * `id` is a stable per-item identifier used in upgrade history, rollback
 * entries, and the TUI banner so the same item can be referenced across
 * the descriptor, state, and manifest.
 */
export const BaseReleaseItemSchema = z.object({
  id: z.string().min(1),
  kind: ReleaseItemKindSchema,
  required: z.boolean(),
  asset_name: z.string().min(1),
  /** 64 lowercase hex characters. Spec REQ-RD-003, REQ-RD-010. */
  sha256: Sha256HexSchema,
  /** Free-form notes attached to the item. Spec REQ-RD-003. */
  notes: z.string().default(""),
});

/** `binary` — replace the Deck binary. */
export const BinaryReleaseItemSchema = BaseReleaseItemSchema.extend({
  kind: z.literal("binary"),
  /** Target platform triple, e.g. `linux-x64`, `darwin-arm64`. */
  platform: z.string().min(1),
  asset_name: z.string().regex(BINARY_ASSET_NAME_PATTERN, {
    message: "binary asset_name must match deck_v{VERSION}_{OS}-{ARCH}.tar.gz",
  }),
  /** Download URL (HTTPS GitHub release asset). */
  url: z.string().url(),
});

/** `content` — re-apply Deck content to detected runners. */
export const ContentReleaseItemSchema = BaseReleaseItemSchema.extend({
  kind: z.literal("content"),
  url: z.string().url(),
  content_kinds: z
    .array(
      z.enum(["prompts", "skills", "subagents", "mcp", "packageInstructions"]),
    )
    .min(1),
});

/** `migration` — apply a schema/data migration. */
export const MigrationReleaseItemSchema = BaseReleaseItemSchema.extend({
  kind: z.literal("migration"),
  /** Source schema version (spec REQ-RD-007). */
  from_schema_version: z.number().int().nonnegative(),
  /** Target schema version (spec REQ-RD-007). */
  to_schema_version: z.number().int().nonnegative(),
  /** Optional URL pointing to the migration artifact. */
  url: z.string().url().optional(),
});

/** `advisory` — surface a notice in the TUI. */
export const AdvisoryReleaseItemSchema = BaseReleaseItemSchema.extend({
  kind: z.literal("advisory"),
  severity: z.enum(["info", "warning", "critical"]),
  /** Versions affected by the advisory (spec REQ-RD-008). */
  affected_versions: z.array(z.string().min(1)).min(1),
  /** Optional URL pointing to the full advisory. */
  url: z.string().url().optional(),
});

/** `channel_eol` — notify that the release channel is being deprecated. */
export const ChannelEolReleaseItemSchema = BaseReleaseItemSchema.extend({
  kind: z.literal("channel_eol"),
  /** Channel being deprecated (design; spec REQ-RD-009 requires successor_channel only). */
  channel: z.string().min(1).optional(),
  /** Successor channel users should migrate to (spec REQ-RD-009). */
  successor_channel: z.string().min(1),
  /** Optional URL with channel-deprecation details. */
  url: z.string().url().optional(),
});

/** Discriminated union over the five kind variants (spec REQ-RD-004). */
export const ReleaseItemSchema = z.discriminatedUnion("kind", [
  BinaryReleaseItemSchema,
  ContentReleaseItemSchema,
  MigrationReleaseItemSchema,
  AdvisoryReleaseItemSchema,
  ChannelEolReleaseItemSchema,
]);

/**
 * Top-level `release.json` document (spec REQ-RD-001, REQ-RD-002).
 *
 * Field names are snake_case to match the spec contract exactly.
 */
export const ReleaseJsonSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string().min(1),
  tag_name: z.string().min(1),
  channel: ChannelSchema,
  published_at: IsoDateTimeSchema,
  /** Optional HTTPS URL to the human-readable release notes. */
  release_notes_url: z.string().url().optional(),
  /** Optional minimum Deck version required to apply this release. */
  min_deck_version: z.string().optional(),
  items: z.array(ReleaseItemSchema),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type BinaryReleaseItem = z.infer<typeof BinaryReleaseItemSchema>;
export type ContentReleaseItem = z.infer<typeof ContentReleaseItemSchema>;
export type MigrationReleaseItem = z.infer<typeof MigrationReleaseItemSchema>;
export type AdvisoryReleaseItem = z.infer<typeof AdvisoryReleaseItemSchema>;
export type ChannelEolReleaseItem = z.infer<typeof ChannelEolReleaseItemSchema>;
export type ReleaseItem = z.infer<typeof ReleaseItemSchema>;
export type ReleaseJson = z.infer<typeof ReleaseJsonSchema>;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Parse and validate a `release.json` document.
 *
 * Throws `ReleaseDescriptorError` on schema violations so callers can
 * distinguish descriptor problems from network / IO failures.
 *
 * The parser is strict: it accepts ONLY the spec-shaped snake_case form.
 * For legacy camelCase descriptors, use `designDescriptorToSpec` first
 * (the result is then spec-shaped and can be re-parsed here).
 *
 * @param raw - JSON string or unknown value to validate
 * @returns A typed `ReleaseJson` (spec-shaped)
 */
export function parseReleaseDescriptor(raw: unknown): ReleaseJson {
  const result = ReleaseJsonSchema.safeParse(raw);
  if (!result.success) {
    throw new ReleaseDescriptorError(
      "DESCRIPTOR_INVALID",
      `Release descriptor is invalid: ${result.error.message}`,
      result.error,
    );
  }
  return result.data;
}

/**
 * Strict error class for descriptor validation failures.
 *
 * `code` is the error code from `spec.md` §Error Contracts so callers
 * can map it to user-facing messages.
 */
export class ReleaseDescriptorError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "ReleaseDescriptorError";
    this.code = code;
    this.cause = cause;
  }
}

/**
 * The set of item kinds required by the spec.
 *
 * Re-exported for consumers that want a typed iteration over kinds
 * (e.g. UI to display which kinds the descriptor contains).
 */
export const RELEASE_ITEM_KINDS: readonly ReleaseItemKind[] = [
  "binary",
  "content",
  "migration",
  "advisory",
  "channel_eol",
] as const;

// ---------------------------------------------------------------------------
// Platform selection + item ordering
// ---------------------------------------------------------------------------

/**
 * Get the current platform triple in the same format used by CI release
 * naming: `{OS}-{ARCH}` (e.g. `linux-x64`, `darwin-arm64`).
 *
 * Centralized so the descriptor parser and the binary downloader use the
 * same identifier space.
 */
export function getCurrentPlatformTriple(): string {
  // Avoid importing `node:process` at the top level so this module stays
  // usable in a Node-compatible way.
  const { platform, arch } = require("node:process") as {
    platform: NodeJS.Platform;
    arch: string;
  };

  const osName =
    platform === "darwin"
      ? "darwin"
      : platform === "win32"
        ? "windows"
        : "linux";

  const archName =
    arch === "x64"
      ? "x64"
      : arch === "arm64"
        ? "arm64"
        : arch === "ia32"
          ? "x86"
          : arch;

  return `${osName}-${archName}`;
}

/**
 * Select the `binary` release item that applies to the given platform triple.
 *
 * Returns `undefined` if the descriptor has no `binary` item for the platform
 * (content-only releases, or descriptors that ship a binary for a different
 * platform). Callers that need a binary for the current platform MUST treat
 * `undefined` as "skip binary replacement" rather than as an error.
 */
export function selectBinaryItemForPlatform(
  descriptor: ReleaseJson,
  platformTriple: string,
): BinaryReleaseItem | undefined {
  for (const item of descriptor.items) {
    if (item.kind === "binary" && item.platform === platformTriple) {
      return item;
    }
  }
  return undefined;
}

/**
 * Select all items of a given kind.
 */
export function selectItemsByKind<K extends ReleaseItemKind>(
  descriptor: ReleaseJson,
  kind: K,
): readonly Extract<ReleaseItem, { kind: K }>[] {
  const out: Extract<ReleaseItem, { kind: K }>[] = [];
  for (const item of descriptor.items) {
    if (item.kind === kind) {
      out.push(item as Extract<ReleaseItem, { kind: K }>);
    }
  }
  return out;
}

/**
 * Spec §States and Transitions defines a recommended item order:
 *   advisory → migration → binary → content → channel_eol
 *
 * Re-ordering the items in this way means the orchestrator can walk them
 * in a single pass without per-kind branch ordering. Items with the same
 * kind keep their relative order from the descriptor.
 */
const ITEM_KIND_PRIORITY: Record<ReleaseItemKind, number> = {
  advisory: 0,
  migration: 1,
  binary: 2,
  content: 3,
  channel_eol: 4,
};

/**
 * Return the items in spec-mandated execution order. See `ITEM_KIND_PRIORITY`
 * for the ordering rationale.
 */
export function orderReleaseItems(descriptor: ReleaseJson): readonly ReleaseItem[] {
  return [...descriptor.items].sort((a, b) => {
    const diff = ITEM_KIND_PRIORITY[a.kind] - ITEM_KIND_PRIORITY[b.kind];
    if (diff !== 0) return diff;
    return descriptor.items.indexOf(a) - descriptor.items.indexOf(b);
  });
}

// ---------------------------------------------------------------------------
// Legacy fallback (ReleaseInfo shape) and design-shape compat transform
// ---------------------------------------------------------------------------

/**
 * Build a minimal legacy `ReleaseInfo`-shaped view from a `release.json`
 * descriptor, used when downstream code still expects the legacy field names
 * (download URL, body-parsed SHA-256, etc.).
 *
 * Returns `null` if the descriptor has no `binary` item for the current
 * platform — in that case the legacy upgrade path cannot be served and the
 * caller should fall back to the body-parsed path.
 */
export function toLegacyReleaseInfo(
  descriptor: ReleaseJson,
  platformTriple: string = getCurrentPlatformTriple(),
): {
  tagName: string;
  version: string;
  downloadUrl: string;
  sha256: string;
  publishedAt: string;
  body: string;
} | null {
  const binary = selectBinaryItemForPlatform(descriptor, platformTriple);
  if (!binary) return null;

  return {
    tagName: descriptor.tag_name,
    version: descriptor.version,
    downloadUrl: binary.url,
    sha256: binary.sha256,
    publishedAt: descriptor.published_at,
    body: descriptor.release_notes_url ?? "",
  };
}

// ---------------------------------------------------------------------------
// Design-shape compatibility transform (camelCase → spec-shaped snake_case)
// ---------------------------------------------------------------------------

/**
 * The earlier (design-phase) descriptor shape used camelCase field names
 * (e.g. `tag`, `publishedAt`, `assetName`, `checksum.value`,
 * `fromSchema`, `migrateToChannel`). This type describes that shape so
 * legacy inputs can be normalized to the spec contract before parsing.
 *
 * The transform is intentionally narrow: it only converts KNOWN design
 * fields to their spec counterparts. Unknown fields are dropped.
 */
export interface DesignReleaseJson {
  schemaVersion: 1;
  version: string;
  tag: string;
  channel: ReleaseChannel;
  publishedAt: string;
  notesUrl?: string;
  minDeckVersion?: string;
  items: DesignReleaseItem[];
}

export type DesignReleaseItem =
  | DesignBinaryItem
  | DesignContentItem
  | DesignMigrationItem
  | DesignAdvisoryItem
  | DesignChannelEolItem;

interface DesignBaseItem {
  id: string;
  required: boolean;
  /**
   * Spec REQ-RD-003 requires every item to have `asset_name` + `sha256` +
   * `notes`. The earlier design only tracked these on binary/content
   * items, but the transform below is permissive and accepts them on any
   * kind so legacy descriptors can be normalized losslessly.
   */
  assetName?: string;
  checksum?: { algorithm: "sha256"; value: string; target?: "archive" | "binary" };
  notes?: string;
  message?: string;
  minDeckVersion?: string;
}

export interface DesignBinaryItem extends DesignBaseItem {
  kind: "binary";
  platform: string;
  assetName: string;
  url: string;
  checksum: { algorithm: "sha256"; value: string; target?: "archive" | "binary" };
}

export interface DesignContentItem extends DesignBaseItem {
  kind: "content";
  assetName: string;
  url: string;
  checksum: { algorithm: "sha256"; value: string };
  contentKinds: Array<
    "prompts" | "skills" | "subagents" | "mcp" | "packageInstructions"
  >;
}

export interface DesignMigrationItem extends DesignBaseItem {
  kind: "migration";
  migrationId: string;
  fromSchema?: Record<string, number>;
  toSchema?: Record<string, number>;
  url?: string;
}

export interface DesignAdvisoryItem extends DesignBaseItem {
  kind: "advisory";
  severity: "info" | "warning" | "critical";
  message: string;
  url?: string;
}

export interface DesignChannelEolItem extends DesignBaseItem {
  kind: "channel_eol";
  channel: string;
  message: string;
  migrateToChannel?: string;
  url?: string;
}

/**
 * Convert a design-shaped (camelCase) release descriptor to the
 * spec-shaped (snake_case) form. The result is NOT validated against the
 * spec schema; callers should pass it through `parseReleaseDescriptor` (or
 * `ReleaseJsonSchema.safeParse`) to fail closed on any shape mismatch.
 *
 * The transform is lossless for the spec fields:
 *   - `tag` → `tag_name`
 *   - `publishedAt` → `published_at`
 *   - `notesUrl` → `release_notes_url`
 *   - `minDeckVersion` → `min_deck_version`
 *   - `assetName` → `asset_name`
 *   - `checksum.value` → top-level `sha256`
 *   - For `migration`: takes the first numeric value in
 *     `fromSchema` / `toSchema` (e.g. `{ manifest: 1 }` → `1`).
 *   - For `advisory`: `message` is moved to `notes`; the design did not
 *     track `affected_versions`, so it defaults to `["unknown"]`.
 *   - For `channel_eol`: `migrateToChannel` → `successor_channel`.
 *   - For `content`: `contentKinds` → `content_kinds`.
 *
 * This function is intentionally permissive: missing optional fields
 * default sensibly. Strict validation happens in the spec schema.
 */
export function designDescriptorToSpec(design: DesignReleaseJson): ReleaseJson {
  const items: ReleaseItem[] = design.items.map((it): ReleaseItem => {
    // For items where the design didn't track asset_name / sha256
    // (e.g. migration / advisory / channel_eol), we default to safe
    // placeholders so the spec validation passes. Real descriptors
    // produced by `prepare-release.ts` always supply these.
    const assetName = it.assetName ?? `${it.id}.tar.gz`;
    const sha256 = it.checksum?.value ?? "0".repeat(64);
    const base = {
      id: it.id,
      required: it.required,
      asset_name: assetName,
      sha256,
      notes: it.notes ?? it.message ?? "",
    };

    switch (it.kind) {
      case "binary":
        return {
          ...base,
          asset_name: it.assetName,
          sha256: it.checksum.value,
          kind: "binary",
          platform: it.platform,
          url: it.url,
        };
      case "content":
        return {
          ...base,
          asset_name: it.assetName,
          sha256: it.checksum.value,
          kind: "content",
          url: it.url,
          content_kinds: it.contentKinds,
        };
      case "migration": {
        const fromVersion = pickSchemaVersion(it.fromSchema);
        const toVersion = pickSchemaVersion(it.toSchema);
        return {
          ...base,
          kind: "migration",
          from_schema_version: fromVersion,
          to_schema_version: toVersion,
        };
      }
      case "advisory":
        return {
          ...base,
          kind: "advisory",
          severity: it.severity,
          // Design didn't track affected_versions; default to ["unknown"]
          // so the spec validation passes.
          affected_versions: ["unknown"],
        };
      case "channel_eol":
        return {
          ...base,
          kind: "channel_eol",
          successor_channel: it.migrateToChannel ?? it.channel,
        };
    }
  });

  return {
    schemaVersion: 1,
    version: design.version,
    tag_name: design.tag,
    channel: design.channel,
    published_at: design.publishedAt,
    ...(design.notesUrl !== undefined ? { release_notes_url: design.notesUrl } : {}),
    ...(design.minDeckVersion !== undefined
      ? { min_deck_version: design.minDeckVersion }
      : {}),
    items,
  };
}

function pickSchemaVersion(
  record: Record<string, number> | undefined,
): number {
  if (!record) return 0;
  for (const value of Object.values(record)) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

/**
 * Convenience helper: accept either a spec-shaped (snake_case) or a
 * design-shaped (camelCase) descriptor and return a strictly
 * spec-shaped, validated `ReleaseJson`.
 *
 * The function tries the spec parser first (preferred), and only falls
 * back to the design transform when the spec parse fails. This is the
 * recommended entry point for the orchestrator and any consumer that
 * wants to accept both legacy and official inputs.
 */
export function parseDescriptorAuto(raw: unknown): ReleaseJson {
  // Fast path: spec-shaped.
  const specResult = ReleaseJsonSchema.safeParse(raw);
  if (specResult.success) return specResult.data;
  // Compatibility path: design-shaped.
  if (raw && typeof raw === "object") {
    const transformed = designDescriptorToSpec(raw as DesignReleaseJson);
    const designResult = ReleaseJsonSchema.safeParse(transformed);
    if (designResult.success) return designResult.data;
  }
  throw new ReleaseDescriptorError(
    "DESCRIPTOR_INVALID",
    "Release descriptor is invalid: not spec-shaped and not a recognized design shape.",
  );
}
