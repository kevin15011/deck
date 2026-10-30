import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MessageInput} from '../src/message-input';
import {gsap} from '../src/motion';
import '../src/style.css';
function Fixture(){const [text,setText]=useState('');return <form className="composer" style={{margin:30}} onSubmit={e=>e.preventDefault()}><MessageInput value={text} onChange={e=>setText(e.target.value)} aria-label="Message"/><button>Send</button></form>}
const root=createRoot(document.getElementById('root')!);root.render(<Fixture/>);Object.assign(window,{fixture:{dispose:()=>root.unmount(),gsap}});
