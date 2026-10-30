import React, {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Tabs} from '../src/workspace';
import {QuotaSectionView} from '../src/quota';
import {useActiveIndicator,useViewMotion} from '../src/view-motion';
import {gsap} from '../src/motion';
import '../src/style.css';
function Fixture(){
 const [tab,setTab]=useState<any>('activity'), [mode,setMode]=useState('both'), [closed,setClosed]=useState(true);
 const ref=useRef<HTMLDivElement>(null), modes=useRef<HTMLDivElement>(null);
 useViewMotion(ref,`${mode}:${tab}`); useActiveIndicator(modes,mode,'[aria-pressed="true"]');
 Object.assign(window,{fixture:{dispose:()=>root.unmount(),gsap}});
 return <div ref={ref} className={`app-body content-${mode}`} style={{height:700}}><div ref={modes} className="content-modes">{['chat','both','workspace'].map(m=><button key={m} aria-pressed={m===mode} onClick={()=>setMode(m)}>{m}</button>)}</div><Tabs active={tab} onChange={setTab}/><div className="panes"><main className="chat-pane" hidden={mode==='workspace'}><textarea defaultValue="kept"/></main><aside className="workspace-pane" hidden={mode==='chat'}>{['activity','subagents','git'].map(t=><div key={t} className="workspace-panel" hidden={t!==tab} style={{height:240,overflow:'auto'}}><div style={{height:2000}}>{t}<button>Panel action</button></div></div>)}</aside></div><QuotaSectionView collapsed={closed} onToggle={()=>setClosed(v=>!v)} state={{runners:{claude:{refreshAfter:0,refreshing:false},codex:{refreshAfter:0,refreshing:false}}}} now={0} loading={false} message="" onRefresh={()=>{}}/></div>;
}
const root=createRoot(document.getElementById('root')!);root.render(<Fixture/>);
