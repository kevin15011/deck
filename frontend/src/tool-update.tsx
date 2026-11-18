import React from 'react';
export type ToolUpdate={state:'not_installed'|'check_failed'}|{state:'up_to_date'|'available';latest:string};
export function ToolUpdateButton({update,blocked,onClick}:{update:ToolUpdate;blocked:boolean;onClick:()=>void}){
 return <button type="button" className="quiet" disabled={blocked||update.state!=='available'} onClick={onClick}>{update.state==='available'?`Update to ${update.latest}`:update.state==='up_to_date'?'Up to date':"Couldn't check for updates"}</button>;
}
export function validToolUpdate(v:unknown):v is ToolUpdate{
 if(typeof v!=='object'||v===null)return false;
 const u=v as Record<string,unknown>;
 return u.state==='not_installed'||u.state==='check_failed'||(['up_to_date','available'].includes(u.state as string)&&typeof u.latest==='string'&&u.latest.length<80&&!/[\x00-\x20]/.test(u.latest));
}
