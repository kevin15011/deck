import {useActivity,LiveActivity,ActivityTimeline} from './activity';
import {subagentErrorCount,workerCounts} from './sidebar-state';
import {attachComposerFocus} from './composer-focus';
import {MessageCopy,MessageTime} from './message-copy';
import {ProcessingProgress} from './processing-progress';
import {Sidebar,SidebarOpener,useSidebarAttention,type Navigation} from './sidebar';
import {useDisplayedReplies,LeadReplyText,leadMessageText} from './lead-replies';
import {useSentMessageMotion} from './chat-motion';
import {usePushNotifications,usePushPresence,NotificationsDialog} from './push-notifications';
import {useOriginalHistory,OriginalConversation,OriginalMessages} from './history';
import {SessionLoading} from './session-loading';
import {ApprovalChip} from './session-approvals';
import {ComposerAction} from './composer-action';
import {useLiveSteering} from './live-steering';
import {admitCommand,acknowledgedDraft} from './command-admission';
import {InputQueue} from './input-queue-view';
import {cancelQueuedInput} from './input-queue';
import {SessionMenu} from './session-menu';
import {DictationControl,type DraftStore} from './dictation/composer';
import {Subagents} from './subagents';
import {InlineSubagents} from './inline-subagents';
import {Inspector} from './inspector';
import {conversationTimeline,timelineRowCost} from './conversation-timeline';
import {LiveTranscriptWindow} from './transcript-window';
import {restoreTranscriptPosition} from './transcript-scroll';
import {StatusIndicator} from './status-indicator';
import {ContextWindowIndicator,contextReading,leadContextReceipt} from './context-window';
import {SecondaryInfoProvider} from './secondary-info';
import {QuotaSection} from './quota';
import {SessionBranch} from './session-branch';
import {useComposerKeyboard,composerEnterSubmits} from './composer-keyboard';
import {escapeInput,restoreInput,reconcileRecalls} from './input-recall';
import {NavigationIcon} from './navigation-icon';
import {WorkspaceDialog} from './workspace-dialogs';
import {SessionConfiguration} from './session-configuration';
import {GitChanges,useGitCatalog} from './git-changes';
import {useImageRemoval,useImages,ImagePicker,ImagePreview,imageURL,type Preview} from './images';
import {Appearance} from './appearance';
import {useInstallDeck} from './install-settings';
import {BrowserDeviceOffer} from './browser-device';
import {createThemeReveal} from './theme-reveal';
import {PaneDivider} from './pane-divider';
import {readPreference,savePreference,resolveTheme,resolveFont,resolveSplit,resolveContentMode,resolveChatWidth,resolveSidebarPinned,type ContentMode} from './preferences';
import {AgentSettings} from './appearance';
import {gsap} from 'gsap';
import React,{useEffect,useLayoutEffect,useRef,useState,useMemo,useCallback} from 'react';
import {createRoot} from 'react-dom/client';
import {sidebarPanelId,useSidebarPanel} from './drawer-motion';
import {API,active,phase,receipt,workspace,request,setProjectContext,HttpError,commandNotAccepted,load,save,type Workspace,type Receipt,type Mode} from './api';
import {Tasks} from './tasks';
import {pendingCommands,forgetCommand,matchesCommand,type PendingCommand} from './command-pending';
import {beginCommandTiming,markCommandRequest,markCommandHeaders,observeCommandReceipt} from './command-timing';
import {ChangeView} from './change';
import {Review} from './review';
import {SessionDecisions,type DecisionSelection} from './decisions';
import {DeckBrand} from './deck-logo';
import {Markdown} from './markdown';
import {ReceiptDetails,usePanelMotion,useEntrances} from './motion';
import {useActiveIndicator,useDisclosureMotion} from './view-motion';
import './font-faces.css';
import './style.css';
import './themes.css';
import './slice.css';
import './calm-workspace.css';
const quotaApi=(path:string,init?:RequestInit)=>request(init?.method??'GET',path,init?.body?JSON.parse(String(init.body)):undefined,init?.signal??undefined);
function outsidePanel(event:React.MouseEvent<HTMLDialogElement>){
 const bounds=event.currentTarget.getBoundingClientRect();
 return event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom;
}
function App({authError='',offerRemember=false}:{authError?:string;offerRemember?:boolean}){
 const installDeck=useInstallDeck();
 const [historyReady,setHistoryReady]=useState(false);
 const [positionedHistoryTarget,setPositionedHistoryTarget]=useState<string>();
 const [sidebarMeta,setSidebarMeta]=useState<Navigation>({projects:{},sessions:{}});
 const [decisionSelection,setDecisionSelection]=useState<DecisionSelection>();
 const selectionRef=useRef<DecisionSelection|undefined>(undefined),submissionSelection=useRef<{id:string;selection:DecisionSelection|undefined}|undefined>(undefined);
 function selectDecision(value:DecisionSelection|undefined){selectionRef.current=value;setDecisionSelection(value);}
 const [w,setW]=useState<Workspace>(),[error,setError]=useState(authError),[connected,setConnected]=useState(false),[busy,setBusy]=useState(false);
 const [openingSession,setOpeningSession]=useState<{id:string;name:string;error?:string}>();
 const sessionSwitch=useRef<{id:string;frame:number} | undefined>(undefined);
 const latestWorkspace=useRef(w);
 useLayoutEffect(()=>{latestWorkspace.current=w;},[w]);
 useLayoutEffect(()=>()=>{if(sessionSwitch.current)cancelAnimationFrame(sessionSwitch.current.frame);},[]);
 const notifications=usePushNotifications(quotaApi);
 const [notificationsOpen,setNotificationsOpen]=useState(false);
 const original=useOriginalHistory(connected,setError);
 const [continuationIssue,setContinuationIssue]=useState('');
 const [draft,setDraft]=useState(''),[pending,setPending]=useState(''),[selected,setSelected]=useState(''),[fresh,setFresh]=useState(false);
 const scope=useRef(''),selectedRef=useRef('');
 const removeImageMotion=useImageRemoval();
 const images=useImages(setError),[preview,setPreview]=useState<Preview>();
 const [legacy,setLegacy]=useState(()=>load('draft')||load('unassigned-draft'));
 const [creationProject,setCreationProject]=useState('');
 const [sessionDialog,setSessionDialog]=useState<'new'|'assignments'|'transition'|null>(null);
 const [trustBusy,setTrustBusy]=useState(false);
 const [mode,setMode]=useState<Mode>(()=>load('mode')==='reviewed_edit'?'reviewed_edit':'read_only');
 const [dictationSettings,setDictationSettings]=useState(false);
 const [chatWidth,setChatWidth]=useState(()=>resolveChatWidth(readPreference('chat-width')));
 const [settingsOpen,setSettingsOpen]=useState(false),[font,setFont]=useState(()=>resolveFont(readPreference('font'))),[split,setSplit]=useState(()=>resolveSplit(readPreference('pane-split')));
 const [theme,setTheme]=useState(()=>resolveTheme(readPreference('theme'))),[tab,setTab]=useState('activity'),[nav,setNav]=useState(false),[retry,setRetry]=useState(0);
 const [sidebarPinned,setSidebarPinned]=useState(()=>resolveSidebarPinned(readPreference('sidebar-pinned'),readPreference('sidebar-collapsed'))),[contentMode,setContentMode]=useState(()=>resolveContentMode(readPreference('content-mode'),readPreference('workspace-collapsed')));
 const reveal=useRef<ReturnType<typeof createThemeReveal>|null>(null);
 useLayoutEffect(()=>{document.documentElement.dataset.theme=theme;reveal.current=createThemeReveal();return()=>{reveal.current?.dispose();reveal.current=null;};},[]);
 const composerDock=useRef<HTMLDivElement>(null),composerWrap=useRef<HTMLDivElement>(null),composerInput=useRef<HTMLTextAreaElement>(null);
 const bindComposerInput=useCallback((input:HTMLTextAreaElement|null)=>{
  composerInput.current=input;
  if(!input)return;
  const detach=attachComposerFocus(input);
  return ()=>{detach();composerInput.current=null;};
 },[]);
 const root=useRef<HTMLDivElement>(null),tabsRef=useRef<HTMLDivElement>(null);
 useEntrances(root);useActiveIndicator(tabsRef,tab,'[aria-selected="true"]',true);
 useLayoutEffect(()=>{const node=root.current;if(!node||!node.style.getPropertyValue('--chat-column-width'))return;
  const column=node.querySelector<HTMLElement>('.app-body:not([hidden]) .conversation>.transcript-window, .history-view .conversation>.history-content');
  const parent=column?.parentElement;if(!parent){node.style.removeProperty('--chat-column-width');return;}
  const padding=getComputedStyle(parent),available=parent.clientWidth-parseFloat(padding.paddingLeft)-parseFloat(padding.paddingRight);
  const target=chatWidth==='compact'?Math.min(760,available):available,media=matchMedia('(prefers-reduced-motion: reduce)');
  const settle=()=>{gsap.killTweensOf(node,'--chat-column-width');node.style.removeProperty('--chat-column-width');};
  if(media.matches)settle();else gsap.to(node,{'--chat-column-width':target+'px',duration:.2,ease:'power2.out',overwrite:'auto',onComplete:settle});
  const changed=()=>{if(media.matches)settle();};media.addEventListener('change',changed);
  return()=>{media.removeEventListener('change',changed);gsap.killTweensOf(node,'--chat-column-width');};
 },[chatWidth]);
 const connectionError=useRef('');
 const [workspaceNotice,setWorkspaceNotice]=useState('');
 const sendFlight=useRef<{id:string;controller:AbortController;reconciled:boolean}|undefined>(undefined);
 const sendError=useRef<{id:string;message:string}|undefined>(undefined);
 const draftRef=useRef(draft),pendingRef=useRef(pending),sending=useRef(false),denied=useRef(!!authError),content=useRef<HTMLDivElement>(null),drawer=useRef<HTMLDialogElement>(null),backdropPressed=useRef(false),transcript=useRef<HTMLElement>(null),following=useRef(true);
 draftRef.current=draft;pendingRef.current=pending;
 const dictationDrafts=useMemo<DraftStore>(()=>{const owner=scope.current,id=selected;return {get:(session)=>session===id?(scope.current===owner?draftRef.current:load(owner+'.draft')):undefined,set:(session,text)=>{if(session!==id||scope.current!==owner||selectedRef.current!==id)return;save(owner+'.draft',text);draftRef.current=text;setDraft(text);}};},[selected,w?.host_id]);
 const scopedKeys=['draft','pending','pending-prompt','pending-mode','pending-fresh','pending-images','pending-target','mode','fresh'];
 const storageKey=(key:string)=>scopedKeys.includes(key)?(scope.current?scope.current+'.'+key:'unassigned-'+key):key;
 const store=(key:string,value:string)=>{save(storageKey(key),value);};
 function cancelSessionSwitch(){
  if(sessionSwitch.current)cancelAnimationFrame(sessionSwitch.current.frame);
  sessionSwitch.current=undefined;
  setOpeningSession(undefined);
 }
 function choose(next:Workspace,id:string,preserveHistory=false){
  const target=next.sessions.find(s=>s.id===id);
  if(!target||sending.current)return false;

  const owner=`host.${next.host_id}.project.${encodeURIComponent(target.project?.root??next.project)}.session.${id}`;
  // Read the saved input before changing route ownership. A bad saved receipt
  // must leave the previous conversation intact and available on cancellation.
  const retained=pendingCommands(localStorage,owner,id)[0];
  const draft=load(owner+'.draft'),mode=load(owner+'.mode'),fresh=load(owner+'.fresh');
  save(`host.${next.host_id}.selected`,id);
  if(!preserveHistory){
   original.select(undefined);
   const url=new URL(location.href);
   if(url.searchParams.get('session')!==id)url.searchParams.delete('reply');
   url.searchParams.set('session',id);
   history.replaceState(null,'',url.pathname+url.search);
  }
  cancelSessionSwitch();
  selectionEpoch.current++;
  scope.current=owner;
  selectedRef.current=id;setSelected(id);setProjectContext(target.project?.id??'');
  images.restore(owner,id);setPreview(undefined);
  setDraft(draft);draftRef.current=draft;
  pendingRef.current=retained?.id||'';setPending(pendingRef.current);
  selectDecision(retained?.target??undefined);submissionSelection.current=retained?{id:retained.id,selection:retained.target??undefined}:undefined;
  if(target.contract){setMode('session_v1');setFresh(false);}
  else{
   setMode(mode==='ordinary_read_only_v1'||mode==='ordinary_reviewed_v1'||mode==='developer'||mode==='team'||mode==='reviewed_edit'?mode:'read_only');
   setFresh(fresh==='true');
  }
  following.current=true;
  return true;
 }
 function selectLiveSession(id:string){
  const target=w?.sessions.find(s=>s.id===id);
  setSettingsOpen(false);setNav(false);
  if(!w||sending.current||sessionSwitch.current?.id===id)return;
  if(!target){
   if(openingSession?.id===id)setOpeningSession({...openingSession,error:'This conversation is no longer available.'});
   return;
  }
  cancelSessionSwitch();
  const epoch=++selectionEpoch.current;
  if(selectedRef.current===id&&!original.selection)return;

  const opening={id,name:target.title};
  function open(next:Workspace|undefined){
   if(selectionEpoch.current!==epoch||sending.current){cancelSessionSwitch();return;}
   try{
    if(!next||!choose(next,id))throw Error('This conversation is no longer available.');
   }catch(e){
    sessionSwitch.current=undefined;
    setOpeningSession({...opening,error:e instanceof Error?e.message:String(e)});
   }
  }

  const rowBudget=24,characterBudget=16_384;
  let rows=0,characters=0;
  for(const receipt of w.receipts){
   if(receipt.session!==id||receipt.phase==='queued'||receipt.recalled_ms!==undefined)continue;
   rows++;
   characters+=receipt.prompt.length+receipt.text.length;
   if(rows>=rowBudget||characters>=characterBudget)break;
  }
  if(rows<rowBudget&&characters<characterBudget){open(w);return;}

  // Let the browser paint the requested route's loader before opening it.
  setOpeningSession(opening);
  const pending={id,frame:requestAnimationFrame(()=>{
   pending.frame=requestAnimationFrame(()=>{
    if(sessionSwitch.current===pending)open(latestWorkspace.current);
   });
  })};
  sessionSwitch.current=pending;
 }
 useLayoutEffect(()=>{const node=transcript.current;if(!node)return;const media=matchMedia('(prefers-reduced-motion: reduce)');
  const settle=()=>{gsap.killTweensOf(node);gsap.set(node,{clearProps:'opacity'});};
  if(media.matches)settle();else {if(!node.style.opacity)gsap.set(node,{opacity:.65});gsap.to(node,{opacity:1,duration:.18,ease:'power2.out',overwrite:true,clearProps:'opacity'});}
  const update=()=>{if(media.matches)settle();};media.addEventListener('change',update);return()=>{media.removeEventListener('change',update);gsap.killTweensOf(node);};
 },[selected]);
 function refreshPending(){const p=pendingCommands(localStorage,scope.current,selectedRef.current)[0];if(p&&p.id!==pendingRef.current&&!selectionRef.current){selectDecision(p.target??undefined);submissionSelection.current={id:p.id,selection:p.target??undefined};}pendingRef.current=p?.id||'';setPending(pendingRef.current);}
 function clearPending(p:PendingCommand,owner=scope.current){forgetCommand(localStorage,owner,p);if(scope.current===owner)refreshPending();}
 function acknowledge(p:PendingCommand,accepted:Receipt,owner=scope.current){
  if(!matchesCommand(p,accepted))throw new Error('Recorded command differs from the retained input snapshot. Identity and draft preserved.');
  // Polling may already have settled this submission. Later recall/edit state
  // has a new owner even when its text and attachment IDs are identical.
  if(!pendingCommands(localStorage,owner,p.session).some(saved=>JSON.stringify(saved)===JSON.stringify(p)))return;
  images.consume(owner,p.attachments);
  if(acknowledgedDraft(p,scope.current===owner?draftRef.current:load(owner+'.draft'),load(owner+'.draft'))!==undefined){save(owner+'.draft','');if(scope.current===owner){draftRef.current='';setDraft('');}}
  if(scope.current!==owner){clearPending(p,owner);return;}
  const binding=submissionSelection.current;
  if(binding?.id===p.id&&selectionRef.current===binding.selection)selectDecision(undefined);
  clearPending(p);
 }
 useLayoutEffect(()=>{savePreference('theme',theme);},[theme]);
 useLayoutEffect(()=>{document.documentElement.dataset.font=font;savePreference('font',font);},[font]);
 useEffect(()=>{savePreference('content-mode',contentMode);},[contentMode]);
 useEffect(()=>{savePreference('pane-split',String(split));},[split]);
 useEffect(()=>{if(authError)return;let stopped=false,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
 async function poll(){
 if(stopped||denied.current)return;
 const pollStarted=performance.now();
 let streaming=false;
 const deadline=AbortSignal.timeout(45000);
 const snapshot=new AbortController();
 const signal=AbortSignal.any([controller.signal,deadline,snapshot.signal]);
 const probe=new AbortController();
 const probeSignal=AbortSignal.any([controller.signal,probe.signal]);
 function clearConnectionError(){
  const prior=connectionError.current;
  setError(current=>current===prior?'':current);
  connectionError.current='';
 }
 function disconnected(e:unknown){
  setConnected(false);setWorkspaceNotice('');
  connectionError.current=e instanceof HttpError?e.message:'Connection check failed. Deck is retrying.';
  setError(connectionError.current);
  if(e instanceof HttpError&&e.status===403)denied.current=true;
 }
 async function checkHost(notice:string){
  try{
   const health=await request('GET','/api/health',undefined,AbortSignal.any([probeSignal,AbortSignal.timeout(5000)])) as {api:number};
   if(health?.api!==API)throw Error('Unexpected health response');
   if(!probeSignal.aborted){clearConnectionError();setConnected(true);setWorkspaceNotice(notice);}
  }catch(e){if(!probeSignal.aborted){disconnected(e);snapshot.abort();}}
 }
 // Keep the snapshot request alive while checking the host independently.
 let check:Promise<void>|undefined;
 const slow=setTimeout(()=>{if(!probeSignal.aborted){setWorkspaceNotice('Updating sessions…');check=checkHost('Updating sessions…');}},5000);
 let received=false;
 try{const payload=await request('GET','/api/workspace',undefined,signal);received=true;const next=workspace(payload);if(stopped)return;if(!next.sessions.some(s=>s.id===selectedRef.current))choose(next,next.sessions.find(s=>s.id===load(`host.${next.host_id}.selected`))?.id||next.sessions.find(s=>s.project?.id===next.initial_project)?.id||next.session,true);streaming=next.receipts.some(r=>r.session===selectedRef.current&&active(r));setW(next);setConnected(true);setWorkspaceNotice('');clearConnectionError();for(const p of pendingCommands(localStorage,scope.current,selectedRef.current)){const accepted=next.receipts.find(r=>r.id===p.id&&r.session===selectedRef.current);if(accepted){
   acknowledge(p,accepted);
   observeCommandReceipt(accepted,'workspace');
   const flight=sendFlight.current;
   if(flight?.id===p.id){flight.reconciled=true;flight.controller.abort();}
   const failed=sendError.current;
   if(failed?.id===p.id){setError(current=>current===failed.message?'':current);sendError.current=undefined;}
  }}
  for(const r of next.receipts){if(r.first_output_ms!==null)observeCommandReceipt(r,'workspace');}
  refreshPending();reconcileRecovery(next);}catch(e){
  clearTimeout(slow);
  if(stopped)return;
  if(e instanceof HttpError&&e.status===403){disconnected(e);}
  else if(received){
   setWorkspaceNotice('');setConnected(false);connectionError.current=(e as Error).message;setError(connectionError.current);
  }else if(!snapshot.signal.aborted){
   if(check)await check;
   if(!stopped&&!snapshot.signal.aborted)await checkHost(e instanceof HttpError?e.message:'Updating sessions…');
  }
 }finally{clearTimeout(slow);probe.abort();}
 // Keep one request in flight. Count its duration toward the refresh period
 // while the visible session is streaming, leaving idle/background polling alone.
 const delay=streaming&&!document.hidden?Math.max(100,300-(performance.now()-pollStarted)):500;
 if(!stopped&&!denied.current)timer=setTimeout(poll,delay);}
 void poll();return()=>{stopped=true;clearTimeout(timer);controller.abort();};},[retry]);
 const followTranscript=useCallback(()=>{
  const view=transcript.current;
  if(following.current&&view?.getClientRects().length)restoreTranscriptPosition(view,view.scrollHeight);
 },[]);
 useLayoutEffect(followTranscript,[followTranscript,selected,w,tab,contentMode,settingsOpen,historyReady]);
 useLayoutEffect(()=>{
 const dock=composerDock.current,column=composerWrap.current,pane=dock?.parentElement,viewport=transcript.current;
 if(!dock||!column||!pane||!viewport)return;
 const measure=()=>{
  const height=dock.getBoundingClientRect().height,width=column.getBoundingClientRect().width;
  if(!height||!width)return;
  const heightValue=`${height}px`,widthValue=`${width}px`;
  if(pane.style.getPropertyValue('--composer-column-width')!==widthValue)pane.style.setProperty('--composer-column-width',widthValue);
  if(pane.style.getPropertyValue('--composer-height')===heightValue)return;
  pane.style.setProperty('--composer-height',heightValue);
  if(following.current)restoreTranscriptPosition(viewport,viewport.scrollHeight);
 };
 measure();
 const observer=new ResizeObserver(measure);
 observer.observe(dock);observer.observe(column);
 return()=>observer.disconnect();
 },[selected,tab,contentMode,settingsOpen]);


 const [narrow,setNarrow]=useState(()=>matchMedia('(max-width:1000px)').matches);
 const sidebarDocked=sidebarPinned&&!narrow;
 useSidebarPanel(drawer,sidebarDocked,nav&&!sidebarDocked);
 useEffect(()=>{if(sidebarDocked)setNav(false);},[sidebarDocked]);
 function toggleSidebarPin(){
  const pinned=!sidebarPinned;
  savePreference('sidebar-pinned',String(pinned));
  setSidebarPinned(pinned);
  setNav(false);
 }


 useEffect(()=>{const mq=matchMedia('(max-width:1000px)'),update=()=>setNarrow(mq.matches);mq.addEventListener('change',update);return()=>mq.removeEventListener('change',update);},[]);
 const receipts=w?.receipts.filter(r=>r.session===selected)||[];
 const memberDecisions=useMemo(()=>w?.receipts.filter(r=>r.session===selected).flatMap(r=>r.decisions)??[],[w,selected]);
 const notificationSession=original.selection?.session||selected;
 const notificationVisible=connected&&!openingSession&&!settingsOpen&&!nav&&!sessionDialog&&(!!original.selection||true);
 const liveChatVisible=notificationVisible&&!original.selection;
 const transcriptSnapshot=useRef<{session:string;workspace:Workspace|undefined}|undefined>(undefined);
 const priorTranscript=transcriptSnapshot.current;
 const newLiveSnapshot=liveChatVisible&&priorTranscript?.session===selected&&priorTranscript.workspace!==w;
 useLayoutEffect(()=>{
  transcriptSnapshot.current=liveChatVisible?{session:selected,workspace:w}:undefined;
 },[liveChatVisible,selected,w]);
 const captureSendMotion=useSentMessageMotion(w?.receipts,selected,liveChatVisible,transcript,following);
 usePushPresence(quotaApi,connected,notificationSession,notificationVisible,!original.selection&&notificationSession===selected?Math.max(0,...receipts.flatMap(r=>r.decisions.filter(d=>d.state==='pending').map(d=>d.notificationSeq??0))):0);
 const displayReplies=useDisplayedReplies(quotaApi,notificationVisible&&!original.selection,selected,receipts.filter(r=>r.phase==='completed').map(r=>r.id),receipts.reduce((a,r)=>a+r.revision,0));
 const visibleReplyTarget=new URL(location.href).searchParams.get('reply')||'';
 const replyCommand=displayReplies.visibleReplies.find(r=>r.replyId===visibleReplyTarget)?.commandId;
 useEffect(()=>{if(notificationVisible&&!original.selection&&displayReplies.visibleReplies.some(r=>r.replyId===visibleReplyTarget))transcript.current?.querySelector<HTMLElement>(`[data-reply-id="${visibleReplyTarget}"]`)?.scrollIntoView({block:'center'});},[notificationVisible,selected,displayReplies.visibleReplies,visibleReplyTarget]);
 const contextReceipt=leadContextReceipt(w?.sessions.find(s=>s.id===selected),receipts);
 const subagentErrors=w?subagentErrorCount(w,selected):0;
 const activeSubagents=w?workerCounts(w,selected).active:0;


 const [inspectorOpen,setInspectorOpen]=useState(false);
 const activityVisible=inspectorOpen&&tab==='activity';
 const memberRunning=w?.tasks.some(t=>t.session===selected&&t.attempts.at(-1)?.phase==='running');
 const activity=useActivity(selected,connected&&(activityVisible||receipts.some(active)||!!memberRunning));
 const memberSteps=activity.page?.members;
 const memberActivity=useMemo(()=>new Map(memberSteps?.map(step=>[step.task,step])),[memberSteps]);
 const inspectorTrigger=useRef<HTMLElement|null>(null);
 const pendingApprovals=memberDecisions.filter(d=>d.state==='pending'&&!d.questions.length);
 const seenApprovals=useRef(new Set<string>());
 useEffect(()=>{
  const next=new Set(pendingApprovals.map(d=>selected+':'+d.id));
  if([...next].some(id=>!seenApprovals.current.has(id))){
   if(!inspectorOpen)inspectorTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
   setTab('activity');setInspectorOpen(true);
  }
  seenApprovals.current=next;
 },[selected,memberDecisions]);
 const gitCatalog=useGitCatalog(selected,connected);
 const changedFiles=gitCatalog.files?new Set(gitCatalog.files.files.map(file=>file.path)).size:undefined;
 usePanelMotion(content,tab);
 const conversation=w?.sessions.find(s=>s.id===selected);
 const selectedProject=conversation?.project;
 const currentFolder=w?.projects?.find(p=>p.id===selectedProject?.id);
 const previousFolder=!!currentFolder&&!!selectedProject&&currentFolder.identity!==selectedProject.identity;
 const selectedAvailability=previousFolder?'This conversation is saved with the previous copy of this folder.':conversation?.contract&&w?.session_availability&&Object.hasOwn(w.session_availability,conversation.id)
  ?w.session_availability[conversation.id]
  :selectedProject&&w?.project_availability
  ?(Object.hasOwn(w.project_availability,selectedProject.id)?w.project_availability[selectedProject.id]:'Project availability is unavailable.')
  :w?.availability;
 const selectedTeamAvailability=selectedProject&&w?.project_team_availability
  ?(Object.hasOwn(w.project_team_availability,selectedProject.id)?w.project_team_availability[selectedProject.id]:'Investigator is not prepared for this project.')
  :w?.team_availability;
 const projectTrusted=selectedProject?w?.project_trust?.[selectedProject.id]??false:w?.trusted??false;
 const working=!!w&&(w.process_active||w.receipts.some(active)||w.tasks.some(t=>t.attempts.some(a=>active(a as unknown as Receipt)||a.phase==='uncertain')));
 const selectedWorking=receipts.some(active);
 const liveTarget=mode==='session_v1'?receipts.find(r=>r.can_steer&&r.phase==='running'&&!r.cancel_requested&&r.thread&&r.turn):undefined;
 const live=useLiveSteering(scope.current,receipts,(owner,text)=>{
  if(load(owner+'.draft')!==text||(owner===scope.current&&draftRef.current!==text))return;
  save(owner+'.draft','');
  if(owner===scope.current){draftRef.current='';setDraft('');}
 });
 const showSteeringNotice=!!(connected&&selectedWorking&&!liveTarget&&w?.steering_unavailable);
 const steeringNotice=useRef<HTMLParagraphElement>(null);
 useDisclosureMotion(steeringNotice,showSteeringNotice);
 const stopTarget=receipts.find(active);
 const [stopRequest,setStopRequest]=useState<{id:string;session:string;pending:boolean}>();
 const recalling=useRef<{session:string;restore:boolean}|undefined>(undefined),recalled=useRef(new Set<string>()),selectionEpoch=useRef(0);
 const [recoveringDraft,setRecoveringDraft]=useState<string>();
 const stoppingHere=stopRequest?.session===selected&&(!stopTarget||stopTarget.id===stopRequest.id);
 const stopping=stoppingHere||stopTarget?.phase==='cancelling';
 useEffect(()=>{
  if(stopRequest&&!stopRequest.pending&&!w?.receipts.some(r=>r.id===stopRequest.id&&active(r)))setStopRequest(undefined);
 },[stopRequest,w?.receipts]);
 const headerReceipt=receipts.filter(r=>r.model&&r.recalled_ms===undefined).at(-1);
 const headerModel=headerReceipt?.model||conversation?.contract?.members.lead?.modelId||'Model pending';
 const headerEffort=headerReceipt?headerReceipt.presentation?.reasoning?.effort:conversation?.contract?.members.lead?.thinking;
 const blocked=!!original.selection||trustBusy||!connected||!w||!selected||!!selectedAvailability||(mode==='team'&&!!selectedTeamAvailability);
 const imageDrafts=images.drafts[scope.current]||[];
 const attachmentIds=imageDrafts.flatMap(v=>v.attachment?[v.attachment.id]:[]);
 const incompleteImages=imageDrafts.some(v=>v.status!=='ready');
 const stopMode=(!!stopTarget||stoppingHere)&&!pending&&!draft.trim()&&!imageDrafts.length;
 const queuedSend=working||stoppingHere||receipts.some(r=>r.phase==='queued')||(mode!=='session_v1'&&!!w?.queue_paused);
 const sendBlocked=blocked||busy||live.pending||recoveringDraft===selected||((mode==='reviewed_edit'||mode==='developer'||mode==='ordinary_reviewed_v1')&&!projectTrusted);
 const showLiveActions=!!liveTarget&&!stopMode&&!pending;
 const liveTargetBusy=liveTarget?.steering?.some(s=>s.state==='pending'||s.state==='dispatching');
 const canSendNow=showLiveActions&&!sendBlocked&&!stopping&&!liveTargetBusy&&!selectionRef.current&&!imageDrafts.length&&!!draft.trim();
 const composerLabel=stopMode?(stopping?'Stopping Lead':'Stop Lead'):pending?'Retry retained message':queuedSend?(showLiveActions?'Queue for next turn':'Queue message'):'Send question';
 const composerTitle=!connected?'Disconnected. Reconnect to '+(stopMode?'stop the Lead':'send')+'. Your draft is kept.'
  :stopMode?(stopping?'Waiting for the Lead turn to stop.':'Stop the current Lead turn. Your draft and queued messages are kept.')
  :blocked?'Lead is unavailable. Your draft is kept.'
  :pending?'Retry the exact retained message. Newer draft edits are kept.'
  :queuedSend?'Queue message after current work':'Send message';
 const composerDisabled=stopMode?(!connected||stopping||!stopTarget||!!stopRequest?.pending)
  :sendBlocked||(!pending&&((!draft.trim()&&!imageDrafts.length)||incompleteImages));
 const [composerNotice,setComposerNotice]=useState<{session:string;text:string}>();
 const action=escapeInput(receipts.filter(r=>!recalled.current.has(r.id)));
 const escapeTarget=!blocked&&!busy&&!pending&&!settingsOpen&&!sessionDialog&&!preview&&!nav&&!inspectorOpen&&action&&!recalling.current
  ?JSON.stringify([selected,action.kind,action.input.id,action.input.attempt]):undefined;
 const {touchEnter,actionHint}=useComposerKeyboard(escapeTarget,()=>{if(action)void recallOrInterrupt(action);});
 const composerHelp=!connected?(stopMode?'Reconnect to stop the Lead · Your draft is kept':'Connect to send · Your draft is kept')
  :stopMode?(stopping?'Stopping the Lead · Your draft is kept':'Use Stop to interrupt the Lead · Your draft is kept')
  :busy?'Waiting for Deck to confirm receipt'
  :recoveringDraft===selected?'Recovering unread input · Your draft is kept'
  :pending?'Retry retained input · New draft edits are kept'
  :live.pending?'Checking live delivery · Your draft is kept'
  :showLiveActions?'Enter queues for the next turn'
  :queuedSend?'Input will queue · Browser closure keeps native work running'
  :touchEnter?'Use Send to submit':'Enter to send · Shift + Enter for a new line';
 const keyboardStatus=actionHint?(action?.kind==='recall'?'Press Esc again to recall your unread message':'Press Esc again to interrupt'):composerNotice?.session===selected?composerNotice.text:'';
 const statusRef=useRef<HTMLDivElement>(null),lastStatus=useRef('');if(keyboardStatus)lastStatus.current=keyboardStatus;
 useDisclosureMotion(statusRef,!!keyboardStatus);
 useEffect(()=>{if(!composerNotice)return;const timer=setTimeout(()=>setComposerNotice(undefined),3500);return()=>clearTimeout(timer);},[composerNotice]);

 function publishRecovery(owner:string,text:string){if(scope.current===owner){draftRef.current=text;setDraft(text);}}
 function reconcileRecovery(next:Workspace){
  const owner=scope.current,session=selectedRef.current;
  reconcileRecalls(localStorage,owner,session,next.receipts,text=>publishRecovery(owner,text),input=>images.recall(owner,input.attachments));
 }
 async function recallOrInterrupt(target:NonNullable<ReturnType<typeof escapeInput>>,explicitStop=false){
  if(recalling.current||sending.current&&!explicitStop)return;
  const input=target.input,owner=scope.current,epoch=selectionEpoch.current;
  const restore=target.kind==='recall';
  recalling.current={session:input.session,restore};
  if(restore)setRecoveringDraft(input.session);
  let interrupted=false;
  try{
   if(explicitStop||target.kind==='interrupt'){
    const stopped=await cancel(input.id);if(!stopped)return false;interrupted=true;
    setComposerNotice({session:input.session,text:'Lead turn interrupted.'});
    if(target.kind==='interrupt'||recalled.current.has(input.id))return true;
   }
   const restored=await restoreInput(localStorage,owner,input,()=>request('POST',`/api/commands/${encodeURIComponent(input.id)}/recall`,{api:API,session:input.session,attempt:input.attempt}),text=>publishRecovery(owner,text),input=>images.recall(owner,input.attachments));
   if(restored){recalled.current.add(input.id);if(scope.current===owner&&selectionEpoch.current===epoch)requestAnimationFrame(()=>{if(scope.current!==owner||selectionEpoch.current!==epoch)return;const node=document.getElementById('prompt') as HTMLTextAreaElement|null;if(node&&!node.disabled&&!node.closest('[hidden],[inert]')){node.focus({preventScroll:true});node.setSelectionRange(node.value.length,node.value.length);}});}
   setComposerNotice({session:input.session,text:restored?'Unread message recalled. Your draft is kept.':'Recall could not be confirmed. Your draft is unchanged. Inspect the input receipt before retrying.'});
  }catch(e){setComposerNotice({session:input.session,text:(explicitStop?'Interruption requested. Input was not confirmed unread; your draft is kept. ':'Recall could not be confirmed. Your draft is kept. Inspect the input receipt before retrying. ')+String(e)});}
  finally{recalling.current=undefined;if(restore)setRecoveringDraft(undefined);}
  return interrupted;
 }

 async function stopLead(){
  if(!connected||!stopTarget||stopping||recalling.current)return;
  const request={id:stopTarget.id,session:stopTarget.session,pending:true};
  setStopRequest(request);
  const stopped=await recallOrInterrupt({kind:(stopTarget.phase==='accepted'||stopTarget.phase==='preparing')&&stopTarget.dispatch_ms===null?'recall':'interrupt',input:stopTarget},true);
  setStopRequest(stopped?{...request,pending:false}:undefined);
 }
 async function send(eventTime:number){if(sending.current||sendBlocked||(recalling.current?.restore&&recalling.current.session===selectedRef.current))return;
 const now=performance.now(),submittedAt=eventTime>0&&eventTime<=now?eventTime:now,owner=scope.current;
 let deadline:ReturnType<typeof setTimeout>|undefined;
 let submission:PendingCommand|undefined;
 try{
 const retained=pendingCommands(localStorage,scope.current,selectedRef.current)[0];
 if(retained){
  if(retained.target===undefined)throw Error('This older pending input has no attributable reply target. Its identity and draft are preserved; reconnect to reconcile its receipt before sending again.');
  submission=retained;
 }else{
  if(!draftRef.current.trim()&&!imageDrafts.length)return;
  if(incompleteImages)throw Error('Finish or remove incomplete image uploads before sending. Your text is retained.');
  if(imageDrafts.length&&(mode!=='session_v1'&&mode!=='read_only'&&!mode.startsWith('ordinary_')))throw Error('Images are available in Codex read-only and configured developer sessions. Choose a supported mode or remove images.');
  const target=selectionRef.current?.sessionId===selectedRef.current?selectionRef.current:null;
  submission={id:crypto.randomUUID(),session:selectedRef.current,prompt:draftRef.current,mode,fresh,attachments:attachmentIds,target,queue:true};
  captureSendMotion(submission.id,submission.session,composerInput.current?.form?.querySelector<HTMLElement>('button[type=submit]'));
  submissionSelection.current={id:submission.id,selection:selectionRef.current};
 }
 const p=submission,{id}=p;
 beginCommandTiming(id,submittedAt);
 sending.current=true;setBusy(true);setError('');following.current=true;
 const controller=new AbortController();
 const flight={id,controller,reconciled:false};
 sendFlight.current=flight;
 deadline=setTimeout(()=>controller.abort(),10000);
 const admission=admitCommand(localStorage,owner,p,(method,path,body)=>{
  pendingRef.current=id;setPending(id);
  markCommandRequest(id);
  return request(method,path,body,controller.signal,'project',response=>markCommandHeaders(id,response));
 });
 const accepted=await admission;
 if(!flight.reconciled){
  observeCommandReceipt(accepted,'http');
  setW(current=>current?{...current,receipts:current.receipts.some(r=>r.id===id)
   ?current.receipts.map(r=>r.id===id&&r.revision<accepted.revision?accepted:r)
   :[...current.receipts,accepted]}:current);
  acknowledge(p,accepted,owner);
 }
 }catch(e){
  if(sendFlight.current?.reconciled)return;
  if(e instanceof HttpError){if(submission&&([400,413,422].includes(e.status)||commandNotAccepted(e,submission.id,submission.session)))clearPending(submission,owner);if(e.status===403){denied.current=true;setConnected(false);}}
  if(submission)refreshPending();
  const message=sendFlight.current?.controller.signal.aborted?'Delivery is unconfirmed. Deck will check for the receipt.':(e as Error).message;
  if(submission&&pendingRef.current===submission.id)sendError.current={id:submission.id,message};
  setError(message);
 }finally{clearTimeout(deadline);sendFlight.current=undefined;sending.current=false;setBusy(false);}}
 async function cancelWaiting(input:Receipt){if(!connected)return;try{await cancelQueuedInput(input);setRetry(v=>v+1);}catch(e){setError(String(e));setRetry(v=>v+1);}}
 async function cancel(id:string){try{await request('POST',`/api/commands/${encodeURIComponent(id)}/cancel`,{});return true;}catch(e){setError((e as Error).message);return false;}}
 async function trust(trusted:boolean){if(!w||trustBusy)return;const previous=projectTrusted;setTrustBusy(true);setW(v=>v?{...v,trusted,project_trust:{...v.project_trust,[selectedProject?.id??'']:trusted}}:v);try{await request('POST','/api/project/trust',{api:API,project:selectedProject?.root??w.project,trusted});}catch(e){setW(v=>v?{...v,trusted:previous,project_trust:{...v.project_trust,[selectedProject?.id??'']:previous}}:v);setError((e as Error).message);}finally{setTrustBusy(false);}}
 function openSessionDialog(value:'new'|'assignments'|'transition'){selectionEpoch.current++;workerNavigation.current=undefined;setSessionDialog(value);}
 async function sidebarChanged(){const next=workspace(await request('GET','/api/workspace'));setW(next);if(!next.sessions.some(s=>s.id===selectedRef.current))choose(next,next.session);}
 async function createConversation(projectId=selectedProject?.id){if(w&&!busy){setCreationProject(projectId??w.projects?.[0]?.id??'');openSessionDialog('new');}}
 async function sessionSaved(id:string){try{const next=workspace(await request('GET','/api/workspace'));setW(next);if(selectedRef.current!==id)choose(next,id);setNav(false);}catch(e){setError(String(e));}}
 async function sessionAction(action:'release'|'remove'){if(!w||!selected)return;if(action==='remove'&&!confirm('Remove this settled conversation from local Deck history? Project files and native history are kept.'))return;try{await request('POST',`/api/sessions/${encodeURIComponent(selected)}/${action}`,{api:API});const next=workspace(await request('GET','/api/workspace'));setW(next);if(action==='remove')choose(next,next.session);}catch(e){setError(String(e));}}
 async function queueControl(paused:boolean){try{await request('POST','/api/queue',{api:API,paused});}catch(e){setError(String(e));}}
 function changeLayout(value:ContentMode){setContentMode(value);}
 function changeTab(value:string){setTab(value);try{store('panel',value);}catch(e){setError(String(e));}}
 const tabs=<div ref={tabsRef} className="workspace-tabs" role="tablist" aria-label="Workspace views" onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const buttons=Array.from(e.currentTarget.querySelectorAll('button')).filter(button=>button.getClientRects().length>0);const at=buttons.indexOf(e.target as HTMLButtonElement);const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(at+(e.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;buttons[next]?.click();buttons[next]?.focus();}}}>{['activity','subagents','review'].map(t=><button key={t} className={t==='conversation'?'chat-tab':undefined} role="tab" id={'tab-'+t} aria-selected={tab===t} aria-label={t==='subagents'?'Subagents':undefined} aria-describedby={t==='subagents'?'subagents-status':undefined} aria-controls={'panel-'+t} tabIndex={tab===t?0:-1} onClick={()=>changeTab(t)}>{t==='conversation'?'Conversation':t==='review'?'Git':t==='subagents'?<><span className="subagents-tab-title">Subagents<span className="tab-working" aria-hidden="true">{activeSubagents>0&&<>{connected&&<StatusIndicator state="running"/>}<span className="tab-worker-count">{activeSubagents}</span></>}{subagentErrors>0&&<StatusIndicator state="failed"/>}{!connected&&<span className="tab-stale">stale</span>}</span></span><span id="subagents-status" className="sr-only" role="status">{connected?`${activeSubagents} active subagents`:`Stale: ${activeSubagents} last known active subagents`}{subagentErrors>0?`; ${subagentErrors} unresolved errors`:''}</span></>:'Activity'}</button>)}</div>;
 const settingsButton=<div className="deck-menu"><button type="button" className="quiet deck-menu-toggle" aria-label="Settings" aria-pressed={settingsOpen} onClick={()=>{setNav(false);setSettingsOpen(true);}}><NavigationIcon kind="settings"/><span>Settings</span></button></div>;
 async function selectHistory(value:{project:string;session:string},leadRunner?:string){cancelSessionSwitch();const epoch=++selectionEpoch.current;original.select(value);const url=new URL(location.href);if(url.searchParams.get('session')!==value.session)url.searchParams.delete('reply');url.searchParams.set('session',value.session);history.replaceState(null,'',url.pathname+url.search);setContinuationIssue('');setSettingsOpen(false);setNav(false);
  const summary=original.pages[value.project]?.sessions.find(s=>s.sessionId===value.session);
  if(original.adopted&&w&&original.projects.some(p=>p.projectId===value.project)&&(leadRunner??summary?.members.lead?.runnerId)==='codex'){
   try{await request('POST',`/api/history/sessions/${encodeURIComponent(value.session)}/activate`,{});const next=workspace(await request('GET','/api/workspace'));if(selectionEpoch.current!==epoch)return;setW(next);choose(next,value.session);}catch(e){if(selectionEpoch.current===epoch)setContinuationIssue(String(e));}
  }
 }
 const deepLinkHandled=useRef(false);
 useEffect(()=>{
  if(!connected||!w||deepLinkHandled.current)return;
  const id=new URL(location.href).searchParams.get('session');
  if(!id||!safeSession(id))return;
  let cancelled=false;const epoch=selectionEpoch.current;
  if(w.sessions.some(s=>s.id===id)){deepLinkHandled.current=choose(w,id);return;}
  if(!original.projects.length)return;
  deepLinkHandled.current=true;
  void request('GET',`/api/history/sessions/${encodeURIComponent(id)}?limit=1`).then(v=>{
   const summary=(v as {summary:{projectId:string;members?:{lead?:{runnerId?:string}}}}).summary;
   if(!cancelled&&selectionEpoch.current===epoch&&original.projects.some(p=>p.projectId===summary.projectId))void selectHistory({project:summary.projectId,session:id},summary.members?.lead?.runnerId);
  }).catch(e=>{if(!cancelled&&selectionEpoch.current===epoch)setError(String(e));});
  return()=>{cancelled=true;};
 },[connected,w?.host_id,original.projects]);
 // Acknowledge only after React has committed a visible conversation. The epoch
 // also covers repeated requests for the currently selected session.
 const workerNavigation=useRef<{epoch:number;session:string;reply?:string;port?:MessagePort}|undefined>(undefined);
 const [,renderNavigation]=useState(0);
 useLayoutEffect(()=>{
  const pending=workerNavigation.current;if(!pending)return;
  workerNavigation.current=undefined;
  const visible=original.selection?.session||selected;
  if(pending.epoch===selectionEpoch.current&&visible===pending.session&&!settingsOpen&&!nav&&!sessionDialog&&true){if(pending.reply){const url=new URL(location.href);url.searchParams.set('reply',pending.reply);history.replaceState(null,'',url.pathname+url.search);}pending.port?.postMessage({opened:true});}
 });
 useEffect(()=>{
  if(!('serviceWorker' in navigator))return;
  const listener=(event:MessageEvent)=>{
   const id=event.data?.sessionId;
   if(event.data?.type!=='deck.open-session'||!safeSession(id)||!w||!connected)return;
   const epoch=++selectionEpoch.current;
   if(sending.current||sessionDialog)return;
   const reveal=()=>{setSettingsOpen(false);setNav(false);if(narrow)setTab('conversation');else if(contentMode==='workspace')setContentMode('both');workerNavigation.current={epoch:selectionEpoch.current,session:id,reply:typeof event.data.replyId==='string'&&/^reply-[1-9][0-9]*-[1-9][0-9]*$/.test(event.data.replyId)&&event.data.replyId.length<=48?event.data.replyId:undefined,port:event.ports[0]};renderNavigation(v=>v+1);};
   if(w.sessions.some(s=>s.id===id)){if(choose(w,id))reveal();return;}
   void request('GET',`/api/history/sessions/${encodeURIComponent(id)}?limit=1`).then(v=>{
    const summary=(v as {summary:{projectId:string;members?:{lead?:{runnerId?:string}}}}).summary;
    if(selectionEpoch.current!==epoch||sending.current||!original.projects.some(p=>p.projectId===summary.projectId))return;
    void selectHistory({project:summary.projectId,session:id},summary.members?.lead?.runnerId);reveal();
   }).catch(()=>{});
  };
  navigator.serviceWorker.addEventListener('message',listener);
  return()=>navigator.serviceWorker.removeEventListener('message',listener);
 },[connected,w,original.projects,sessionDialog,narrow,contentMode]);
 useEffect(()=>{
  const id=original.selection?.session||selected;
  const viewed=()=>{if(id&&safeSession(id)&&document.visibilityState==='visible'&&document.hasFocus())navigator.serviceWorker?.controller?.postMessage({type:'deck.session-viewed',sessionId:id});};viewed();
  addEventListener('focus',viewed);document.addEventListener('visibilitychange',viewed);
  return()=>{removeEventListener('focus',viewed);document.removeEventListener('visibilitychange',viewed);};
 },[original.selection?.session,selected]);
 const sessionSettings=<>{mode!=='session_v1'&&<SessionConfiguration key={selected} session={selected} connected={connected} blocked={busy||!!pending||working} onSelected={(m,newExecution)=>{if(pendingRef.current||selectedRef.current!==selected)return;setMode(m);store('mode',m);if(newExecution){setFresh(true);store('fresh','true');}}}/>}{mode!=='session_v1'&&<><div className="composer-mode"><label>Mode <select aria-label="Execution mode" value={mode} disabled={busy||!!pending} onChange={e=>{const mode=e.target.value as Mode;setMode(mode);if(mode==='team'||mode==='developer'||mode.startsWith('ordinary_')){setFresh(true);store('fresh','true');}try{store('mode',mode);}catch(err){setError(String(err));}}}><option value="read_only">Read-only</option><option value="reviewed_edit">Reviewed edits</option><option value="team">Team investigation</option><option value="developer">Developer change</option><option value="ordinary_read_only_v1">Developer session · read-only</option><option value="ordinary_reviewed_v1">Developer session · review each edit</option></select></label>{(mode==='reviewed_edit'||mode==='developer'||mode==='ordinary_reviewed_v1')&&<label><input type="checkbox" checked={projectTrusted} disabled={!connected||trustBusy} onChange={e=>void trust(e.target.checked)}/>Trust this project for reviewed editing</label>}{projectTrusted&&<button type="button" className="quiet" disabled={trustBusy} onClick={()=>void trust(false)}>Revoke edit trust</button>}</div>{mode==='team'&&<p className="activity-meta">{selectedTeamAvailability||'Codex Lead · admitted Investigator. Fresh execution required. Reports are evidence, not independent verification.'}</p>}{(mode==='reviewed_edit'||mode==='developer'||mode==='ordinary_reviewed_v1')&&<p className="activity-meta">Trust enables this mode. Every file change still requires Allow once.</p>}<label className="activity-meta"><input type="checkbox" checked={fresh} disabled={busy||!!pending||mode.startsWith('ordinary_')} onChange={e=>{setFresh(e.target.checked);store('fresh',String(e.target.checked));}}/>Start new execution without native context</label>{!fresh&&<p className="activity-meta">{conversation?.native?'Continue the saved native context.':'The first execution starts a new native context. Missing or released context requires an explicit new execution.'}</p>}
 </>}{mode==='session_v1'&&<section aria-label="Session controls"><button type="button" className="quiet" disabled={busy||!!pending} onClick={()=>openSessionDialog('assignments')}>Session assignments</button><button type="button" className="quiet" disabled={!connected} onClick={()=>void request('POST',`/api/sessions/${encodeURIComponent(selected)}/grants/revoke`,{}).catch(e=>setError(String(e)))}>Revoke session grants</button></section>}</>;
 const attention=useSidebarAttention(w,original,sidebarMeta);
 const viewedSession=original.selection?.session??openingSession?.id??selected;
 const opener=!sidebarDocked&&<SidebarOpener count={attention.filter(row=>row.id!==viewedSession).length} open={nav} onOpen={()=>setNav(true)}/>;
 return <SecondaryInfoProvider scopeKey={scope.current} blocked={settingsOpen||nav||!!sessionDialog}><div ref={root} data-chat-width={chatWidth} data-sidebar-docked={sidebarDocked?'true':undefined} className="workbench"><a className="skip" href="#conversation">Skip to conversation</a>
 <dialog ref={drawer} id={sidebarPanelId} className={sidebarDocked?'sidebar':'session-drawer'}
  role={sidebarDocked?'navigation':undefined} aria-label="Projects and sessions" inert={!sidebarDocked&&!nav}
  onCancel={e=>{if(e.target===e.currentTarget){e.preventDefault();setNav(false);}}}
  onPointerDown={e=>{backdropPressed.current=e.target===e.currentTarget&&outsidePanel(e);}}
  onClick={e=>{if(nav&&backdropPressed.current&&e.target===e.currentTarget&&outsidePanel(e))setNav(false);backdropPressed.current=false;}}>
  <div className="sidebar-brand"><DeckBrand/><div className="sidebar-controls">
   {!narrow&&<button type="button" className="quiet sidebar-pin" aria-label={sidebarDocked?'Unpin sidebar':'Pin sidebar'} title={sidebarDocked?'Unpin sidebar':'Pin sidebar'} onClick={toggleSidebarPin}><NavigationIcon kind="pin"/></button>}
   {!sidebarDocked&&<button type="button" className="quiet sidebar-close" aria-label="Close project navigation" title="Close project navigation" onClick={()=>setNav(false)}><NavigationIcon kind="close"/></button>}
  </div></div>
  <Sidebar meta={sidebarMeta} setMeta={setSidebarMeta} w={w} history={original} selected={openingSession?.id??selected} connected={connected} busy={busy} collapsed={!sidebarDocked&&!nav} attention={attention} onSelect={selectLiveSession} onHistory={value=>void selectHistory(value)} onNew={id=>void createConversation(id)} onChanged={sidebarChanged}/>
  {connected&&<QuotaSection api={quotaApi}/>}
  {settingsButton}
 </dialog>
 {original.selection&&<OriginalConversation key={original.selection.session} name={original.pages[original.selection.project]?.sessions.find(s=>s.sessionId===original.selection?.session)?.title} selection={original.selection} continuationIssue={continuationIssue} navigationOpen={nav} navigationOpener={opener}/>}
 <div hidden={!!original.selection&&!openingSession} data-live-session-opening={openingSession?true:undefined} className={'app-body'+(conversation?.original&&!historyReady?' session-opening':'')+' content-both'} style={{'--pane-split':split+'%'} as React.CSSProperties}><header className="app-header">{opener}<div className="session-identity"><img className="agent-avatar" src="/avatars/lead.png" width="32" height="32" alt=""/><div className="session-identity-text"><div className="session-title-line"><h1>{conversation?.title||'Workspace'}</h1><SessionBranch session={selected}/></div><div className="session-subtitle"><span className="session-project" title={selectedProject?.root||w?.project}>{(selectedProject?.root||w?.project||'Project').split('/').filter(Boolean).at(-1)}</span><p className="lead-identity">Lead <strong>{(headerReceipt?headerReceipt.presentation?.recorded_runner:conversation?.contract?.members.lead?.runnerId)||'Runner unavailable'}</strong>{headerModel&&<span title={headerModel}>{headerModel}</span>}{headerEffort&&<small className="lead-reasoning" title="Reasoning effort">{headerEffort}</small>}</p></div></div></div><div className="inspector-actions" role="group" aria-label="Session inspector">{(['activity','subagents','review'] as const).map((item,i)=><button key={item} type="button" className="quiet" aria-label={`Open ${item==='review'?'Git':item==='activity'?'Activity':'Subagents'}`} title={item==='activity'?`${pendingApprovals.length} pending approvals`:item==='subagents'?`${activeSubagents} running subagents`:changedFiles===undefined?'Git count unavailable':`${changedFiles} changed Git files`} aria-expanded={inspectorOpen&&tab===item} aria-controls="session-inspector" onClick={e=>{inspectorTrigger.current=e.currentTarget;setTab(item);setInspectorOpen(!(inspectorOpen&&tab===item));}}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">{i===0?<><circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/></>:i===1?<><circle cx="6" cy="5" r="2.5"/><path d="M1 14c0-5 10-5 10 0M11 3c4 0 4 5 0 5M12 10c2 0 3 2 3 4"/></>:<><circle cx="4" cy="3" r="1.75"/><circle cx="4" cy="13" r="1.75"/><circle cx="12" cy="3" r="1.75"/><path d="M4 4.75v6.5M12 4.75V6a4 4 0 0 1-4 4H4"/></>}</svg><small>{[pendingApprovals.length,activeSubagents,changedFiles??'—'][i]}</small></button>)}</div>{conversation&&!conversation.contract&&<button type="button" className="quiet" disabled={!connected||busy||!!pending} onClick={()=>openSessionDialog('transition')}>Start canonical session</button>}{mode==='session_v1'&&conversation&&<SessionMenu key={selected} session={conversation} connected={connected} blocked={busy||!!pending} working={selectedWorking} onAssignments={()=>openSessionDialog('assignments')} onChanged={async()=>{const next=workspace(await request('GET','/api/workspace'));setW(next);}}/>}{mode==='session_v1'&&<ApprovalChip mode={conversation?.contract?.approvals==='yolo'?'yolo':'relay'}/>}</header>
 {offerRemember&&connected&&<BrowserDeviceOffer/>}
 {workspaceNotice&&<p className="activity-meta" role="status">{workspaceNotice}</p>}
 {error&&<div className="error app-error alert" role="alert">{error}<div><button className="quiet" onClick={()=>{setError('');if(!denied.current){setRetry(v=>v+1);}}}>Dismiss</button><button className="quiet" onClick={()=>{denied.current=false;setRetry(v=>v+1);}}>Reconnect</button></div></div>}
 {conversation&&selectedAvailability&&<div className="error app-error" role="alert">{selectedAvailability}{previousFolder&&currentFolder&&<button type="button" className="quiet" disabled={!connected||busy} onClick={()=>void createConversation(currentFolder.id)}>Start a session in the current folder</button>}</div>}
 
 <div className="session-panes"><div ref={content} inert={!!openingSession} className={'panes slice-panes '+(tab!=='conversation'?'activity-selected':'')}>
 <main className="chat-pane" id="panel-conversation" aria-label="Conversation"><section ref={transcript} id="conversation" className="conversation" tabIndex={0} aria-label="Recorded messages">
 {conversation?.original&&<OriginalMessages key={selected} session={selected} name={conversation.title} onReady={setHistoryReady} viewport={transcript} onHistoryTarget={()=>setPositionedHistoryTarget(selected+':'+visibleReplyTarget)} onBrowse={()=>{following.current=false;}} tasks={w?.tasks.filter(t=>!!t.original)??[]} activity={memberActivity} connected={connected}/>}
 {w&&!conversation&&<div className="empty"><DeckBrand large/><h2>{w.projects?.length?'Create a conversation':'Add your first project'}</h2><p>{w.projects?.length?'Choose a project in the sidebar to start a conversation.':'Choose Add project in the sidebar and enter its directory.'}</p></div>}
 {conversation&&!receipts.length&&!conversation.original&&<div className="empty"><DeckBrand large/><h2>What are we working on?</h2><p>{mode==='session_v1'?'Send a message to start working with your team.':'Ask Codex to explain a file or trace how something works. Review proposed changes before allowing an edit, or ask a read-only question.'}</p></div>}
 <LiveTranscriptWindow preferStart={!!conversation?.original&&!!visibleReplyTarget&&positionedHistoryTarget===selected+':'+visibleReplyTarget} limit={conversation?.original?60:120} rowCost={timelineRowCost} focusKey={replyCommand?'receipt:'+replyCommand:undefined} key={selected} rows={conversationTimeline(receipts,w?.tasks.filter(t=>!conversation?.original||!t.original)??[],selected)} viewport={transcript} following={following}>{row=>{if(row.task)return <InlineSubagents tasks={[row.task]} session={selected} activity={memberActivity} connected={connected}/>;const r=row.receipt;return <div className="exchange" id={"exchange-"+r.id} key={r.id}>{!r.continuation&&<article className="message user user-message"><div className="message-meta"><strong>You</strong><MessageTime timestamp={r.accepted_ms}/><MessageCopy text={r.prompt}/></div><div className="slice-prompt"><Markdown text={r.prompt}/></div><div className="image-references">{r.attachments.map((a,i)=><button key={a.id} type="button" className="quiet image-reference" aria-label={`View image ${i+1}`} onClick={()=>setPreview({src:imageURL(r.session,a.id),name:`Image ${i+1} · ${a.width} × ${a.height}`})}><img src={imageURL(r.session,a.id)} alt="" width="56" height="56" loading="lazy"/>Image {i+1}</button>)}</div></article>}{r.steering?.filter(s=>s.state==='accepted').map(s=><article className="message user user-message" key={s.id}><div className="message-meta"><strong>You</strong><span>Sent live</span><MessageTime timestamp={s.admittedMs}/><MessageCopy text={s.text}/></div><div className="slice-prompt"><Markdown text={s.text}/></div></article>)}<article className="message lead assistant-message"><div className="message-meta"><strong>Lead</strong><span>{r.presentation?.recorded_runner||'Runner unavailable'}{r.model?' · '+r.model:''}</span>{r.phase!=='completed'&&<span className="phase">{phase(r)}</span>}<MessageTime timestamp={r.message_times?.[0]?.at_ms??r.first_output_ms} label="Response started"/><MessageCopy text={leadMessageText(r.text,0,r.message_times?.[1]?.start)}/></div><div className="answer"><LeadReplyText times={r.message_times} text={r.text} live={liveChatVisible&&active(r)} attempt={r.attempt} revealOnMount={newLiveSnapshot&&active(r)} onGrowth={followTranscript} fallback={r.phase==='queued'?'Waiting in the queue; definitely undispatched.':active(r)?'Awaiting native output…':'No native answer was recorded.'} reply={displayReplies.visibleReplies.find(p=>p.commandId===r.id)} visible={notificationVisible&&!original.selection} root={transcript} onDisplayed={displayReplies.displayed}/></div>{r.decisions.map(d=><Review conversation onResize={()=>{followTranscript();}} storageScope={scope.current} key={d.id} d={d} onError={setError} connected={connected}/>)}{['failed','uncertain','cancelled','dispatching'].includes(r.phase)&&r.detail&&<p role="status" className="activity-meta">{r.detail}</p>}</article></div>;}}</LiveTranscriptWindow></section><div className="conversation-feedback"><div className="conversation-float-stack"><ProcessingProgress rows={receipts} connected={connected} sending={busy} unconfirmed={!!pending&&!busy}><ContextWindowIndicator owner="Lead" resetKey={`${selected}:${conversation?.contract?.generation??''}:${conversation?.native?.thread??''}:${contextReceipt?.attempt??''}:${contextReceipt?receipts.indexOf(contextReceipt)+1:0}`} observation={contextReading(contextReceipt?.context,contextReceipt?.attempt,contextReceipt?.thread,contextReceipt?.turn)}/></ProcessingProgress></div></div><div ref={composerDock} className="composer-dock">{mode==='session_v1'&&<SessionDecisions session={selected} connected={connected} busy={busy||!!pending} revision={w?.receipts.map(r=>r.id+":"+r.revision).join(",")??''} selection={decisionSelection} onReply={selectDecision} onClear={()=>selectDecision(undefined)} onError={setError}/>}
 {legacy&&<p className="activity-meta">An unassigned draft from an earlier client is retained. <button type="button" className="quiet" disabled={!selected||busy} onClick={()=>{store('draft',legacy);setDraft(legacy);draftRef.current=legacy;setLegacy('');}}>Copy saved draft here</button></p>}
 <LiveActivity steps={activity.page?.live??[]} receipts={receipts} connected={connected}/><p id="steering-notice" className="steering-notice" ref={steeringNotice} hidden={!showSteeringNotice}>Live steering requires a running Codex Lead turn.</p><InputQueue key={scope.current} receipts={receipts} session={selected} connected={connected} paused={mode!=='session_v1'&&!!w?.queue_paused} onPause={mode==='session_v1'?undefined:paused=>void queueControl(paused)} onRefresh={()=>setRetry(v=>v+1)} onError={setError}/><div ref={composerWrap} className="composer-wrap" hidden={!conversation}><section className="image-drafts" aria-label="Attached images" hidden={!imageDrafts.length}><ul>{imageDrafts.map((v,i)=><li key={v.id} className="image-draft"><button type="button" className="quiet image-thumbnail" aria-label={`Preview attached image ${i+1}`} onClick={()=>setPreview({src:v.src||(v.attachment?imageURL(selected,v.attachment.id):''),name:v.name})}>{(v.src||v.attachment)&&<img src={v.src||imageURL(selected,v.attachment!.id)} alt="" width="56" height="56"/>}<span>{v.name}</span></button><button type="button" className="quiet image-remove" aria-label={`Remove attached image ${i+1}`} disabled={busy||!!pending} onClick={e=>{removeImageMotion(e.currentTarget.closest('li'));images.remove(scope.current,selected,v.id);document.getElementById('prompt')?.focus({preventScroll:true});}}>×</button><small role="status">{v.status==='ready'?'Ready':v.status==='uploading'?'Uploading…':'Upload failed'}</small>{v.error&&<p className="image-error" role="alert">{v.error}</p>}{v.status==='error'&&v.file&&<button type="button" className="quiet image-retry" onClick={()=>images.retry(scope.current,selected,v.id)}>Retry upload</button>}</li>)}</ul></section>
 <div ref={statusRef} role="status" hidden={!keyboardStatus} inert={!keyboardStatus} className="composer-interrupt-hint">{lastStatus.current}</div>{(live.pending||live.notice)&&<p className="activity-meta steering-status" role="status">{live.notice??'Checking live delivery…'}{live.retry&&<button type="button" className="quiet" disabled={!connected} onClick={live.retry}>Retry live delivery</button>}</p>}<form className={showLiveActions?'composer composer-live':'composer'} onSubmit={e=>{e.preventDefault();void send(e.timeStamp);}}><label htmlFor="prompt" className="sr-only">{mode==='session_v1'?'Message your team':'Ask a read-only question'}</label><textarea ref={bindComposerInput} onPaste={e=>{const files=Array.from(e.clipboardData.items).filter(v=>v.kind==='file'&&v.type.startsWith('image/')).map(v=>v.getAsFile()).filter((v):v is File=>!!v);if(files.length){if(!e.clipboardData.getData('text/plain'))e.preventDefault();if(pending||(mode!=='session_v1'&&mode!=='read_only'&&!mode.startsWith('ordinary_'))){setError('Resolve pending input and choose read-only or a configured developer session before attaching images.');return;}images.add(scope.current,selectedRef.current,files);}}} id="prompt" aria-describedby={showSteeringNotice?"composer-help steering-notice":"composer-help"} placeholder={mode==='session_v1'?'Message your team…':'Describe what you want to understand…'} maxLength={16384} value={draft} onChange={e=>{const value=e.target.value;setDraft(value);draftRef.current=value;try{store('draft',value);}catch(err){setError(String(err));}}} onKeyDown={e=>{if(composerEnterSubmits({key:e.key,shiftKey:e.shiftKey,isComposing:e.nativeEvent.isComposing||e.keyCode===229,defaultPrevented:e.defaultPrevented},touchEnter)){e.preventDefault();if(!e.repeat)void send(e.timeStamp);}}}/><div className="composer-actions"><ImagePicker owner={scope.current+'|'+selected} disabled={!connected||!selected||busy||!!pending||(mode!=='session_v1'&&mode!=='read_only'&&!mode.startsWith('ordinary_'))} onFiles={(files,owner)=>{const [source,session]=owner.split('|');if(source&&session)images.add(source,session,files);}}/><DictationControl sessionId={selected} drafts={dictationDrafts} navigationKey={Number(!!original.selection||settingsOpen||nav||!!sessionDialog||(narrow?tab!=='conversation':contentMode==='workspace'))} disabled={!!original.selection||!connected||!selected||busy||!!pending} onSettings={()=>{setSettingsOpen(true);setDictationSettings(true);}}/><span id="composer-help">{composerHelp}</span>{showLiveActions&&liveTarget&&<><ComposerAction stop stopping={stopping} disabled={!connected||stopping||!stopTarget} label={stopping?'Stopping Lead':'Stop Lead'} title="Stop the current Lead turn" onStop={()=>void stopLead()}/><button type="button" className="send composer-labeled" disabled={!canSendNow} title={imageDrafts.length?'Queue images for the next turn':selectionRef.current?'Queue the decision reply for the next turn':'Send to the current Lead turn'} onClick={()=>{if(canSendNow){following.current=true;live.send(liveTarget,draftRef.current);}}}>Send now</button></>}<ComposerAction showLabel={showLiveActions&&queuedSend} stop={stopMode} stopping={stopMode&&stopping} disabled={composerDisabled} label={composerLabel} title={composerTitle} onStop={()=>void stopLead()}/></div></form></div>{pending&&!busy&&<p className="activity-meta pending">Delivery is unconfirmed. Deck is checking for the receipt. You can retry the retained message. Newer draft edits are kept.</p>}</div></main>
 <Inspector key={selected} session={selected} open={inspectorOpen} narrow={narrow} returnFocus={inspectorTrigger}>{tabs}<div className="workspace-stack"> <section className="workspace-panel" hidden={tab!=='activity'} id="panel-activity" role="tabpanel" aria-labelledby="tab-activity"><div className="activity-view"><section className="activity-content" tabIndex={0}>{mode==='session_v1'&&<SessionDecisions session={selected} connected={connected} busy={busy||!!pending} revision={w?.receipts.map(r=>r.id+":"+r.revision).join(",")??''} onReply={selectDecision} onClear={()=>selectDecision(undefined)} onError={setError}/>}{mode!=='session_v1'&&<section aria-label="Session controls">{sessionSettings}</section>}<div className="session-actions"><button className="quiet" disabled={!connected||!conversation?.native||selectedWorking||!!pending} onClick={()=>void sessionAction('release')}>Release saved native context</button><button className="quiet" disabled={!connected||(w?.sessions.length||0)<=1||selectedWorking||!!pending} onClick={()=>void sessionAction('remove')}>Remove local conversation</button></div><ActivityTimeline visible={activityVisible} activity={activity} receipts={receipts} session={selected} connected={connected} onError={setError} onCancel={cancel}/></section></div></section>
 <section className="workspace-panel" hidden={tab!=='subagents'} id="panel-subagents" role="tabpanel" aria-labelledby="tab-subagents"><Subagents onRefresh={()=>setRetry(v=>v+1)} unassigned={!!conversation?.contract&&!Object.keys(conversation.contract.members).some(id=>id!=='lead')} onAssignments={()=>setSessionDialog('assignments')} key={scope.current} historySession={!!conversation?.original} tasks={w?.tasks??[]} decisions={memberDecisions} session={selected} visible={!settingsOpen&&!nav&&!sessionDialog&&tab==='subagents'&&inspectorOpen} connected={connected} onError={setError}/></section>
 <section className="workspace-panel git-pane" hidden={tab!=='review'} id="panel-review" role="tabpanel" aria-labelledby="tab-review">{w&&<GitChanges catalog={gitCatalog} key={w.host_id+selected} session={selected} storageScope={scope.current} narrow={narrow} visible={!settingsOpen&&tab==='review'&&inspectorOpen}/>}</section>
</div></Inspector>

 

 </div>{openingSession&&<SessionLoading name={openingSession.name} error={openingSession.error} onRetry={()=>selectLiveSession(openingSession.id)}/>}</div></div> <Appearance installDeck={installDeck} resources={w?<AgentSettings w={w} connected={connected} projectId={w.sessions.find(s=>s.id===selected)?.project?.id}/>:null} notifications={notifications} dictation={dictationSettings} onDictation={setDictationSettings} open={settingsOpen} narrow={narrow} theme={theme} font={font} chatWidth={chatWidth} onChatWidth={value=>{
  const node=root.current;if(!node||value===chatWidth)return;
  const column=node.querySelector<HTMLElement>('.app-body:not([hidden]) .conversation>.transcript-window, .history-view .conversation>.history-content');
  const current=column?.getBoundingClientRect().width;
  gsap.killTweensOf(node,'--chat-column-width');
  savePreference('chat-width',value);
  setChatWidth(value);
  if(current!==undefined){
   // Start at the current visual width; the effect retargets after layout commits.
   node.style.setProperty('--chat-column-width',current+'px');
  }
 }} onTheme={(value,bounds)=>{reveal.current?.select(value,bounds);setTheme(value);}} onFont={setFont} onBack={()=>setSettingsOpen(false)}/><>{notificationsOpen&&<NotificationsDialog settings={notifications} onClose={()=>setNotificationsOpen(false)}/>}</><WorkspaceDialog transitionSource={sessionDialog==='transition'?conversation:undefined} projectId={sessionDialog==='assignments'||sessionDialog==='transition'?selectedProject?.id:creationProject} open={sessionDialog!==null} session={sessionDialog==='assignments'?conversation:undefined} onClose={()=>setSessionDialog(null)} onSaved={id=>void sessionSaved(id)}/><ImagePreview image={preview} onClose={()=>setPreview(undefined)}/></div></SecondaryInfoProvider>;
}
// Fragment capabilities are consumed once and removed before application rendering.
addEventListener('hashchange',()=>{if(location.hash)location.reload();});
document.documentElement.dataset.theme=resolveTheme(readPreference('theme'));
document.documentElement.dataset.font=resolveFont(readPreference('font'));
const safeSession=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)&&!id.includes('..');
const capability=location.hash.slice(1);history.replaceState(null,'',location.pathname+location.search);
let authError='';
if(capability){try{const r=await fetch(capability.startsWith('pair=')?'/pair':'/auth',{method:'POST',headers:{'Content-Type':capability.startsWith('pair=')?'application/json':'text/plain'},body:capability.startsWith('pair=')?JSON.stringify({token:capability.slice(5)}):capability});if(!r.ok){const problem:unknown=await r.json();if(typeof problem==='object'&&problem!==null&&'message' in problem&&typeof problem.message==='string')authError=problem.message;else throw new Error();}}catch{authError='Launch authentication could not reach this host. Your saved draft and unresolved identity are retained. In the terminal that started this host, use its Open/reopen command with the exact state directory; if stopped, restart that host first.';}}
if(!capability&&location.protocol==='https:'){try{await fetch('/api/local-access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Browser'})});}catch{ /* Normal workspace admission reports unavailable access. */ }}
if('serviceWorker' in navigator&&window.isSecureContext)void navigator.serviceWorker.register('/service-worker.js',{scope:'/'}).catch(()=>{});
createRoot(document.getElementById('app')!).render(<App authError={authError} offerRemember={!!capability&&!authError}/>);
