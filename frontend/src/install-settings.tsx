import React,{useLayoutEffect,useRef,useState} from 'react';

type InstallChoice={outcome:'accepted'|'dismissed'};
type InstallPromptEvent=Event & {
 prompt:()=>Promise<InstallChoice|void>;
 userChoice?:Promise<InstallChoice>;
};

function installationHelp(){
 if(!window.isSecureContext)return 'Open Deck over HTTPS or from a loopback address on this device. Then check your browser’s menu for an install option.';
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 if(ios)return 'Open Deck in Safari, tap Share, choose Add to Home Screen, then tap Add.';
 return 'Open your browser’s menu and look for Install app or Add to Home Screen. Some browsers do not offer installation.';
}

export function useInstallDeck(){
 const promptEvent=useRef<InstallPromptEvent>(null);
 const prompting=useRef(false);
 const [installed,setInstalled]=useState(false);
 const [standalone,setStandalone]=useState(false);
 const [pending,setPending]=useState(false);
 const [status,setStatus]=useState('');
 const [showHelp,setShowHelp]=useState(false);

 useLayoutEffect(()=>{
  const displayMode=matchMedia('(display-mode: standalone)');
  const updateDisplayMode=()=>setStandalone(displayMode.matches||(navigator as Navigator & {standalone?:boolean}).standalone===true);
  const capture=(event:Event)=>{
   const candidate=event as InstallPromptEvent;
   if(typeof candidate.prompt!=='function')return;
   event.preventDefault();
   promptEvent.current=candidate;
  };
  const markInstalled=()=>{
   promptEvent.current=null;
   setInstalled(true);
  };
  updateDisplayMode();
  window.addEventListener('beforeinstallprompt',capture);
  window.addEventListener('appinstalled',markInstalled);
  displayMode.addEventListener('change',updateDisplayMode);
  return ()=>{
   window.removeEventListener('beforeinstallprompt',capture);
   window.removeEventListener('appinstalled',markInstalled);
   displayMode.removeEventListener('change',updateDisplayMode);
  };
 },[]);

 async function activate(){
  if(installed||standalone||prompting.current)return;
  const event=promptEvent.current;
  promptEvent.current=null;
  setStatus('');
  setShowHelp(!event);
  if(!event)return;

  prompting.current=true;
  setPending(true);
  try{
   // Call in the click handler before yielding the browser's user activation.
   const result=event.prompt();
   const [choice]=await Promise.all([event.userChoice??result,result]);
   if(choice?.outcome==='accepted'){
    setStatus('Installation accepted. Look for Deck in your apps.');
   }else{
    setStatus(choice?.outcome==='dismissed'?'Installation dismissed.':'');
    setShowHelp(true);
   }
  }catch{
   setStatus('The browser’s install prompt is unavailable.');
   setShowHelp(true);
  }finally{
   prompting.current=false;
   setPending(false);
  }
 }

 return {installed:installed||standalone,pending,status,showHelp,activate};
}

export function InstallSettings({install}:{install:ReturnType<typeof useInstallDeck>}){
 const {installed,pending,status,showHelp,activate}=install;
 return <div className="settings-card"><div className="settings-row"><div>
  <h3>Install Deck</h3>
  <p>Open Deck as an app on this device.</p>
  <div role="status">
   {installed?<p>Deck is installed on this device.</p>:<>
    {(pending||status)&&<p>{pending?'Waiting for your browser’s install prompt…':status}</p>}
    {showHelp&&<p>{installationHelp()}</p>}
   </>}
  </div>
 </div><button type="button" className="quiet" disabled={installed||pending} onClick={activate}>{installed?'Installed':'Install'}</button></div></div>;
}
