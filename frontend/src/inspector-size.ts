export function clampInspectorWidth(value:number,available:number){return Math.min(Math.max(0,available-24),Math.max(320,Math.min(960,Number.isFinite(value)?value:440)));}
export function readInspectorWidth(value:string){const n=Number(value);return value.trim()&&Number.isFinite(n)?n:440;}

export type InspectorPosition={x:number|null;y:number;height:number|null};
export type InspectorRect={x:number;y:number;width:number;height:number};
export function readInspectorRect(value:string):InspectorPosition {
 try{const v=JSON.parse(value);return {x:typeof v?.x==='number'&&Number.isFinite(v.x)?v.x:null,y:typeof v?.y==='number'&&Number.isFinite(v.y)?v.y:12,height:typeof v?.height==='number'&&Number.isFinite(v.height)&&v.height>0?v.height:null};}catch{return {x:null,y:12,height:null};}
}
export function clampInspectorRect(value:{x:number|null;y:number;width:number;height:number|null},area:{width:number;height:number}):InspectorRect {
 const width=clampInspectorWidth(value.width,area.width),maxHeight=Math.max(0,area.height-24);
 const height=Math.min(maxHeight,Math.max(Math.min(180,maxHeight),value.height!==null&&Number.isFinite(value.height)?value.height:maxHeight));
 const x=Math.max(12,Math.min(area.width-width-12,value.x!==null&&Number.isFinite(value.x)?value.x:area.width-width-12));
 const y=Math.max(12,Math.min(area.height-height-12,Number.isFinite(value.y)?value.y:12));
 return {x,y,width,height};
}
