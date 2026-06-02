#!/usr/bin/env bun
/**
 * Prepare a release descriptor (`release.json`).
 *
 * The descriptor is the contract between the release pipeline and the
 * self-update orchestrator (spec REQ-RD-001 .. REQ-RD-011). It replaces
 * the previous regex-based release-body SHA-256 parsing and lets Deck
 * reason about typed release items (`binary`, `content`, `migration`,
 * `advisory`, `channel_eol`).
 *
 * **The script emits the OFFICIAL spec-shaped descriptor** (snake_case
 * field names per `openspec/changes/add-self-update-system/spec.md`).
 * The output round-trips through `parseReleaseDescriptor` from
 * `release-descriptor.ts`.
 *
 * This script is a guided helper for maintainers:
 *
 *   # Interactive mode — prompts for every field
 *   bun run scripts/prepare-release.ts
 *
 *   # Non-interactive mode — every field from flags (CI / dry run)
 *   bun run scripts/prepare-release.ts \
 *     --non-interactive \
 *     --version 1.2.0 \
 *     --tag v1.2.0 \
 *     --channel stable \
 *     --out release.json
 *
 *   # Compute SHA-256 for a local archive and emit a binary item line
 *   bun run scripts/prepare-release.ts --sha256-file path/to/binary.tar.gz
 *
 * The assembled descriptor is validated against the Zod schema in
 * `apps/cli/src/upgrade-command/release-descriptor.ts` before being
 * written or printed. A failing validation exits non-zero.
 *
 * Module API:
 *   - `buildReleaseDescriptor(input)` — pure builder, used by tests
 *   - `validateReleaseDescriptor(input)` — schema check wrapper
 *   - `computeSha256File(path)` — file-based checksum helper
 *   - `parseCliArgs(argv)` — CLI parser
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { join } from "node:path";

import {
  BINARY_ASSET_NAME_PATTERN,
  ReleaseJsonSchema,
  RELEASE_ITEM_KINDS,
  type AdvisoryReleaseItem,
  type BinaryReleaseItem,
  type ChannelEolReleaseItem,
  type ContentReleaseItem,
  type MigrationReleaseItem,
  type ReleaseItem,
  type ReleaseJson,
} from "../apps/cli/src/upgrade-command/release-descriptor.js";

// Re-export the pattern so consumers (and the script's CLI) can use it.
export { BINARY_ASSET_NAME_PATTERN };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReleaseChannel = "stable" | "beta" | "dev";

export type CliArgs = {
  help: boolean;
  nonInteractive: boolean;
  version?: string;
  tag?: string;
  channel?: ReleaseChannel;
  publishedAt?: string;
  notesUrl?: string;
  minDeckVersion?: string;
  /** Path to a local file whose SHA-256 should be computed. */
  sha256File?: string;
  /** Output path. If omitted, prints to stdout. */
  out?: string;
  /** Build descriptor from a directory of pre-built tar.gz artifacts. */
  fromAssetsDir?: string;
  /** Base URL for binary assets in the descriptor (e.g. https://github.com/owner/repo/releases/download/<tag>). */
  assetBaseUrl?: string;
};

export type BinaryItemInput = Omit<BinaryReleaseItem, "kind">;
export type ContentItemInput = Omit<ContentReleaseItem, "kind">;
export type MigrationItemInput = Omit<MigrationReleaseItem, "kind">;
export type AdvisoryItemInput = Omit<AdvisoryReleaseItem, "kind">;
export type ChannelEolItemInput = Omit<ChannelEolReleaseItem, "kind">;

export type BuildInput = {
  version: string;
  tag_name: string;
  channel: ReleaseChannel;
  published_at: string;
  release_notes_url?: string;
  min_deck_version?: string;
  items: ReleaseItem[];
};

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const VALID_CHANNELS: ReadonlyArray<ReleaseChannel> = ["stable", "beta", "dev"];

/**
 * Parse CLI arguments into a typed `CliArgs` object.
 *
 * The parser is deliberately minimal — flags take a single string value
 * separated by a space (`--version 1.2.0`) or an `=` sign
 * (`--version=1.2.0`).
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { help: false, nonInteractive: false };
  const list = [...argv];

  for (let i = 0; i < list.length; i++) {
    const raw = list[i]!;
    const [flag, inlineValue] = raw.includes("=") ? raw.split("=", 2) : [raw, undefined];

    const takeValue = (name: string): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = list[i + 1];
      if (next === undefined || next.startsWith("--")) return undefined;
      i++;
      return next;
    };

    switch (flag) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "--non-interactive":
        args.nonInteractive = true;
        break;
      case "--version":
        args.version = takeValue("--version");
        break;
      case "--tag":
        args.tag = takeValue("--tag");
        break;
      case "--channel":
        args.channel = takeValue("--channel") as ReleaseChannel | undefined;
        break;
      case "--published-at":
        args.publishedAt = takeValue("--published-at");
        break;
      case "--notes-url":
        args.notesUrl = takeValue("--notes-url");
        break;
      case "--min-deck-version":
        args.minDeckVersion = takeValue("--min-deck-version");
        break;
      case "--sha256-file":
        args.sha256File = takeValue("--sha256-file");
        break;
      case "--out":
      case "-o":
        args.out = takeValue("--out") ?? inlineValue;
        break;
      case "--from-assets-dir":
        args.fromAssetsDir = takeValue("--from-assets-dir");
        break;
      case "--asset-base-url":
        args.assetBaseUrl = takeValue("--asset-base-url");
        break;
      default:
        if (flag?.startsWith("-")) {
          throw new Error(`Unknown flag: ${flag}`);
        }
    }
  }

  if (args.channel && !VALID_CHANNELS.includes(args.channel)) {
    throw new Error(
      `Invalid --channel value: ${args.channel}. Expected one of: ${VALID_CHANNELS.join(", ")}`
    );
  }

  return args;
}

const HELP_TEXT = `prepare-release.ts — generate a release.json descriptor

Usage:
  bun run scripts/prepare-release.ts [flags]

Flags:
  --non-interactive        Do not prompt; require every field via flags
  --version <semver>       Release version (e.g. 1.2.0)
  --tag <tag>              Git tag (e.g. v1.2.0)
  --channel <channel>      Release channel: stable | beta | dev
  --published-at <iso>     ISO-8601 timestamp (default: now)
  --notes-url <url>        Optional release notes URL
  --min-deck-version <v>   Optional minimum deck version
  --sha256-file <path>     Compute and print SHA-256 of a local file
  --out <path>             Write descriptor to this path (default: stdout)
  --from-assets-dir <dir>  Build binary items from every deck_v*.tar.gz in <dir>
  --asset-base-url <url>   Base URL for binary items when using --from-assets-dir
  -h, --help               Show this help

The output is the OFFICIAL spec-shaped descriptor (snake_case per
openspec/changes/add-self-update-system/spec.md). Field names:
  version, tag_name, published_at, channel, release_notes_url, items
  items[].kind / required / asset_name / sha256 / notes
  items[binary].asset_name must match deck_v{VERSION}_{OS}-{ARCH}.tar.gz
  items[migration].from_schema_version / to_schema_version
  items[advisory].severity / affected_versions
  items[channel_eol].successor_channel

Examples:
  bun run scripts/prepare-release.ts
  bun run scripts/prepare-release.ts --sha256-file dist/cli/deck_v1.2.0_linux-x64.tar.gz
  bun run scripts/prepare-release.ts --non-interactive \\
    --version 1.2.0 --tag v1.2.0 --channel stable --out release.json
  bun run scripts/prepare-release.ts --non-interactive \\
    --version 1.2.0 --tag v1.2.0 --channel stable \\
    --from-assets-dir release-assets \\
    --asset-base-url https://github.com/owner/repo/releases/download/v1.2.0 \\
    --out release-assets/release.json
`;

// ---------------------------------------------------------------------------
// SHA-256 helper
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 of a local file as a 64-char lowercase hex string.
 *
 * Used by `--sha256-file` so maintainers do not have to manually run
 * `sha256sum` and copy/paste the digest.
 */
export function computeSha256File(path: string): string {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Build binary items by scanning a directory of pre-built tar.gz
 * archives. Used by the release workflow to assemble `release.json`
 * from the artifacts the CI step has just produced, so descriptor
 * checksums can never drift from the uploaded binaries.
 *
 * Filename pattern: `deck_v{VERSION}_{OS}-{ARCH}.tar.gz`
 *
 * @param dir - directory containing the tar.gz archives
 * @param baseUrl - public base URL where the assets will be hosted
 *                  (typically the GitHub release download URL prefix)
 * @returns Array of `BinaryReleaseItem` ready to drop into a descriptor
 */
export function buildBinaryItemsFromAssetsDir(
  dir: string,
  baseUrl: string
): BinaryReleaseItem[] {
  if (!existsSync(dir)) {
    throw new Error(`Assets directory not found: ${dir}`);
  }
  const pattern = BINARY_ASSET_NAME_PATTERN;
  const allFiles = readdirSync(dir);
  const files = allFiles
    .filter((name) => pattern.test(name))
    .sort();

  const items: BinaryReleaseItem[] = [];
  for (const name of files) {
    // `BINARY_ASSET_NAME_PATTERN` is a validator, not a parser. Extract
    // the version + platform from the filename directly so we don't
    // need capture groups in the pattern (which would couple validation
    // to extraction).
    const parsed = parseBinaryAssetName(name);
    if (!parsed) continue;
    const { version, platform } = parsed;
    const filePath = join(dir, name);
    const sha = computeSha256File(filePath);
    const url = `${baseUrl.replace(/\/$/, "")}/${name}`;
    items.push({
      id: `binary-${platform}-v${version}`,
      kind: "binary",
      required: true,
      platform,
      asset_name: name,
      url,
      sha256: sha,
      notes: `${platform} binary`,
    });
  }
  return items;
}

/**
 * Extract `version` and `platform` from a binary asset filename.
 * Returns `null` if the filename doesn't match the spec pattern.
 */
function parseBinaryAssetName(name: string): { version: string; platform: string } | null {
  if (!BINARY_ASSET_NAME_PATTERN.test(name)) return null;
  // name is shaped like `deck_v{VERSION}_{OS}-{ARCH}.tar.gz`.
  const withoutExt = name.replace(/\.tar\.gz$/, "");
  const withoutPrefix = withoutExt.replace(/^deck_v/, "");
  const lastUnderscore = withoutPrefix.lastIndexOf("_");
  if (lastUnderscore < 0) return null;
  const version = withoutPrefix.slice(0, lastUnderscore);
  const platform = withoutPrefix.slice(lastUnderscore + 1);
  if (!version || !platform) return null;
  return { version, platform };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a `ReleaseJson` from a typed `BuildInput`.
 *
 * Pure function — does not perform I/O and does not interact with the
 * console. Used by the CLI driver and by tests.
 *
 * `BuildInput` uses the spec-shaped field names (`tag_name`,
 * `published_at`, etc.) so the produced descriptor matches the
 * official contract exactly.
 */
export function buildReleaseDescriptor(input: BuildInput): ReleaseJson {
  const result = ReleaseJsonSchema.safeParse({
    schemaVersion: 1,
    version: input.version,
    tag_name: input.tag_name,
    channel: input.channel,
    published_at: input.published_at,
    release_notes_url: input.release_notes_url,
    min_deck_version: input.min_deck_version,
    items: input.items,
  });
  if (!result.success) {
    throw new Error(
      `Descriptor validation failed: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }
  return result.data;
}

/**
 * Convenience: validate a pre-built candidate descriptor (object).
 * Throws on failure with a descriptive message.
 */
export function validateReleaseDescriptor(candidate: unknown): ReleaseJson {
  const result = ReleaseJsonSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(
      `Descriptor validation failed: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Interactive prompt helpers
// ---------------------------------------------------------------------------

type Prompter = {
  question: (q: string) => Promise<string>;
  close: () => void;
};

function makeConsolePrompter(): Prompter {
  const rl = createInterface({ input, output });
  return {
    question: (q) => rl.question(q),
    close: () => rl.close(),
  };
}

async function promptRequired(p: Prompter, label: string): Promise<string> {
  for (;;) {
    const answer = (await p.question(`${label}: `)).trim();
    if (answer.length > 0) return answer;
    console.error(`${label} is required.`);
  }
}

async function promptOptional(p: Prompter, label: string): Promise<string | undefined> {
  const answer = (await p.question(`${label} (optional): `)).trim();
  return answer.length > 0 ? answer : undefined;
}

async function promptChannel(p: Prompter): Promise<ReleaseChannel> {
  for (;;) {
    const raw = (await p.question(`Channel (${VALID_CHANNELS.join("|")}) [stable]: `)).trim();
    const value = raw.length === 0 ? "stable" : (raw as ReleaseChannel);
    if (VALID_CHANNELS.includes(value)) return value;
    console.error(`Invalid channel: ${raw}`);
  }
}

async function promptYesNo(p: Prompter, label: string, defaultYes: boolean): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const raw = (await p.question(`${label} ${suffix}: `)).trim().toLowerCase();
  if (raw.length === 0) return defaultYes;
  return raw === "y" || raw === "yes";
}

async function promptItems(p: Prompter): Promise<ReleaseItem[]> {
  const items: ReleaseItem[] = [];
  console.log("");
  console.log("Add release items. Available kinds:");
  for (const k of RELEASE_ITEM_KINDS) console.log(`  - ${k}`);
  console.log("Press Enter at the kind prompt to finish.");

  for (;;) {
    console.log("");
    const kind = (await p.question(`Item kind (${RELEASE_ITEM_KINDS.join("|")}): `)).trim();
    if (kind.length === 0) break;
    if (!RELEASE_ITEM_KINDS.includes(kind as ReleaseItem["kind"])) {
      console.error(`Unknown kind: ${kind}`);
      continue;
    }

    switch (kind) {
      case "binary": {
        const id = await promptRequired(p, "  id");
        const platform = await promptRequired(p, "  platform (e.g. linux-x64)");
        const assetName = await promptRequired(
          p,
          "  asset_name (e.g. deck_v1.2.0_linux-x64.tar.gz)",
        );
        if (!BINARY_ASSET_NAME_PATTERN.test(assetName)) {
          console.error(
            `  Warning: ${assetName} does not match the required pattern ${BINARY_ASSET_NAME_PATTERN}`,
          );
        }
        const url = await promptRequired(p, "  url");
        const sha256Value = await promptRequired(p, "  sha256 (64 hex chars; or use --sha256-file to compute)");
        const required = await promptYesNo(p, "  required?", true);
        const notes = (await promptOptional(p, "  notes")) ?? "";
        items.push({
          id,
          kind: "binary",
          required,
          platform,
          asset_name: assetName,
          url,
          sha256: sha256Value.toLowerCase(),
          notes,
        });
        break;
      }
      case "content": {
        const id = await promptRequired(p, "  id");
        const assetName = await promptRequired(p, "  asset_name");
        const url = await promptRequired(p, "  url");
        const sha256Value = await promptRequired(p, "  sha256");
        const required = await promptYesNo(p, "  required?", false);
        const notes = (await promptOptional(p, "  notes")) ?? "";
        const contentKindsRaw = await promptRequired(
          p,
          "  content_kinds (comma-separated: prompts|skills|subagents|mcp|packageInstructions)",
        );
        const content_kinds = contentKindsRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0) as ContentReleaseItem["content_kinds"];
        items.push({
          id,
          kind: "content",
          required,
          asset_name: assetName,
          url,
          sha256: sha256Value.toLowerCase(),
          notes,
          content_kinds,
        });
        break;
      }
      case "migration": {
        const id = await promptRequired(p, "  id");
        const assetName = await promptRequired(p, "  asset_name");
        const url = await promptRequired(p, "  url");
        const sha256Value = await promptRequired(p, "  sha256");
        const required = await promptYesNo(p, "  required?", true);
        const notes = (await promptOptional(p, "  notes")) ?? "";
        const fromRaw = await promptRequired(p, "  from_schema_version (e.g. 1)");
        const toRaw = await promptRequired(p, "  to_schema_version (e.g. 2)");
        const from_schema_version = Number.parseInt(fromRaw, 10);
        const to_schema_version = Number.parseInt(toRaw, 10);
        items.push({
          id,
          kind: "migration",
          required,
          asset_name: assetName,
          url,
          sha256: sha256Value.toLowerCase(),
          notes,
          from_schema_version,
          to_schema_version,
        });
        break;
      }
      case "advisory": {
        const id = await promptRequired(p, "  id");
        const assetName = await promptRequired(p, "  asset_name");
        const url = await promptRequired(p, "  url");
        const sha256Value = await promptRequired(p, "  sha256");
        const message = await promptRequired(p, "  message (also used as notes)");
        const severityRaw = (await p.question(`  severity (info|warning|critical) [info]: `)).trim();
        const severity = (severityRaw.length === 0 ? "info" : severityRaw) as AdvisoryReleaseItem["severity"];
        const required = await promptYesNo(p, "  required?", false);
        const affectedRaw = await promptRequired(
          p,
          "  affected_versions (comma-separated, e.g. <=1.0.0,1.1.0)",
        );
        const affected_versions = affectedRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        items.push({
          id,
          kind: "advisory",
          required,
          asset_name: assetName,
          url,
          sha256: sha256Value.toLowerCase(),
          notes: message,
          severity,
          affected_versions,
        });
        break;
      }
      case "channel_eol": {
        const id = await promptRequired(p, "  id");
        const assetName = await promptRequired(p, "  asset_name");
        const url = await promptRequired(p, "  url");
        const sha256Value = await promptRequired(p, "  sha256");
        const message = await promptRequired(p, "  message (also used as notes)");
        const required = await promptYesNo(p, "  required?", false);
        const successor_channel = await promptRequired(p, "  successor_channel");
        items.push({
          id,
          kind: "channel_eol",
          required,
          asset_name: assetName,
          url,
          sha256: sha256Value.toLowerCase(),
          notes: message,
          successor_channel,
        });
        break;
      }
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// CLI driver
// ---------------------------------------------------------------------------

async function runNonInteractive(args: CliArgs): Promise<ReleaseJson> {
  if (!args.version) throw new Error("--version is required in non-interactive mode");
  if (!args.tag) throw new Error("--tag is required in non-interactive mode");
  const channel: ReleaseChannel = args.channel ?? "stable";
  const published_at = args.publishedAt ?? new Date().toISOString();

  let items: ReleaseItem[] = [];
  if (args.fromAssetsDir) {
    if (!args.assetBaseUrl) {
      throw new Error(
        "--asset-base-url is required when --from-assets-dir is set"
      );
    }
    items = buildBinaryItemsFromAssetsDir(args.fromAssetsDir, args.assetBaseUrl);
  }

  return buildReleaseDescriptor({
    version: args.version,
    tag_name: args.tag,
    channel,
    published_at,
    release_notes_url: args.notesUrl,
    min_deck_version: args.minDeckVersion,
    items,
  });
}

async function runInteractive(args: CliArgs): Promise<ReleaseJson> {
  const p = makeConsolePrompter();
  try {
    const version = args.version ?? (await promptRequired(p, "Version (e.g. 1.2.0)"));
    const tag_name = args.tag ?? (await promptRequired(p, "Tag (e.g. v1.2.0)"));
    const channel = args.channel ?? (await promptChannel(p));
    const published_at =
      args.publishedAt ??
      ((await p.question("Published at (ISO-8601; Enter for now): ")).trim() || new Date().toISOString());
    const release_notes_url = args.notesUrl ?? (await promptOptional(p, "Notes URL"));
    const min_deck_version = args.minDeckVersion ?? (await promptOptional(p, "Min deck version"));
    const items = await promptItems(p);

    return buildReleaseDescriptor({
      version,
      tag_name,
      channel,
      published_at,
      release_notes_url,
      min_deck_version,
      items,
    });
  } finally {
    p.close();
  }
}

function writeOutput(descriptor: ReleaseJson, out: string | undefined): void {
  const json = JSON.stringify(descriptor, null, 2) + "\n";
  if (out) {
    writeFileSync(out, json, "utf-8");
    console.error(`Wrote ${out}`);
  } else {
    process.stdout.write(json);
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  try {
    const args = parseCliArgs(argv);

    if (args.help) {
      process.stdout.write(HELP_TEXT);
      return 0;
    }

    if (args.sha256File) {
      const hash = computeSha256File(args.sha256File);
      process.stdout.write(`${hash}\n`);
      return 0;
    }

    const descriptor = args.nonInteractive
      ? await runNonInteractive(args)
      : await runInteractive(args);
    writeOutput(descriptor, args.out);
    return 0;
  } catch (err) {
    console.error(`prepare-release failed: ${(err as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  // Skip "bun" and the script path
  const argv = process.argv.slice(2);
  main(argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error("prepare-release crashed:", err);
      process.exit(1);
    }
  );
}
