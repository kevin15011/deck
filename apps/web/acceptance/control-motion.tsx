/** Real controls with local state; no daemon, providers or native effects. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DeckMenu, InstallDeckDialog } from '../src/install-deck';
import { ThemeDialog } from '../src/theme-select';
import { SecondaryInfo } from '../src/secondary-info';
import { createSurfaceMotion } from '../src/control-motion';
import { installMotion } from '../src/motion-dom';
import { gsap } from 'gsap';
import type { Theme } from '../src/theme';
import '../src/style.css';
import '../src/themes.css';
const fonts = document.createElement('link'); fonts.rel = 'stylesheet'; fonts.href = '/fixture-fonts.css'; document.head.append(fonts);
const stopMotion = installMotion();
function Fixture() {
    const [theme, setTheme] = useState<Theme>('dark'), [picker, setPicker] = useState(false), [install, setInstall] = useState(false), [mounted, setMounted] = useState(true);
    Object.assign(window, { controlFixture: { setInstall, setMounted, gsap, createSurfaceMotion, dispose: () => { root.unmount(); stopMotion(); } } });
    return <main style={{ padding: 24 }}>
        <h1>Deck controls</h1><button onClick={() => setPicker(true)}>Choose theme</button>
        <button onClick={() => setInstall(true)}>Installation help</button>
        <SecondaryInfo title="Context details" label="Context"><p>Existing session context remains unchanged.</p></SecondaryInfo>
        <DeckMenu hidden={false} onInstall={() => setInstall(true)} theme={theme} onTheme={setTheme} font="inter" onFont={()=>{}}/>
        {mounted && <InstallDeckDialog open={install} onClose={() => setInstall(false)} help="Use your browser’s install menu." status="" pending={false}/>}
        {picker && <ThemeDialog value={theme} onChange={setTheme} onClose={() => setPicker(false)}/>}
    </main>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<Fixture/>);
