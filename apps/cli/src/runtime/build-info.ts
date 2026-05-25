/**
 * Build information runtime module.
 *
 * Provides build-time metadata (version, commit, date, target, channel)
 * at runtime. In development mode, falls back to dev defaults.
 */

import os from "node:os";

export type BuildInfo = {
  /** Semantic version string (e.g., "1.0.0") */
  version: string;
  /** Git commit SHA (short form) */
  commit: string;
  /** ISO-8601 build date */
  date: string;
  /** Target platform (e.g., "linux-x64") */
  target: string;
  /** Release channel */
  channel: "stable" | "beta" | "dev";
};

/**
 * Try to import generated build info. Falls back to dev defaults.
 */
let cachedBuildInfo: BuildInfo | undefined;

function getDevDefaults(): BuildInfo {
  return {
    version: "0.0.0-dev",
    commit: "unknown",
    date: new Date().toISOString().split("T")[0]!,
    target: `${os.platform()}-${os.arch()}`,
    channel: "stable",
  };
}

/**
 * Get build information.
 *
 * In development mode, returns dev defaults.
 * In production binary, reads from the generated module.
 */
export function getBuildInfo(): BuildInfo {
  if (cachedBuildInfo) {
    return cachedBuildInfo;
  }

  try {
    // eslint-disable-next-line import/extensions
    const generated = require("./build-info.generated.js") as {
      BUILD_INFO: BuildInfo;
    };
    if (generated?.BUILD_INFO) {
      cachedBuildInfo = generated.BUILD_INFO;
      return cachedBuildInfo;
    }
  } catch {
    // Generated module not available - use dev defaults
  }

  cachedBuildInfo = getDevDefaults();
  return cachedBuildInfo;
}