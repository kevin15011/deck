/**
 * Settings package merge utilities for Pi installation.
 * Replaces stale packages (e.g., @dreki-gg/pi-context7) with standard ones (@upstash/context7-mcp).
 */

const STALE_CONTEXT7_PACKAGES = [
  "npm:@dreki-gg/pi-context7",
];

const STANDARD_CONTEXT7_PACKAGE = "npm:@upstash/context7-mcp";

export type MergeSettingsPackagesOptions = {
  settingsPath?: string;
  existingPackages?: string[];
  readFile?: (path: string, encoding: string) => string;
  writeFile?: (path: string, content: string, encoding: string) => void;
};

export type MergeSettingsPackagesResult = {
  success: boolean;
  replacedStale: string[];
  addedStandard: string[];
  finalPackages: string[];
  diagnostics: string[];
};

/**
 * Merges package entries in settings.json, replacing stale packages with standard ones.
 * This ensures @dreki-gg/pi-context7 is replaced by @upstash/context7-mcp automatically.
 */
export function mergeSettingsPackages(
  options: MergeSettingsPackagesOptions = {},
): MergeSettingsPackagesResult {
  const {
    settingsPath,
    existingPackages = [],
    readFile,
    writeFile,
  } = options;

  const replacedStale: string[] = [];
  const addedStandard: string[] = [];
  const diagnostics: string[] = [];
  
  // If settingsPath provided, read existing packages from file
  let finalPackages = [...existingPackages];
  if (settingsPath) {
    try {
      let settingsContent: string;
      if (readFile) {
        settingsContent = readFile(settingsPath, "utf-8");
      } else {
        const fs = require("node:fs");
        settingsContent = fs.readFileSync(settingsPath, "utf-8");
      }
      const settings = JSON.parse(settingsContent);
      if (settings.packages && Array.isArray(settings.packages)) {
        finalPackages = [...settings.packages];
        diagnostics.push(`Read ${settings.packages.length} packages from settings.json`);
      }
    } catch {
      // File might not exist or be parseable - use provided existingPackages
      diagnostics.push("Could not read existing settings.json, using provided packages");
    }
  }

  // Check for stale context7 packages and replace
  for (const stalePkg of STALE_CONTEXT7_PACKAGES) {
    if (finalPackages.includes(stalePkg)) {
      // Remove stale package
      finalPackages = finalPackages.filter((p) => p !== stalePkg);
      replacedStale.push(stalePkg);
      diagnostics.push(`Replaced stale package: ${stalePkg}`);
    }
  }

  // Add standard context7 package if not present
  if (!finalPackages.includes(STANDARD_CONTEXT7_PACKAGE)) {
    finalPackages.push(STANDARD_CONTEXT7_PACKAGE);
    addedStandard.push(STANDARD_CONTEXT7_PACKAGE);
    diagnostics.push(`Added standard package: ${STANDARD_CONTEXT7_PACKAGE}`);
  }

  // Write back to settings if path provided
  if (settingsPath && writeFile) {
    try {
      let settingsContent: string;
      if (readFile) {
        settingsContent = readFile(settingsPath, "utf-8");
      } else {
        const fs = require("node:fs");
        settingsContent = fs.readFileSync(settingsPath, "utf-8");
      }
      const settings = JSON.parse(settingsContent);
      settings.packages = finalPackages;
      writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
      diagnostics.push(`Updated settings.json at ${settingsPath}`);
    } catch (e) {
      diagnostics.push(`Warning: Could not write settings.json: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  return {
    success: replacedStale.length > 0 || addedStandard.length > 0,
    replacedStale,
    addedStandard,
    finalPackages,
    diagnostics,
  };
}
