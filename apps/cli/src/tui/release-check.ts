/**
 * TUI release-check wrapper.
 *
 * Owns the non-blocking release-check lifecycle for the Deck TUI:
 *   1. Launches the backend descriptor fetch on TUI mount.
 *   2. Wraps it in a hard timeout (default 5s, per `design.md`).
 *   3. Translates the backend result into a small, UI-friendly
 *      `ReleaseCheckState` discriminated union.
 *   4. Caches the result of the most recent check for downstream
 *      consumers (banner + upgrade confirm screen).
 *
 * The network call is delegated through an injected `fetchImpl` so
 * tests can swap in fakes without touching the filesystem or curl.
 *
 * REQ-TUI-001 (non-blocking release check on TUI launch)
 * REQ-TUI-002 (must not block the home screen)
 * REQ-TUI-003 (hard timeout, suggested 5s)
 * REQ-TUI-007 (network failure suppresses banner)
 */

import {
  compareVersions,
  fetchReleaseDescriptor,
  type ReleaseFetchResult,
  type ReleaseInfo,
} from "../upgrade-command/github-release.js";
import type {
  AdvisoryReleaseItem,
  ChannelEolReleaseItem,
  ReleaseItem,
  ReleaseJson,
} from "../upgrade-command/release-descriptor.js";
import { getBuildInfo } from "../runtime/build-info.js";

/** Hard timeout for the release check (design.md §"State / Persistence"). */
export const DEFAULT_RELEASE_CHECK_TIMEOUT_MS = 5000;

/**
 * UI-facing release-check state.
 *
 * - `pending` — check is in flight; the TUI must not render any banner.
 * - `available` — a newer release descriptor was found.
 * - `none` — the latest release is the same as (or older than) the
 *   running version; no banner.
 * - `network-error` — fetch failed or timed out; no banner.
 */
export type ReleaseCheckState =
  | { kind: "pending" }
  | {
      kind: "available";
      /** Newer version string (e.g. "1.2.0"). */
      version: string;
      /** Tag of the newer release (e.g. "v1.2.0"). */
      tag: string;
      /** Channel of the newer release. */
      channel: "stable" | "beta" | "dev";
      /** Items the release ships, grouped for the banner. */
      items: readonly ReleaseItem[];
      /** First advisory item if any (banner priority over channel_eol). */
      advisory?: AdvisoryReleaseItem;
      /** First channel_eol item if any. */
      channelEol?: ChannelEolReleaseItem;
      /**
       * Full release descriptor, captured when the check returned one.
       * `null` when the upgrade opportunity was discovered via the
       * legacy body-parsed path (no `release.json` was attached).
       */
      descriptor: ReleaseJson | null;
    }
  | { kind: "none" }
  | { kind: "network-error"; error: string };

/**
 * Minimal dependency surface for the release check.
 *
 * Tests inject a fake `fetchImpl` so no real network happens.
 * The default uses the backend `fetchReleaseDescriptor` from G2.
 */
export type ReleaseCheckDeps = {
  fetchImpl?: () => ReleaseFetchResult;
  /** Returns the running Deck version; defaults to `getBuildInfo().version`. */
  currentVersion?: () => string;
  /** When set, sleeps before the fetch resolves (for test timing). */
  delayMs?: number;
};

/**
 * Run a release check with a hard timeout.
 *
 * Returns one of the four `ReleaseCheckState` kinds above. This function
 * MUST NEVER throw — the TUI home screen must remain responsive even
 * when the network or the descriptor are unreachable.
 */
export async function runReleaseCheckWithTimeout(
  timeoutMs: number = DEFAULT_RELEASE_CHECK_TIMEOUT_MS,
  deps: ReleaseCheckDeps = {},
): Promise<ReleaseCheckState> {
  const fetchImpl = deps.fetchImpl ?? defaultFetchImpl;
  const currentVersion = deps.currentVersion?.() ?? safeGetCurrentVersion();

  const work = Promise.resolve().then(async () => {
    if (deps.delayMs && deps.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, deps.delayMs));
    }
    return fetchImpl();
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReleaseFetchResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({ kind: "network-error", error: `Release check timed out after ${timeoutMs}ms` });
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([work, timeout]);
    return toReleaseCheckState(result, currentVersion);
  } catch (err) {
    return { kind: "network-error", error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function defaultFetchImpl(): ReleaseFetchResult {
  return fetchReleaseDescriptor();
}

function safeGetCurrentVersion(): string {
  try {
    return getBuildInfo().version;
  } catch {
    return "0.0.0";
  }
}

/**
 * Translate the backend `ReleaseFetchResult` into a UI-state value.
 *
 * Logic:
 *   - `descriptor` → compare versions; if newer, return `available`,
 *     else `none`.
 *   - `legacy` (descriptor missing or invalid) → fall back to the
 *     legacy release body. If it is newer than the running version,
 *     return `available` (so the legacy upgrade action still works).
 *   - `network-error` → `network-error`.
 *
 * Exposed for tests that want to assert the mapping without firing
 * the timeout.
 */
export function toReleaseCheckState(
  result: ReleaseFetchResult,
  currentVersion: string,
): ReleaseCheckState {
  if (result.kind === "network-error") {
    return { kind: "network-error", error: result.error };
  }
  if (result.kind === "descriptor") {
    return descriptorToState(result.descriptor, currentVersion);
  }
  // legacy: best-effort, just compare versions
  return legacyToState(result.info, currentVersion);
}

function descriptorToState(descriptor: ReleaseJson, currentVersion: string): ReleaseCheckState {
  if (compareVersions(currentVersion, descriptor.version) >= 0) {
    return { kind: "none" };
  }
  const advisory = descriptor.items.find((i): i is AdvisoryReleaseItem => i.kind === "advisory");
  const channelEol = descriptor.items.find((i): i is ChannelEolReleaseItem => i.kind === "channel_eol");
  return {
    kind: "available",
    version: descriptor.version,
    tag: descriptor.tag_name,
    channel: descriptor.channel,
    items: descriptor.items,
    ...(advisory ? { advisory } : {}),
    ...(channelEol ? { channelEol } : {}),
    descriptor,
  };
}

/**
 * Check if a version string looks like semver (has at least major.minor).
 * Used to validate that legacy tag-derived versions are parseable.
 */
function isLegacyVersionValid(version: string): boolean {
  if (!version) return false;
  const parts = version.split(".");
  if (parts.length < 2) return false;
  return parts.every((part, idx) => {
    if (idx >= 2) return true;
    return /^\d+$/.test(part);
  });
}

function legacyToState(info: ReleaseInfo, currentVersion: string): ReleaseCheckState {
  // REQ-UPGRADE-003: Unparseable legacy tag must produce error state, not {kind:"none"}
  if (!info.version) return { kind: "network-error", error: "Could not determine version from release tag" };
  if (!isLegacyVersionValid(info.version)) {
    return { kind: "network-error", error: `Tag version '${info.version}' is not a valid semantic version` };
  }
  if (compareVersions(currentVersion, info.version) >= 0) {
    return { kind: "none" };
  }
  return {
    kind: "available",
    version: info.version,
    tag: info.tagName,
    channel: "stable",
    items: [],
    descriptor: null,
  };
}

/**
 * Summarize the kinds an `available` release ships with.
 *
 * Returns a short label like "binary + content" or "content-only" or
 * "no binary for this platform" so the banner can communicate what the
 * release will touch without re-walking the descriptor.
 */
export function summarizeReleaseItems(
  items: readonly ReleaseItem[],
  platformTriple: string,
): string {
  const kinds = new Set<string>();
  let hasPlatformBinary = false;
  let hasAnyBinary = false;
  for (const item of items) {
    kinds.add(item.kind);
    if (item.kind === "binary") {
      hasAnyBinary = true;
      if (item.platform === platformTriple) hasPlatformBinary = true;
    }
  }
  if (hasAnyBinary && !hasPlatformBinary) return "no binary for this platform";
  if (kinds.size === 0) return "release";
  // Preserve a stable order: binary, content, migration, advisory, channel_eol
  const order = ["binary", "content", "migration", "advisory", "channel_eol"];
  const present = order.filter((k) => kinds.has(k));
  return present.join(" + ");
}
