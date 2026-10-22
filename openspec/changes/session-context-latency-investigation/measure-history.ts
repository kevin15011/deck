/** Read source event files only; run EventLog on a disposable private copy.
 * Usage: bun run openspec/changes/session-context-latency-investigation/measure-history.ts /absolute/session/directory
 * Outputs aggregate metadata only. No inference, browser, network or live-log writes.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventLog } from '../../../packages/session-host/src/event-log';
import { ChatHistory } from '../../../packages/session-host/src/chat-history';
import type { SessionEvent } from '../../../packages/core/src/session/events';

const source = process.argv[2];
if (!source?.startsWith('/')) throw Error('An absolute session directory is required');
const scratch = mkdtempSync(join(tmpdir(), 'deck-history-measure-'));
let log: EventLog | undefined;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const withoutRaw = (event: SessionEvent) => { const { raw, ...rest } = event; return rest; };
const rounded = (n: number) => Math.round(n * 1000) / 1000;
try {
  const files = readdirSync(join(source, 'events')).filter(name => /^\d{6}\.jsonl$/.test(name)).sort();
  let diskBytes = 0;
  for (const file of files) {
    copyFileSync(join(source, 'events', file), join(scratch, file));
    diskBytes += statSync(join(scratch, file)).size;
  }
  let start = performance.now();
  log = EventLog.open({ dir: scratch, sessionId: basename(source) });
  const openMs = performance.now() - start;
  let reads = 0;
  const readEvent = log.readEvent.bind(log);
  log.readEvent = seq => { reads++; return readEvent(seq); };
  start = performance.now();
  const history = new ChatHistory(log);
  const indexMs = performance.now() - start, indexRandomReads = reads;
  reads = 0;
  start = performance.now();
  const page = history.page();
  const firstPageMs = performance.now() - start, firstPageReads = reads;
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    start = performance.now(); history.page(); samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  let eventBytes = 0, eventBytesWithoutRaw = 0, eventsWithRaw = 0;
  for (const event of log.readAfter(0)) {
    eventBytes += bytes(event); eventBytesWithoutRaw += bytes(withoutRaw(event));
    if (event.raw !== undefined) eventsWithRaw++;
  }
  const pageWithoutRaw = { ...page, events: page.events.map(withoutRaw), messages: page.messages.map(message => ({
    ...withoutRaw(message), ...(message.request ? { request: withoutRaw(message.request) } : {}),
  })) };
  console.log(JSON.stringify({
    kind: 'local-copied-ledger-characterization', runtime: Bun.version,
    sessionId: basename(source), segments: files.length, events: log.lastSeq, diskBytes,
    openMs: rounded(openMs), coldHistoryIndexMs: rounded(indexMs), indexRandomReads,
    firstPageMs: rounded(firstPageMs), firstPageReads,
    warmLatestPageMedianMs: rounded(samples[10]!), warmLatestPageP95Ms: rounded(samples[18]!), warmSamples: samples.length,
    pageMessages: page.messages.length, pageCurrentEvents: page.events.length,
    pageBytes: bytes(page), hypotheticalPageBytesWithoutRaw: bytes(pageWithoutRaw),
    eventsWithRaw, eventBytes, hypotheticalEventBytesWithoutRaw: eventBytesWithoutRaw,
    limitations: [
      'One local ledger; application-cold index, warm filesystem cache after copying; no mobile or browser measurement.',
      'Index construction includes any lazy byte-index construction triggered by readEvent.',
      'Raw removal is hypothetical serialization only; not a supported protocol change or measured transfer saving.',
      'Timings are observations, not regression thresholds or community incident attribution.',
    ],
  }, null, 2));
} finally { log?.close(); rmSync(scratch, { recursive: true, force: true }); }
