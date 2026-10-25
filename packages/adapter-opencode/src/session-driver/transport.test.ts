import { expect, test } from 'bun:test';
import { readOpenCodeBody } from './transport';

test('HTTP body is byte bounded, cancelled and unlocked on overflow without retaining payload in the error', async () => {
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('SECRET€😀')); }, cancel() { cancelled++; } });
  const error = await readOpenCodeBody(new Response(body), new AbortController().signal, 8).catch(e => e);
  expect(error.code).toBe('opencode-http-body-too-large');
  expect(error.size).toEqual({ frameBytes: 13, frameBytesKind: 'lower-bound', maxFrameBytes: 8 });
  expect(String(error)).not.toContain('SECRET'); expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});

test('HTTP max boundary permits UTF-8 split across byte chunks and releases the reader', async () => {
  const bytes = new TextEncoder().encode('€😀');
  const body = new ReadableStream<Uint8Array>({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
  expect(await readOpenCodeBody(new Response(body), new AbortController().signal, bytes.length)).toBe('€😀');
  expect(body.locked).toBe(false);
});

test('HTTP abort cancels an outstanding read and releases its lock', async () => {
  let cancelled = 0; const controller = new AbortController();
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
  const reading = readOpenCodeBody(new Response(body), controller.signal).catch(e => e);
  controller.abort(new Error('fixture-abort'));
  expect((await reading).message).toBe('fixture-abort'); expect(cancelled).toBe(1); expect(body.locked).toBe(false);
});
