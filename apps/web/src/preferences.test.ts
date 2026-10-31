import { expect, test } from 'bun:test';
import { readFont, readSplit, resolveFont, resolveSplit } from './preferences';
test('preferences fall back safely and constrain saved split', () => {
 expect(resolveFont('unknown')).toBe('system');
 expect(resolveFont('inter')).toBe('inter');
 expect(resolveSplit('NaN')).toBe(50);
 expect(resolveSplit('')).toBe(50);
 expect(resolveSplit('5')).toBe(25);
 expect(resolveSplit('90')).toBe(75);
 expect(readFont(() => { throw Error(); })).toBe('system');
 expect(readSplit(() => { throw Error(); })).toBe(50);
});
