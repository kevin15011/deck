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
  decideReleaseAvailability,
  fetchReleaseDescriptor,
  type AvailabilityDecision,
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
      /** Availability reason for display (REQ-UD-007) */
      reason: "newer-version" | "same-version-different-commit";
      /** Current commit (if available) for context */
      currentCommit?: string;
      /** Latest commit (if available) for context */
      latestCommit?: string;
    }
  | { kind: "none"; reason?: "same-build" | "local-newer" | "missing-commit" | "dev-build" }
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
  /** Returns the running Deck commit; defaults to `getBuildInfo().commit`. */
  currentCommit?: () => string | null | undefined;
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
  const currentCommit = deps.currentCommit?.() ?? safeGetCurrentCommit();

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
    return toReleaseCheckState(result, currentVersion, currentCommit);
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

function safeGetCurrentCommit(): string | null {
  try {
    return getBuildInfo().commit ?? null;
  } catch {
    return null;
  }
}

/**
 * Translate the backend `ReleaseFetchResult` into a UI-state value.
 *
 * Logic:
 *   - `network-error` → `network-error`
 *   - `descriptor` or `legacy` → use decideReleaseAvailability for commit-aware comparison
 *
 * Exposed for tests that want to assert the mapping without firing
 * the timeout.
 */
export function toReleaseCheckState(
  result: ReleaseFetchResult,
  currentVersion: string,
  currentCommit?: string | null,
): ReleaseCheckState {
  if (result.kind === "network-error") {
    return { kind: "network-error", error: result.error };
  }

  // Extract version and commit from the result
  let latestVersion: string;
  let latestCommit: string | null | undefined;

  if (result.kind === "descriptor") {
    latestVersion = result.descriptor.version;
    latestCommit = result.commit;
  } else {
    latestVersion = result.info.version;
    latestCommit = result.info.commit;
  }

  // Use the commit-aware availability decision helper
  const decision = decideReleaseAvailability(
    currentVersion,
    currentCommit ?? null,
    latestVersion,
    latestCommit ?? null,
  );

  if (decision.kind === "network-error") {
    return { kind: "network-error", error: "Could not determine version" };
  }

  if (decision.kind === "none") {
    return { kind: "none", reason: decision.reason as "same-build" | "local-newer" | "missing-commit" | "dev-build" };
  }

  // Available - build the state with reason and commit context
  if (result.kind === "descriptor") {
    return descriptorToStateWithReason(result.descriptor, decision.reason, currentCommit ?? undefined, latestCommit ?? undefined);
  }
  return legacyToStateWithReason(result.info, decision.reason, currentCommit ?? undefined, latestCommit ?? undefined);
}

function descriptorToStateWithReason(
  descriptor: ReleaseJson,
  reason: "newer-version" | "same-version-different-commit",
  currentCommit?: string,
  latestCommit?: string,
): ReleaseCheckState {
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
    reason,
    currentCommit,
    latestCommit,
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

function legacyToStateWithReason(
  info: ReleaseInfo,
  reason: "newer-version" | "same-version-different-commit",
  currentCommit?: string,
  latestCommit?: string,
): ReleaseCheckState {
  // REQ-UPGRADE-003: Unparseable legacy tag must produce error state, not {kind:"none"}
  if (!info.version) return { kind: "network-error", error: "Could not determine version from release tag" };
  if (!isLegacyVersionValid(info.version)) {
    return { kind: "network-error", error: `Tag version '${info.version}' is not a valid semantic version` };
  }
  return {
    kind: "available",
    version: info.version,
    tag: info.tagName,
    channel: "stable",
    items: [],
    descriptor: null,
    reason,
    currentCommit,
    latestCommit,
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
