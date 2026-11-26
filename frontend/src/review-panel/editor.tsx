import React, {useLayoutEffect,useRef} from 'react';
import {Compartment, EditorSelection, EditorState, type SelectionRange} from '@codemirror/state';
import {drawSelection, EditorView, keymap, lineNumbers, type KeyBinding} from '@codemirror/view';
import {HighlightStyle, syntaxHighlighting} from '@codemirror/language';
import {getChunks, MergeView, uncollapseUnchanged, unifiedMergeView} from '@codemirror/merge';
import {tags as t} from '@lezer/highlight';
import type {Side} from './api';
import {loadLanguage} from './languages';

export type Layout = 'inline'|'split';
type Bookmark = {
 range:SelectionRange; before?:SelectionRange; anchor:number; offset:number; left:number; expanded:Set<number>;
};

const syntax = syntaxHighlighting(HighlightStyle.define([
 {tag:[t.keyword,t.modifier,t.operatorKeyword],color:'var(--md-em)'},
 {tag:[t.string,t.special(t.string),t.regexp],color:'var(--md-inline)'},
 {tag:[t.number,t.bool,t.null,t.atom],color:'var(--md-strong)'},
 {tag:[t.typeName,t.className,t.definition(t.propertyName)],color:'var(--md-heading)'},
 {tag:[t.function(t.variableName),t.function(t.propertyName),t.tagName],color:'var(--link)'},
 {tag:[t.comment,t.lineComment,t.blockComment],color:'var(--muted)',fontStyle:'italic'},
 {tag:[t.operator,t.punctuation],color:'var(--soft)'},
]));

const collapseUnchanged = {margin:3,minSize:6};
const diffConfig = {scanLimit:1000,timeout:35};

type Movement = (view:EditorView, range:SelectionRange) => SelectionRange;
function move(key:string, direction:Movement, collapse?:'from'|'to'):KeyBinding {
 const run = (view:EditorView, extend:boolean) => {
  const range = view.state.selection.main;
  const target = !extend && collapse && !range.empty ? range[collapse] : direction(view,range).head;
  view.dispatch({selection:{anchor:extend ? range.anchor : target,head:target},scrollIntoView:true});
  return true;
 };
 return {key,run:view=>run(view,false),shift:view=>run(view,true)};
}

const navigation = keymap.of([
 move('ArrowLeft',(v,r)=>v.moveByChar(r,false),'from'),
 move('ArrowRight',(v,r)=>v.moveByChar(r,true),'to'),
 move('ArrowUp',(v,r)=>v.moveVertically(r,false)),
 move('ArrowDown',(v,r)=>v.moveVertically(r,true)),
 move('Mod-ArrowLeft',(v,r)=>v.moveByGroup(r,false)),
 move('Mod-ArrowRight',(v,r)=>v.moveByGroup(r,true)),
 move('Home',(v,r)=>v.moveToLineBoundary(r,false)),
 move('End',(v,r)=>v.moveToLineBoundary(r,true)),
 move('Mod-Home',()=>EditorSelection.cursor(0)),
 move('Mod-End',v=>EditorSelection.cursor(v.state.doc.length)),
 {key:'Mod-a',run:view=>{
  view.dispatch({selection:{anchor:0,head:view.state.doc.length}});
  return true;
 }},
]);

const sideLabels = {
 absent:'File absent', binary:'Binary file', encoding:'Unsupported text encoding',
 tooLarge:'File exceeds the display limit', symlink:'Symbolic link', gitlink:'Git submodule',
 special:'Special file', unavailable:'Content unavailable',
};
const content = (side:Side|null) => side?.kind === 'text' ? side.text : '';
const viewable = (side:Side|null) => side?.kind === 'text' || side?.kind === 'absent';

function SideNotice({side,label}:{side:Side|null;label:string}) {
 if (!side || side.kind === 'text') return null;
 return <span>{label} · {sideLabels[side.kind]}{'bytes' in side && side.bytes !== null && ` · ${side.bytes.toLocaleString()} bytes`}</span>;
}

type Props = {
 path:string; oldPath:string|null; before:Side|null; after:Side; layout:Layout;
 bookmarkKey:string; bookmarks:Map<string,Bookmark>;
};

export default function ReviewEditor({path,oldPath,before,after,layout,bookmarkKey,bookmarks}:Props) {
 const mount = useRef<HTMLDivElement>(null);
 const oldText = content(before), newText = content(after);
 const diff = viewable(before) && viewable(after) && (before?.kind === 'text' || after.kind === 'text');
 const split = diff && layout === 'split';
 const showBefore = !diff && after.kind !== 'text' && before?.kind === 'text';
 const hasText = diff || after.kind === 'text' || showBefore;
 const label = diff ? 'Inline diff' : showBefore ? 'Before' : 'File content';

 useLayoutEffect(() => {
  const parent = mount.current;
  if (!parent || !hasText) return;
  const nonce = document.querySelector<HTMLScriptElement>('script[type="module"][src="/app.js"]')?.nonce ?? '';
  const previous = bookmarks.get(bookmarkKey);
  const language = new Compartment(), originalLanguage = new Compartment();
  const expanded = new Set(previous?.expanded);
  const rememberContext = EditorView.updateListener.of(({transactions}) => {
   for (const transaction of transactions) {
    for (const effect of transaction.effects) if (effect.is(uncollapseUnchanged)) expanded.add(effect.value);
   }
  });
  const extensions = (name:string, grammar:Compartment) => [
   EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.cspNonce.of(nonce),
   EditorView.contentAttributes.of({tabindex:'0','aria-label':name,'aria-readonly':'true'}),
   grammar.of([]), syntax, lineNumbers(), drawSelection(), navigation,
  ];
  const selection = (text:string, range?:SelectionRange) => {
   // CodeMirror normalizes CRLF to one position.
   const length = text.replace(/\r\n/g,'\n').length;
   return range && EditorSelection.single(Math.min(range.anchor,length),Math.min(range.head,length));
  };

  let editor:EditorView, original:EditorView|undefined, destroy:()=>void;
  let scroller:HTMLElement;
  if (split) {
   const merge = new MergeView({
    parent,
    a:{doc:oldText,selection:selection(oldText,previous?.before),extensions:extensions('Before',originalLanguage)},
    b:{doc:newText,selection:selection(newText,previous?.range),extensions:[extensions('After',language),rememberContext]},
    highlightChanges:true, collapseUnchanged,diffConfig,
   });
   original = merge.a;
   editor = merge.b;
   scroller = merge.dom;
   destroy = () => merge.destroy();
  } else {
   const text = showBefore ? oldText : newText;
   const config = extensions(label,language);
   if (diff) config.push(rememberContext,unifiedMergeView({original:oldText,highlightChanges:true,allowInlineDiffs:true,
    mergeControls:false,collapseUnchanged,diffConfig}));
   const state = EditorState.create({doc:text,extensions:config,
    selection:selection(text,showBefore ? previous?.before : previous?.range)});
   editor = new EditorView({parent,state});
   scroller = editor.scrollDOM;
   destroy = () => editor.destroy();
  }

  if (diff && expanded.size) {
   const positions = [...expanded].filter(pos=>pos <= editor.state.doc.length);
   editor.dispatch({effects:positions.map(pos=>uncollapseUnchanged.of(pos))});
   if (original) {
    const chunks = getChunks(editor.state)?.chunks ?? [];
    const effects = positions.map(pos => {
     let offset = 0;
     for (const chunk of chunks) {
      if (chunk.fromB >= pos) break;
      offset = chunk.toA - chunk.toB;
     }
     return uncollapseUnchanged.of(pos + offset);
    });
    original.dispatch({effects});
   }
  }

  if (previous) editor.requestMeasure({
   read: view => view.lineBlockAt(Math.min(previous.anchor,view.state.doc.length)).top +
    view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop + previous.offset,
   write: top => {scroller.scrollTop = top; scroller.scrollLeft = previous.left;},
  });

  const exposeContextButtons = () => {
   for (const button of parent.querySelectorAll<HTMLElement>('.cm-collapsedLines:not([tabindex])')) button.tabIndex = 0;
  };
  const activateContext = (event:KeyboardEvent) => {
   if ((event.key !== 'Enter' && event.key !== ' ') || !(event.target instanceof HTMLElement) ||
    !event.target.matches('.cm-collapsedLines')) return;
   event.preventDefault();
   const view = event.target.closest<HTMLElement>('.cm-editor');
   event.target.click();
   if (view) EditorView.findFromDOM(view)?.focus();
  };
  const contextObserver = new MutationObserver(exposeContextButtons);
  exposeContextButtons();
  contextObserver.observe(parent,{childList:true,subtree:true});
  parent.addEventListener('keydown',activateContext);

  let alive = true;
  const colorize = (view:EditorView, grammar:Compartment, filename:string) => {
   void loadLanguage(filename).then(extension => {
    if (alive) view.dispatch({effects:grammar.reconfigure(extension)});
   }).catch(() => { /* The text remains readable when a grammar is unavailable. */ });
  };
  colorize(editor,language,showBefore ? oldPath ?? path : path);
  if (original) colorize(original,originalLanguage,oldPath ?? path);

  return () => {
   alive = false;
   contextObserver.disconnect();
   parent.removeEventListener('keydown',activateContext);
   if (parent.getClientRects().length) {
    const height = scroller.getBoundingClientRect().top - editor.documentTop;
    const block = editor.lineBlockAtHeight(height);
    const range = editor.state.selection.main;
    bookmarks.delete(bookmarkKey);
    bookmarks.set(bookmarkKey,{
     anchor:block.from,offset:height-block.top,left:scroller.scrollLeft,expanded,
     range:showBefore ? previous?.range ?? EditorSelection.cursor(0) : range,
     before:showBefore ? range : original?.state.selection.main ?? previous?.before,
    });
    if (bookmarks.size > 24) bookmarks.delete(bookmarks.keys().next().value!);
   }
   destroy();
  };
 },[path,oldPath,oldText,newText,diff,split,hasText,showBefore,label,bookmarkKey,bookmarks]);

 return <>
  {(before && before.kind !== 'text' || after.kind !== 'text') && <div className="review-side-notice" role="status">
   <SideNotice side={before} label="Before"/><SideNotice side={after} label={before ? 'After' : 'Current'}/>
  </div>}
  {split && <div className="review-side-labels" aria-hidden="true"><span>Before</span><span>After</span></div>}
  {hasText && <div ref={mount} className="review-code" aria-label={split ? 'Side-by-side diff' : label}/>}
 </>;
}
