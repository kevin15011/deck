import { expect, test } from 'bun:test';
import { validateDeckConfig } from '@deck/core';
import { checkSessionWeb } from './session-web-doctor';
test('Doctor checks listener bind/port and warns for exposure without invoking tools', async () => {
  const c = validateDeckConfig({ version: 1, crossRunner: { enabled: true, web: { trustedProxy: '127.0.0.1', allowedOrigins: ['https://deck.example'], allowFunnel: true } } }).crossRunner!;
  const healthy = await checkSessionWeb(c, async () => ({ enabled: true, hostname: '127.0.0.1', port: 7421 }));
  expect(healthy.status).toBe('warning');
  expect(healthy.items[0]!.message).toContain('127.0.0.1:7421');
  expect(healthy.items[1]!.message).toContain('Funnel');
  expect((await checkSessionWeb(c, async () => ({ enabled: true, hostname: '0.0.0.0', port: 7421 }))).status).toBe('error');
  expect((await checkSessionWeb(c, async () => ({ enabled: false, hostname: '127.0.0.1', port: 7421, error: 'web-listen-failed' }))).status).toBe('error');
  let calls = 0;
  expect((await checkSessionWeb(undefined, async () => { calls++; return undefined; })).status).toBe('ok');
  expect(calls).toBe(0);
});
test('Doctor reports opt-in Serve authentication without claiming pairing is required', async () => {
 const c=validateDeckConfig({version:1,crossRunner:{enabled:true,web:{tailscaleServeAccess:true,trustedProxy:'127.0.0.1',allowedOrigins:['https://deck.tail123.ts.net']}}}).crossRunner!;
 const report=await checkSessionWeb(c,async()=>({enabled:true,hostname:'127.0.0.1',port:7421}));
 expect(report.items[1]!.message).toContain('without pairing');
 expect(report.items[1]!.message).toContain('Funnel cannot enroll automatically');
});
