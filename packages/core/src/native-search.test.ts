import { expect, test } from 'bun:test';
import { nativeSearchEvidence, selectSearchRoute } from './native-search';
test('native wins, disabled injects nothing, unknown requires fallback and warns', () => {
  const native = nativeSearchEvidence('available', 'tool-inventory', { model: 'current' });
  expect(selectSearchRoute(true, native, false)).toEqual({ route: 'native', diagnostics: [] });
  expect(selectSearchRoute(false, native, false).route).toBe('disabled');
  expect(selectSearchRoute(true, nativeSearchEvidence('unknown', 'effective-config', {}), true)).toEqual({ route: 'fallback', diagnostics: ['native-search-detection-defect', 'native-search-possible-duplicate'] });
  expect(() => selectSearchRoute(true, nativeSearchEvidence('unavailable', 'effective-config', {}), false)).toThrow('fallback');
  expect(selectSearchRoute(true, { ...native, webAllowed: false }, true).route).toBe('disabled');
});
