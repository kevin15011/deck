import { readFileSync, lstatSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { CODEX_SUPERMEMORY_FILES, CODEX_SUPERMEMORY_VERSION } from '../../../packages/adapter-codex/src/supermemory-artifact';
import { CLAUDE_SUPERMEMORY_FILES, CLAUDE_SUPERMEMORY_COMMIT } from '../../../packages/adapter-claude/src/supermemory-artifact';
import { OPENCODE_SUPERMEMORY_PACKAGE_VERSION, buildOpenCodeSupermemoryLoaderContent } from '../../../packages/adapter-opencode/src/opencode-supermemory-plugin';
import { NamespaceTransport } from '../namespace-transport';
import { gateway, LOCAL_BEARER, IPC_ORIGIN } from '../gateway';
import { secureDir, privateWrite, sha256, scrub, fail } from '../security';
import { OpaqueIdentities } from './identities';
import type { Seed } from './runtime';
export type NativeRoute = 'claude' | 'codex' | 'opencode';
const fixtureRoot = resolve(import.meta.dir, '../fixtures/native');
export function verifyNative(route: NativeRoute) {
    let entries: readonly (readonly [
        string,
        string,
        number?
    ])[];
    if (route === 'claude')
        entries = CLAUDE_SUPERMEMORY_FILES;
    else if (route === 'codex')
        entries = CODEX_SUPERMEMORY_FILES.map(e => [e[0], e[2], e[3]] as const);
    else {
        // Private adapter digest table is the canonical manifest; read it instead of maintaining a second pin.
        const source = readFileSync(resolve(import.meta.dir, '../../../packages/adapter-opencode/src/opencode-supermemory-plugin.ts'), 'utf8');
        const block = source.match(/const PUBLISHED_ARTIFACT_DIGESTS = Object.freeze\(\{([\s\S]*?)\}\);/)?.[1];
        if (!block)
            fail('opencode_adapter_pin_unreadable');
        entries = [...block.matchAll(/"([^"]+)": "([a-f0-9]{64})"/g)].map(m => [m[1]!, m[2]!] as const);
        if (entries.length !== 3)
            fail('opencode_adapter_pin_unreadable');
    }
    const hashes: Record<string, string> = {};
    for (const [path, digest, size] of entries) {
        const target = join(fixtureRoot, route, path);
        const st = lstatSync(target);
        if (!st.isFile() || st.isSymbolicLink() || size !== undefined && st.size !== size)
            fail('native_pin_mismatch');
        const hash = sha256(readFileSync(target));
        if (hash !== digest)
            fail('native_pin_mismatch');
        hashes[path] = hash;
    }
    return { route, version: route === 'claude' ? CLAUDE_SUPERMEMORY_COMMIT : route === 'codex' ? CODEX_SUPERMEMORY_VERSION : OPENCODE_SUPERMEMORY_PACKAGE_VERSION, hashes, root: join(fixtureRoot, route) };
}
export class NativeReplay {
    readonly pin;
    readonly home: string;
    readonly requests: any[] = [];
    #handler;
    readonly isolation: any[] = [];
    private identities: OpaqueIdentities;
    #origin: string;
    constructor(readonly route: NativeRoute, readonly root: string, readonly t: NamespaceTransport, readonly offline: boolean) {
        const verified = verifyNative(route);
        const install = secureDir(join(root, 'native', route, 'plugin'));
        const materialized = route === 'opencode' ? secureDir(join(install, 'node_modules', 'opencode-supermemory')) : install;
        for (const name of Object.keys(verified.hashes)) {
            privateWrite(join(materialized, name), readFileSync(join(verified.root, name), 'utf8'));
        }
        if (route === 'opencode')
            privateWrite(join(install, 'loader.mjs'), buildOpenCodeSupermemoryLoaderContent());
        if (route !== 'opencode')
            privateWrite(join(materialized, 'package.json'), { type: 'commonjs' });
        this.pin = { ...verified, root: materialized };
        this.home = secureDir(join(root, 'native', route, 'home'));
        this.#handler = gateway(t);
        this.#origin = IPC_ORIGIN;
        this.identities = new OpaqueIdentities(root);
    }
    async hook(file: string, payload: any, projectRoot: string, scope: string): Promise<{
        status: string;
        output: string;
        exitCode: number | null;
        durationMs: number;
        writes: number;
        reason?: string;
    }> {
        if (this.t.aborted)
            fail('request_budget_exhausted');
        const session = this.identities.get(`${this.route}:session`, String(payload.session_id));
        if (this.route === 'opencode') {
            const users = (payload.messages ?? []).filter((m: any) => m.role === 'user');
            const ids: string[] = [];
            for (let first = 0; first < users.length; first++)
                for (let last = first; last < users.length; last++)
                    ids.push('opencode:capture:' + sha256(`${session}:${users[first].id}:${users[last].id}`));
            this.t.registerCustomIds(scope, ids);
        }
        else
            this.t.registerCustomIds(scope, [session]);
        const start = performance.now();
        const before = this.t.events.filter(e => e.endpoint === '/v3/documents' && e.status !== undefined && e.status >= 200 && e.status < 300 && !!e.documentId).length;
        const env: Record<string, string> = { PATH: process.env.PATH!, HOME: this.home, USER: 'eval', USERNAME: 'eval', LANG: 'C.UTF-8', XDG_CONFIG_HOME: secureDir(join(this.home, '.config')), XDG_STATE_HOME: secureDir(join(this.home, '.state')), XDG_CACHE_HOME: secureDir(join(this.home, '.cache')), CODEX_HOME: secureDir(join(this.home, '.codex')), CLAUDE_PLUGIN_ROOT: this.pin.root, SUPERMEMORY_CC_API_KEY: LOCAL_BEARER, SUPERMEMORY_CODEX_API_KEY: LOCAL_BEARER, SUPERMEMORY_API_KEY: LOCAL_BEARER, SUPERMEMORY_API_URL: this.#origin, SUPERMEMORY_REPO_TAG: scope, DECK_EVAL_GATEWAY: this.#origin, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(this.home, 'empty-gitconfig') };
        const isOpen = this.route === 'opencode';
        const args = ['--require', resolve(import.meta.dir, 'network-fence.cjs'), isOpen ? resolve(import.meta.dir, 'opencode-host.mjs') : join(this.pin.root, file)];
        const child = spawn('unshare', ['-rn', '--', 'node', ...args], { cwd: projectRoot, env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
        let output = '';
        let timedOut = false;
        let launchFailed = false;
        const pending = new Set<Promise<void>>();
        const controllers = new Map<number, AbortController>();
        child.stdout!.on('data', b => {
            if (output.length < 256 * 1024)
                output += b.toString();
        });
        child.stderr!.resume();
        child.on('message', (m: any) => {
            if (m?.kind === 'eval-isolation') {
                this.isolation.push(m);
                return;
            }
            if (m?.kind === 'eval-fence-blocked') {
                this.t.recordNativeFenceBlock(m.effect, m.durationMs);
                return;
            }
            if (m?.kind === 'eval-http-abort') {
                controllers.get(m.id)?.abort();
                return;
            }
            if (m?.kind !== 'eval-http')
                return;
            const controller = new AbortController();
            controllers.set(m.id, controller);
            const task = (async () => {
                let status = 403, body = '{}';
                let responseHeaders: Record<string, string> = { 'content-type': 'application/json' };
                try {
                    const u = new URL(m.url);
                    if (u.origin !== this.#origin)
                        fail('native_origin_rejected');
                    const request = new Request(m.url, { method: m.method, headers: m.headers ?? {}, body: m.body, signal: controller.signal });
                    const r = await this.#handler(request);
                    responseHeaders = Object.fromEntries(r.headers);
                    status = r.status;
                    body = await r.text();
                }
                catch { }
                this.requests.push({ status, phase: this.t.phase });
                controllers.delete(m.id);
                if (child.connected)
                    child.send({ kind: 'eval-http-result', id: m.id, status, body, headers: responseHeaders });
            })();
            pending.add(task);
            task.finally(() => pending.delete(task));
        });
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
            for (const c of controllers.values())
                c.abort();
        }, 70000);
        const code = await new Promise<number | null>(resolve => { child.once('error', () => { launchFailed = true; resolve(null); }); child.once('close', resolve); child.stdin!.end(JSON.stringify({ ...payload, session_id: session, ...(isOpen ? { pluginRoot: dirname(dirname(this.pin.root)) } : {}) })); });
        clearTimeout(timer);
        await Promise.allSettled([...pending]);
        const writes = this.t.events.filter(e => e.endpoint === '/v3/documents' && e.status !== undefined && e.status >= 200 && e.status < 300 && !!e.documentId).length - before;
        return { status: timedOut || launchFailed || code !== 0 ? 'unavailable' : 'replayed', output: scrub(output), exitCode: code, durationMs: performance.now() - start, writes, ...(timedOut ? { reason: 'native_hook_timeout' } : launchFailed ? { reason: 'node_binary_unavailable' } : code !== 0 ? { reason: 'native_isolation_or_process_failed' } : {}) };
    }
    async capture(seed: Seed, projectRoot: string, scope: string) {
        const transcripts = secureDir(join(this.root, 'native', this.route, 'transcripts'));
        const nativeSession = this.identities.get(`${this.route}:session`, seed.session_id);
        const entryId = this.identities.get(`${this.route}:entry:${seed.session_id}`, seed.id);
        const path = join(transcripts, `${nativeSession}.jsonl`);
        const entry: any = this.route === 'claude' ? { type: seed.role, uuid: entryId, timestamp: '2026-10-21T00:00:00.000Z', message: { role: seed.role, content: seed.role === 'assistant' ? [{ type: 'text', text: seed.content }] : seed.content } } : { type: 'event_msg', timestamp: '2026-10-21T00:00:00.000Z', payload: seed.role === 'user' ? { type: 'user_message', message: seed.content } : { type: 'assistant_output_text', text: seed.content } };
        entry.uuid = entryId;
        const previous = existsSync(path) ? readFileSync(path, 'utf8') : '';
        const entries = previous.trim() ? previous.trim().split('\n').map(s => JSON.parse(s)) : [];
        if (!entries.some(e => e.uuid === entryId)) {
            entries.push(entry);
            privateWrite(path, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
        }
        return this.hook(this.route === 'claude' ? 'hooks/capture.js' : 'flush.js', { session_id: seed.session_id, transcript_path: path, cwd: projectRoot, operation: 'capture', seed: { role: seed.role, content: seed.content }, messages: entries.map(e => ({ id: e.uuid, role: e.type === 'event_msg' ? (e.payload.type === 'user_message' ? 'user' : 'assistant') : e.type, content: Array.isArray(e.message?.content) ? e.message.content.map((x: any) => x.text ?? '').join('\n') : e.message?.content ?? e.payload?.message ?? e.payload?.text })) }, projectRoot, scope);
    }
    async recall(query: string, sessionId: string, projectRoot: string, scope: string) {
        const payload = { session_id: sessionId, cwd: projectRoot, prompt: query, operation: 'recall' };
        // SessionStart is part of Claude's actual route; its output is a distinct injection surface.
        const session = this.route === 'claude' ? await this.hook('hooks/session-start.js', payload, projectRoot, scope) : undefined;
        const prompt = await this.hook(this.route === 'claude' ? 'hooks/recall-directive.js' : 'recall.js', payload, projectRoot, scope);
        return { session, prompt, output: [session?.output, prompt.output].filter(Boolean).join('\n') };
    }
    close() { }
}
