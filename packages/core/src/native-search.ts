import { createHash } from 'node:crypto';
import { canonicalContributionJson } from './runner-contributions';
export type NativeSearchEvidence = {
  availability: 'available' | 'unavailable' | 'unknown'; reason: string; mode?: string;
  configFingerprint: string; evidenceSource: 'tool-inventory' | 'effective-config' | 'provider-contract';
  /** Explicit web-access denials constrain fallback too. */
  webAllowed?: boolean;
  ownedFallbackServerIds?: string[];
  unresolvedFallbackServerIds?: string[];
};
export type NativeSearchInspectionInput = {
  projectRoot: string; modelId?: string; providerId?: string; runnerVersion?: string;
  environment?: Readonly<Record<string, string | undefined>>; flags?: readonly string[];
  projectConfigTrusted?: boolean;
  /** Only a supported actual tool inventory, never arbitrary name matching. */
  exposedTools?: readonly string[];
};
/** Callers pass only non-secret capability facts, not raw environment/configuration. */
export function nativeSearchEvidence(availability: NativeSearchEvidence['availability'], evidenceSource: NativeSearchEvidence['evidenceSource'], facts: Record<string, unknown>, reason: string = availability): NativeSearchEvidence {
  return { availability, evidenceSource, reason, configFingerprint: createHash('sha256').update(canonicalContributionJson(facts)).digest('hex') };
}
export function selectSearchRoute(enabled: boolean, native: NativeSearchEvidence, fallbackUsable: boolean): { route: 'disabled' | 'native' | 'fallback'; diagnostics: string[] } {
  if (!enabled || native.webAllowed === false) return { route: 'disabled', diagnostics: native.webAllowed === false ? ['web-search-authority-denied'] : [] };
  if (native.availability === 'available') return { route: 'native', diagnostics: [] };
  if (!fallbackUsable) throw new Error('web-search-fallback-unavailable: configure a supported Deck provider and its credential');
  return { route: 'fallback', diagnostics: native.availability === 'unknown' ? ['native-search-detection-defect', 'native-search-possible-duplicate'] : [] };
}
