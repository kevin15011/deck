import React from 'react';
import { createRoot } from 'react-dom/client';
import { usePromptInbox } from './prompt-queue';
import type { Api } from './workspace';
import type { SessionEvent } from '../../../packages/core/src/session/events';

const pending: Array<(value: any) => void> = [];
const api = (() => new Promise(resolve => pending.push(resolve))) as Api;
let setInput: React.Dispatch<React.SetStateAction<{sessionId:string;events:SessionEvent[]}>>;
function Harness() {
 const [input, set] = React.useState<{sessionId:string;events:SessionEvent[]}>({sessionId:'first',events:[]});
 setInput = set;
 const { inbox } = usePromptInbox(api, input.sessionId, true, input.events);
 return <output>{JSON.stringify(inbox)}</output>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
Object.assign(window, {
 requestCount: () => pending.length,
 change: (sessionId:string, events:SessionEvent[]) => setInput({sessionId,events}),
 resolveRequest: (index:number, data:unknown) => pending[index]!({data}),
});
