import {test,expect} from 'bun:test';
import {clampInspectorWidth,readInspectorWidth,clampInspectorRect,readInspectorRect} from './inspector-size';
// Protects stored width validation and safe layout after viewport changes; oracle: round 1 min/max.
test('stored width defaults safely and clamps to viewport, min and max',()=>{
 expect(readInspectorWidth('')).toBe(440);expect(readInspectorWidth('no')).toBe(440);expect(readInspectorWidth('620')).toBe(620);
 expect(clampInspectorWidth(620,1440)).toBe(620);expect(clampInspectorWidth(-10,1440)).toBe(320);expect(clampInspectorWidth(5000,1440)).toBe(960);expect(clampInspectorWidth(620,390)).toBe(366);
});

// Protects persisted floating geometry at the viewport boundary; oracle: decision 16.
test('floating geometry stays reachable after drag, resize and corrupted storage',()=>{
 const bounds={width:1000,height:700};
 const box=clampInspectorRect({x:900,y:-50,width:600,height:900},bounds);
 expect(box).toEqual({x:388,y:12,width:600,height:676});
 const tiny=clampInspectorRect({x:-100,y:999,width:NaN,height:Infinity},{width:250,height:120});
 expect(tiny).toEqual({x:12,y:12,width:226,height:96});
 expect(readInspectorRect('{bad')).toEqual({x:null,y:12,height:null});
 expect(readInspectorRect('{"x":40,"y":30,"height":400}')).toEqual({x:40,y:30,height:400});
 expect(readInspectorRect('{"x":"bad","y":null,"height":-1}')).toEqual({x:null,y:12,height:null});
});
