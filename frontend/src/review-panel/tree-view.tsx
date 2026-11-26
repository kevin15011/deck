import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import type {Entry, Stat} from './api';
import type {TreeRow} from './tree';

const rowHeight = 30;
const overscan = 6;
const statusNames = {M:'Modified', A:'Added', D:'Deleted', U:'Untracked', R:'Renamed'} as const;
export const statusName = (entry:Entry) =>
 entry.detail === 'conflict' ? 'Conflict' : entry.status ? statusNames[entry.status] : '';

function RowIcon({row}:{row:TreeRow}) {
 return <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeLinejoin="round">
  {row.entry ? <path d="M4 2.5h5l3 3v8H4z M9 2.5v3h3"/> :
   <path d="M1.5 4h5l1.5 1.5h6.5v7H1.5z"/>}
 </svg>;
}

type Props = {
 rows:TreeRow[]; selection?:Entry; stats:ReadonlyMap<string,Stat>; filtered:boolean;
 onToggle:(key:string) => void; onSelect:(entry:Entry) => void;
 onPrefetch:(entry?:Entry) => void; onVisible:(ids:string[]) => void;
};

export function TreeView({rows,selection,stats,filtered,onToggle,onSelect,onPrefetch,onVisible}:Props) {
 const viewport = useRef<HTMLDivElement>(null);
 const prefix = useId();
 const [focused,setFocused] = useState('');
 const [window,setWindow] = useState({top:0,height:240});
 const selectedIndex = rows.findIndex(row => row.entry?.path === selection?.path && row.entry);
 const focusedIndex = rows.findIndex(row => row.key === focused);
 const active = focusedIndex >= 0 ? focusedIndex : Math.max(0,selectedIndex);
 const first = Math.min(Math.max(0,rows.length-1),Math.floor(window.top / rowHeight));
 const end = Math.min(rows.length,first + Math.ceil(window.height / rowHeight) + 1);
 const startRender = Math.max(0,first - overscan);
 const endRender = Math.min(rows.length,end + overscan);
 const visible = rows.slice(startRender,endRender).map((row,i) => ({row,index:startRender+i}));
 // Keep the focused item in the accessibility tree when the list is scrolled by pointer.
 if (rows[active] && (active < startRender || active >= endRender)) visible.push({row:rows[active],index:active});
 const activeId = (index:number) => prefix + '-row-' + index;
 const visibleIds = JSON.stringify(rows.slice(first,end).flatMap(row => row.entry?.status ? [row.entry.id] : []));

 useLayoutEffect(() => {
  const element = viewport.current;
  if (!element) return;
  const observe = new ResizeObserver(() => setWindow({top:element.scrollTop,height:element.clientHeight}));
  observe.observe(element);
  return () => observe.disconnect();
 },[]);
 useEffect(() => {
  const ids:string[] = JSON.parse(visibleIds);
  if (ids.length) onVisible(ids);
 },[visibleIds,stats,onVisible]);

 function focusRow(index:number) {
  const row = rows[index], element = viewport.current;
  if (!row || !element) return;
  setFocused(row.key);
  if (index * rowHeight < element.scrollTop) element.scrollTop = index * rowHeight;
  if ((index + 1) * rowHeight > element.scrollTop + element.clientHeight) {
   element.scrollTop = (index + 1) * rowHeight - element.clientHeight;
  }
  onPrefetch(row.entry);
 }

 function activate(row:TreeRow) {
  if (row.entry) onSelect(row.entry);
  else if (row.expanded !== undefined && !filtered) onToggle(row.key);
 }

 return <div className="review-tree" ref={viewport} role="tree" aria-label="Review files" tabIndex={0}
   aria-activedescendant={rows[active] ? activeId(active) : undefined}
   onFocus={() => onPrefetch(rows[active]?.entry)} onBlur={() => onPrefetch()}
   onScroll={e => setWindow({top:e.currentTarget.scrollTop,height:e.currentTarget.clientHeight})}
   onKeyDown={event => {
    const row = rows[active];
    if (!row) return;
    switch (event.key) {
     case 'ArrowDown': focusRow(Math.min(active+1,rows.length-1)); break;
     case 'ArrowUp': focusRow(Math.max(0,active-1)); break;
     case 'Home': focusRow(0); break;
     case 'End': focusRow(rows.length-1); break;
     case 'ArrowRight':
      if (row.expanded === false) onToggle(row.key);
      else if (row.expanded && rows[active+1]?.parent === row.key) focusRow(active+1);
      break;
     case 'ArrowLeft':
      if (row.expanded && !filtered) onToggle(row.key);
      else if (row.parent) focusRow(rows.findIndex(candidate => candidate.key === row.parent));
      break;
     case 'Enter': case ' ': activate(row); break;
     default: return;
    }
    event.preventDefault();
   }}>
  <div role="presentation" className="review-tree-space" style={{height:rows.length*rowHeight}}>
   {visible.map(({row,index}) => {
    const entry = row.entry;
    const status = entry && statusName(entry);
    const stat = entry && stats.get(entry.id);
    const selected = !!entry && entry.path === selection?.path;
    return <div key={row.key} id={activeId(index)} role="treeitem" className="review-tree-row"
      style={{top:index*rowHeight,height:rowHeight,paddingInlineStart:8+(row.depth-1)*14}}
      title={entry?.oldPath ? entry.oldPath+' → '+row.title : row.title}
      aria-level={row.depth} aria-posinset={row.position} aria-setsize={row.siblings}
      aria-expanded={row.expanded} aria-selected={entry ? selected : undefined}
      data-active={index===active}
      onPointerEnter={() => onPrefetch(entry)} onPointerLeave={() => onPrefetch()}
      onClick={() => {setFocused(row.key);viewport.current?.focus({preventScroll:true});activate(row);}}>
     <span className="review-tree-chevron" aria-hidden="true">{row.expanded === undefined ? '' : row.expanded ? '⌄' : '›'}</span>
     <RowIcon row={row}/><span className="review-row-label">{row.label}</span>
     {entry?.oldPath && <span className="sr-only">Renamed from {entry.oldPath}</span>}
     {row.expanded === false && row.changes > 0 &&
      <span className="review-folder-changes" aria-label={row.changes+' changed files'}>{row.changes}</span>}
     {entry?.status && <span className="review-status-badge" data-status={entry.detail ?? entry.status}
      aria-label={status} title={status}>{entry.status}{entry.status === 'U' && <small> {status}</small>}</span>}
     {stat?.kind === 'lines' && <span className="review-line-stats"><span>+{stat.added}</span><span>−{stat.deleted}</span></span>}
    </div>;
   })}
  </div>
 </div>;
}
