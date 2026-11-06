import { contributionHash } from '@deck/core';

import provenance from './fixtures/legacy-recognition.json';

/** Exact historical bodies and renderer suffixes from immutable repository snapshots.
 * Recognition grants backed-up regeneration only; installed names and package
 * headings alone never establish ownership. Catalog and package renderer versions
 * evolve independently, so reviewed bodies may use either historical renderer.
 * RTK is the pinned upstream v0.50.0 bridge (Git blob c4450cfa999898fb67d4a09ef2cabaa19296724d).
 * See scripts/generate-opencode-legacy-recognition.ts for reproducible provenance. */
const LEGACY_HASHES: Readonly<Record<string, string>> = Object.freeze({
  'plugins/rtk.ts': '6530c131946c84892f9522abd68d4e513e1e658d8ddbad1f59388c86ebbcb6bb',
});

export function recognizeOpenCodeLegacyFile(path: string, content: string | Uint8Array): boolean {
  const hash = contributionHash(content);
  if (Object.hasOwn(LEGACY_HASHES, path) && hash === LEGACY_HASHES[path]) return true;
  const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
  const start = text.indexOf(provenance.marker);
  return provenance.records.some(record => {
    const body = (record.bodies as Record<string, { raw: string; composed: string } | undefined>)[path];
    if (!body) return false;
    if (hash === body.raw) return true;
    return start >= 0 && contributionHash(text.slice(0, start)) === body.composed
      && provenance.records.some(renderer => renderer.suffixes.includes(contributionHash(text.slice(start))));
  });
}
