import { expect, test } from 'bun:test';
import { applyOrder, moveId } from './ordering';

const id = (item: string) => item;
test('saved order wins; unknown items anchor after their preceding known neighbour', () => {
    expect(applyOrder(['a', 'b', 'c'], ['c', 'a', 'b'], id)).toEqual(['c', 'a', 'b']);
    expect(applyOrder(['new', 'a', 'b', 'c'], ['c', 'a', 'b'], id)).toEqual(['new', 'c', 'a', 'b']);
    expect(applyOrder(['a', 'b', 'c', 'older'], ['c', 'a', 'b'], id)).toEqual(['c', 'older', 'a', 'b']);
    expect(applyOrder(['a', 'b'], [], id)).toEqual(['a', 'b']);
    expect(applyOrder(['a', 'b'], ['gone', 'b', 'a'], id)).toEqual(['b', 'a']);
});
test('moveId places the dragged id in the target slot and ignores unknown ids', () => {
    expect(moveId(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(moveId(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveId(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
    expect(moveId(['a', 'b'], 'x', 'a')).toEqual(['a', 'b']);
});
