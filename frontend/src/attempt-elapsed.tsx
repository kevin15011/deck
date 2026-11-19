import React, {useEffect, useMemo, useState} from 'react';

type AttemptTiming = {id:string; phase:string; accepted_ms:number; settled_ms?:number|null};
const activePhases = new Set(['queued','accepted','preparing','dispatching','running','cancelling']);

export function AttemptElapsed({attempt, visible=true, className}:{attempt:AttemptTiming; visible?:boolean; className?:string}) {
 const observedAt = useMemo(Date.now, [attempt.id, attempt.phase, visible]);
 const [now,setNow] = useState(Date.now);
 const active = attempt.settled_ms == null && activePhases.has(attempt.phase);
 useEffect(() => {
  if (!visible || !active) return;
  const timer = setInterval(() => setNow(Date.now()), 15000);
  return () => clearInterval(timer);
 }, [visible, active]);
 const end = attempt.settled_ms ?? (active ? Math.max(now, observedAt) : observedAt);
 const minutes = Math.max(0, Math.floor((end - attempt.accepted_ms) / 60000));
 const elapsed = minutes < 1 ? '< 1 min' : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
 return <span className={className} title="Elapsed time">{elapsed}</span>;
}
