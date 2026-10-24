import React from 'react';
import {test,expect} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {DeckMenu,installHelp,InstallDeckDialog} from './install-deck';
test('install is a menu item, hidden in standalone, and has no chat/banner/permission action',()=>{
 expect(renderToStaticMarkup(<DeckMenu hidden onInstall={()=>{}}/>)).toBe('');
 const html=renderToStaticMarkup(<DeckMenu hidden={false} onInstall={()=>{}}/>);expect(html).toContain('Deck menu');expect(html).toContain('aria-haspopup="menu"');expect(html).not.toContain('Install Deck');expect(html).not.toContain('Notification');
});
test('manual guidance is platform appropriate and install status never promises global detection',()=>{
 expect(installHelp(true)).toContain('In Safari');expect(installHelp(true)).toContain('Share');expect(installHelp(false)).toContain('if available');expect(installHelp(false,false)).toContain('HTTPS');
 const html=renderToStaticMarkup(<InstallDeckDialog open={false} onClose={()=>{}} help={installHelp(false)} status="Installation dismissed." pending={false}/>);expect(html).toContain('Installation does not enable notifications');expect(html).toContain('aria-live="polite"');
});
test('mobile navigation exposes installation directly in its secondary footer without another menu',()=>{
 const html=renderToStaticMarkup(<DeckMenu inline hidden={false} onInstall={()=>{}}/>);
 expect(html).toContain('Install Deck');expect(html).not.toContain('aria-haspopup');expect(html).not.toContain('deck-menu-items');
 expect(renderToStaticMarkup(<DeckMenu inline hidden onInstall={()=>{}}/>)).toBe('');
});
test('mobile drawer has one theme dialog action alongside install and restart',()=>{
 const html=renderToStaticMarkup(<DeckMenu inline hidden={false} onInstall={()=>{}} onRestart={()=>{}} theme="green" onTheme={()=>{}}/>);
 expect(html).toContain('Install Deck');expect(html).toContain('Restart Deck');
 expect((html.match(/aria-haspopup="dialog"/g)??[]).length).toBe(1);
 expect(html).toContain('Green');expect(html).not.toContain('Light');
});
test('notifications have one dialog action with state and attention in either menu',()=>{
 const props={hidden:true,onInstall:()=>{},onNotifications:()=>{},notificationsEnabled:true,notificationsAttention:true};
 const inline=renderToStaticMarkup(<DeckMenu {...props} inline/>);
 expect(inline).toContain('Notifications');expect(inline).toContain('On');expect(inline).toContain('aria-haspopup="dialog"');
 const popup=renderToStaticMarkup(<DeckMenu {...props}/>);
 expect(popup).toContain('menu-attention');expect(popup).toContain('Notifications need attention');
});
