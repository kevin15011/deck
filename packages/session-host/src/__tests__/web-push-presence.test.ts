import { expect, test } from 'bun:test';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebPush } from '../web-push';
import type { AttentionItem } from '../push-attention';

test('presence delays unseen attention only until the acknowledgement deadline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-push-presence-'));
  let now = Date.now();
  const item: AttentionItem = { sessionId: 'session', kind: 'decision', key: 'decision:one', revision: 1, seq: 10, ts: now };
  const sent: number[] = [];
  const push = new WebPush({ paths: { webDir: dir } as any, now: () => now, isDeviceActive: () => true, isCurrent: () => true,
    attentionSessions: () => ['session'], attentionItems: () => [item], send: async (_details, payload) => { sent.push(payload.seq); return 201; } });
  const key = createECDH('prime256v1'); key.generateKeys();
  try {
    push.subscribe('device', 'https://deck.example', { endpoint: 'https://fcm.googleapis.com/test', keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } });
    push.presence('device', 'https://deck.example', 'tab', 'session', 1, 9);
    await Bun.sleep(80);
    expect(sent).toEqual([]);
    now += 2100;
    push.presence('device', 'https://deck.example', 'tab', 'session', 2, 9);
    await Bun.sleep(100);
    expect(sent).toEqual([10]);
    item.key = 'decision:two'; item.seq = 11; item.ts = now;
    push.evaluate('session');
    push.presence('device', 'https://deck.example', 'tab', 'session', 3, 11);
    await Bun.sleep(100);
    expect(sent).toEqual([10]);
    expect(push.status('device', 'https://deck.example').delivery.suppressed).toBeGreaterThan(0);
  } finally { push.close(); rmSync(dir, { recursive: true, force: true }); }
});
