/** Session-scoped, read-only project browsing. Paths are always project-relative. */
export type ProjectBrowse = {operation:'list'|'read';path:string;showIgnored:boolean;cursor?:string};
export type ProjectEntry = {name:string;path:string;kind:'directory'|'file'|'unavailable';size?:number};
export type ProjectListing = {path:string;entries:ProjectEntry[];truncated:boolean;nextCursor?:string;ignoreStatus?:'known'|'unknown'|'shown';warning?:string};
export type ProjectContent = {path:string;size:number} & (
 | {kind:'text';content:string}
 | {kind:'image';mime:'image/png'|'image/jpeg'|'image/gif'|'image/webp';base64:string;width:number;height:number}
 | {kind:'limited'|'unsupported';message:string});
