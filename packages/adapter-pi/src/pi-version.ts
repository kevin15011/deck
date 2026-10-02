/** Minimum Pi version Deck supports (`@earendil-works/pi-coding-agent` >= 1.0.0). */
export const PI_MIN_VERSION = "1.0.0";
export const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
export const PI_UPGRADE_HINT = `Install or upgrade Pi with: npm install -g ${PI_PACKAGE_NAME}@latest (Deck requires Pi >= ${PI_MIN_VERSION}).`;

export type ParsedPiVersion = Readonly<{ major: number; minor: number; patch: number; raw: string }>;

export type PiVersionEvaluation = Readonly<{
  supported: boolean;
  version?: string;
  reason?: "below-minimum" | "unparseable" | "unavailable";
  diagnostic?: string;
}>;

const SEMVER = /(?:^|[^0-9.])v?(\d+)\.(\d+)\.(\d+)(?=$|[^0-9])/;

/** Parses the first `major.minor.patch` triple; prerelease/build suffixes are ignored for ordering. */
export function parsePiVersion(output: string | undefined): ParsedPiVersion | undefined {
  if (typeof output !== "string") return undefined;
  const match = SEMVER.exec(output.trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), raw: `${match[1]}.${match[2]}.${match[3]}` };
}

function atLeast(version: ParsedPiVersion, minimum: ParsedPiVersion): boolean {
  if (version.major !== minimum.major) return version.major > minimum.major;
  if (version.minor !== minimum.minor) return version.minor > minimum.minor;
  return version.patch >= minimum.patch;
}

/**
 * Evaluates raw `pi --version` output. `undefined` means the binary could not be run at all.
 * Anything below the minimum, or without a parseable version, is unsupported.
 */
export function evaluatePiVersion(output: string | undefined): PiVersionEvaluation {
  if (output === undefined) {
    return { supported: false, reason: "unavailable", diagnostic: `Pi was not found or could not be run. ${PI_UPGRADE_HINT}` };
  }
  const parsed = parsePiVersion(output);
  if (!parsed) {
    return { supported: false, reason: "unparseable", diagnostic: `Could not determine the Pi version from its output. ${PI_UPGRADE_HINT}` };
  }
  const minimum = parsePiVersion(PI_MIN_VERSION)!;
  if (!atLeast(parsed, minimum)) {
    return { supported: false, version: parsed.raw, reason: "below-minimum", diagnostic: `Pi ${parsed.raw} is not supported; Deck requires Pi >= ${PI_MIN_VERSION}. ${PI_UPGRADE_HINT}` };
  }
  return { supported: true, version: parsed.raw };
}
