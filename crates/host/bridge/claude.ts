import {getSessionInfo, query, type EffortLevel, type McpHttpServerConfig, type Options, type SDKMessage, type SDKUserMessage} from '@anthropic-ai/claude-agent-sdk/core';
import {randomUUID} from 'node:crypto';
import {lstat, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {looksSecret, plainPath, summarizeCommand} from './command-summary';

const [binary, requestedThread, operation, sources, rawSettings, model, effort] = process.argv.slice(2);
const input = createInterface({input: process.stdin, crlfDelay: Infinity});
const abortController = new AbortController();
const inbox = input[Symbol.asyncIterator]();

function emit(event: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(event) + '\n');
}

async function next() {
  const {value, done} = await inbox.next();
  return done ? {type: 'stop'} : JSON.parse(value);
}

type Permit = {input?: Record<string, unknown>; denial?: string};

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
type UserContent = Exclude<SDKUserMessage['message']['content'], string>;
type Block = {type: 'text'; text: string} | {type: 'image'; source: {type: 'base64'; media_type: string; data: string}};

// Plain text keeps the SDK's string form. Images become Messages API blocks, so
// they reach the model in the same user message as their text.
function userContent(text: string, images: unknown): string | UserContent {
  if (images === undefined || (Array.isArray(images) && !images.length)) return text;
  if (!Array.isArray(images) || images.length > 8) throw Error('Invalid image attachments');
  const blocks: Block[] = [];
  if (text.trim()) blocks.push({type: 'text', text});
  for (const image of images) {
    if (typeof image?.mime !== 'string' || !imageTypes.has(image.mime) ||
        typeof image.data !== 'string' || !image.data || !base64.test(image.data)) {
      throw Error('Invalid image attachment');
    }
    blocks.push({type: 'image', source: {type: 'base64', media_type: image.mime, data: image.data}});
  }
  return blocks as unknown as UserContent;
}

const effortLevels = new Set<string>(['low', 'medium', 'high', 'xhigh', 'max']);
function isEffort(value: string): value is EffortLevel {
  return effortLevels.has(value);
}

const settings = JSON.parse(rawSettings);
const options: Options = {
  pathToClaudeCodeExecutable: binary,
  cwd: process.cwd(),
  env: process.env,
  abortController,
  systemPrompt: {type: 'preset', preset: 'claude_code'},
  settingSources: sources === 'user,project,local' ? ['user', 'project', 'local'] : ['user'],
  settings,
};

const deckServer = 'deck-session';
const deckToolPrefix = `mcp__${deckServer}__`;
const isUserMcpTool = (tool: string) => tool.startsWith('mcp__') && !tool.startsWith(deckToolPrefix);
const sameTools = (actual: string[], expected: string[]) =>
  actual.length === expected.length && expected.every(name => actual.includes(name));
type Bootstrap = {type: 'bootstrap'; transcriptStorage?: string; instructions: string; server: McpHttpServerConfig; toolNames: string[]; workspaceTools: string[]};

async function subscription(native: ReturnType<typeof query>) {
  const {account, claude_code_version} = await native.initializationResult();
  const plan = account.subscriptionType?.toLowerCase().replace(/^claude /, '');
  return claude_code_version && plan && ['pro', 'max', 'ultra', 'team', 'enterprise'].includes(plan) &&
    (account.tokenSource === undefined || account.tokenSource === 'claude.ai') &&
    (account.apiKeySource === undefined || account.apiKeySource === 'none') ? plan : undefined;
}

async function models(native: ReturnType<typeof query>) {
  const offered = await native.supportedModels();
  if (!offered.length) throw Error('Claude model catalog is empty');
  const rows = offered.map(row => ({
    modelId: row.value,
    label: row.displayName,
    thinkingLevels: row.supportsEffort === false ? [] : (row.supportedEffortLevels ?? []).filter(isEffort),
  }));
  if (!rows.some(row => row.modelId === 'default')) {
    rows.unshift({modelId: 'default', label: 'Claude Code default', thinkingLevels: []});
  }
  return rows;
}

const readUsage = (native: ReturnType<typeof query>) =>
  native.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({skipBehaviors: true});

function quotaMetadata(plan: string, usage: Awaited<ReturnType<typeof readUsage>>) {
  const limits = usage.rate_limits;
  if (!limits || usage.rate_limits_available !== true || usage.subscription_type !== plan) return undefined;
  const windows = [
    {id: 'five-hour', window: limits.five_hour},
    {id: 'seven-day', window: limits.seven_day},
    {id: 'seven-day-oauth-apps', window: limits.seven_day_oauth_apps},
    {id: 'seven-day-opus', window: limits.seven_day_opus},
    {id: 'seven-day-sonnet', window: limits.seven_day_sonnet},
    ...(Array.isArray(limits.model_scoped) ? limits.model_scoped.slice(0, 32).flatMap(window =>
      typeof window?.display_name === 'string' ? [{id: `model:${window.display_name}`, window}] : []) : []),
  ].flatMap(({id, window}) => {
    if (!window || typeof window.utilization !== 'number') return [];
    const resetsAt = typeof window.resets_at === 'string' ? Date.parse(window.resets_at) : NaN;
    return [{id, usedPercent: window.utilization, resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined}];
  });
  return {plan, windows, extraUsage: limits.extra_usage?.is_enabled === true};
}

async function accountRead() {
  // Keep the control pipe open for get_usage after initialize, without ever
  // yielding a user message. An iterable that immediately ends closes stdin.
  const {promise: done, resolve: finish} = Promise.withResolvers<void>();
  async function* noMessages(): AsyncGenerator<SDKUserMessage> { await done; }
  const native = query({prompt: noMessages(), options: {...options, persistSession: false, tools: [], permissionMode: 'dontAsk'}});
  try {
    const plan = await subscription(native);
    if (!plan) emit({type: 'unqualified'});
    else if (operation === 'quota') emit({type: 'quota', quota: quotaMetadata(plan, await readUsage(native))});
    else emit({type: 'models', models: await models(native)});
  } finally {
    finish();
    native.close();
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function memberTranscript(thread: string, storage: string | undefined) {
  try {
    const cwd = await realpath(process.cwd());
    const info = await getSessionInfo(thread, {dir: cwd});
    if (info) {
      return info.sessionId === thread && !info.archived && info.cwd &&
        await realpath(info.cwd) === cwd ? 'available' : 'unavailable';
    }
    // The SDK returns undefined for missing, unreadable and unusable history.
    // Independently confirm absence only in the pinned SDK's simple local layout.
    const key = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    if (!storage || key.length > 200 || cwd !== process.cwd()) return 'unavailable';
    const project = join(storage, 'projects', key);
    if (await realpath(project) !== project) return 'unavailable';
    try {
      await lstat(join(project, `${thread}.jsonl`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    }
  } catch {
    // Inaccessible or unrecognized storage is not evidence of absence.
  }
  return 'unavailable';
}

async function run() {
  const bootstrap: Bootstrap = await next();
  if (bootstrap.type !== 'bootstrap') throw Error('Missing Deck session configuration');
  const member = operation === 'member' || operation === 'member-resume';
  let resume = operation === 'resume' || operation === 'member-resume';
  let thread = requestedThread;
  if (operation === 'member-resume') {
    if (!uuid.test(thread)) throw Error('Invalid member session identity');
    const transcript = await memberTranscript(thread, bootstrap.transcriptStorage);
    if (transcript !== 'available') {
      emit({type: `transcript_${transcript}`});
      if (transcript !== 'missing') return;
      const fallback = await next();
      if (fallback.type !== 'start_fresh' || !uuid.test(fallback.session_id) ||
          fallback.session_id === thread) return;
      thread = fallback.session_id;
      resume = false;
    }
  }
  const deckTools = bootstrap.toolNames.map(name => deckToolPrefix + name);
  let stopped = false;
  let sent = false;
  let turnActive = false;
  let inputClosed = false;
  let steerEvidence = false;
  let closing = false;
  let sessionInitialized = false;
  let turnInitEmitted = false;
  let lastInitModel: string | undefined;
  let currentInitialId = '';
  let limited = false;
  function closeSteering() {
    inputClosed = true;
    if (member || !sent || steerEvidence) return;
    steerEvidence = true;
    emit({type: 'steer_terminal', session_id: thread, yielded: [...steers.keys()]});
  }
  function readiness(stage: string) {
    const started = performance.now();
    if (!member) emit({type: 'readiness', stage});
    return () => {
      if (!member) emit({type: 'readiness', stage, elapsed_ms: Math.round(performance.now() - started)});
    };
  }
  const tools = [...bootstrap.workspaceTools, 'Skill'];
  const pending = new Map<string, (permit: Permit | null) => void>();
  // Live messages by uuid. The CLI de-duplicates a repeated uuid, so a repeated
  // id is acknowledged from this state and never written to the CLI twice.
  const steers = new Map<string, 'sent' | 'acked'>();
  function settleSteer(id: string) {
    if (steers.get(id) !== 'sent') return;
    steers.set(id, 'acked');
    emit({type: 'steer_ack', session_id: thread, id});
  }
  const queuedUsers: SDKUserMessage[] = [];
  let waitingUser: ((result: IteratorResult<SDKUserMessage>) => void) | undefined;
  let userStreamClosed = false;
  function pushUser(message: SDKUserMessage) {
    if (userStreamClosed) return;
    if (waitingUser) {
      const resolve = waitingUser;
      waitingUser = undefined;
      resolve({value: message, done: false});
    } else {
      queuedUsers.push(message);
    }
  }
  function closeUsers() {
    if (userStreamClosed) return;
    userStreamClosed = true;
    if (waitingUser) {
      const resolve = waitingUser;
      waitingUser = undefined;
      resolve({value: undefined, done: true});
    }
  }
  async function* userStream(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      if (queuedUsers.length) {
        yield queuedUsers.shift()!;
        continue;
      }
      if (userStreamClosed) return;
      const item = await new Promise<IteratorResult<SDKUserMessage>>(resolve => {
        waitingUser = resolve;
      });
      if (item.done) return;
      yield item.value;
    }
  }

  const initialized = readiness("sdk");
  const native = query({
    prompt: userStream(),
    options: {
      ...options,
      // The replay echo is the CLI's acknowledgment of live guidance.
      extraArgs: {'replay-user-messages': null},
      ...(resume ? {resume: thread} : {sessionId: thread}),
      ...(model && model !== 'default' ? {model} : {}),
      ...(isEffort(effort) ? {effort} : {}),
      systemPrompt: {type: 'preset', preset: 'claude_code', append: bootstrap.instructions},
      includePartialMessages: true,
      persistSession: true,
      permissionMode: 'default',
      tools,
      allowedTools: [...deckTools, 'Skill', 'mcp__plugin_context-mode_context-mode'],
      // Deck validates each workspace tool request in the host.
      settings: {...settings, permissions: {ask: bootstrap.workspaceTools}},
      canUseTool: async (tool, input, {signal, toolUseID}) => {
        const deny = {behavior: 'deny', message: 'Deck did not authorize this tool call.'} as const;
        const userMcp = isUserMcpTool(tool);
        if (!turnActive || !sent || stopped || signal.aborted || (!bootstrap.workspaceTools.includes(tool) && !userMcp) ||
            typeof toolUseID !== 'string' || !toolUseID || toolUseID.length > 128) return deny;
        const edit = tool === 'Edit' || tool === 'Write';
        const bash = tool === 'Bash';
        if (bash && input.dangerouslyDisableSandbox !== undefined && input.dangerouslyDisableSandbox !== false) {
          return {...deny, message: 'Deck does not authorize Bash sandbox overrides.'};
        }
        if (bash && input.run_in_background !== undefined && input.run_in_background !== false) {
          return {...deny, message: 'Deck requires Bash to run in the foreground.'};
        }
        if (edit && (typeof input.file_path !== 'string' || input.file_path.length > 4096)) return deny;
        const request = randomUUID();
        const abort = new AbortController();
        const permit = await new Promise<Permit | null>(resolve => {
          pending.set(request, resolve);
          signal.addEventListener('abort', () => resolve(null), {once: true, signal: abort.signal});
          if (edit) {
            emit({type: 'workspace_write', session_id: thread, request, tool, file_path: input.file_path});
          } else {
            emit({type: bash ? 'workspace_bash' : userMcp ? 'mcp_permission' : 'permission', session_id: thread, request, tool, tool_use_id: toolUseID, input});
          }
        });
        abort.abort();
        pending.delete(request);
        if (signal.aborted && !stopped && !edit) {
          emit({type: bash ? 'workspace_bash_closed' : userMcp ? 'mcp_permission_closed' : 'permission_closed', session_id: thread, request});
        }
        if (!permit || stopped || signal.aborted) return deny;
        if (permit.denial) return {...deny, message: permit.denial};
        return {behavior: 'allow', updatedInput: edit || bash || userMcp ? input : permit.input};
      },
    },
  });
  let stdinLoop: Promise<void> | undefined;
  let stdinError: unknown;
  try {
    const plan = await subscription(native);
    initialized();
    if (!plan) {
      emit({type: 'unqualified'});
      return;
    }
    if (model !== 'default' || effort) {
      const checked = readiness("selection");
      const selected = (await models(native)).find(row => row.modelId === model);
      checked();
      if (!selected || (effort && !selected.thinkingLevels.some(level => level === effort))) {
        emit({type: 'selection_unavailable'});
        return;
      }
    }
    // Read the native plan on this exact SDK process. Credits can otherwise
    // take over after the included cap. Skip transcript-derived usage stats.
    async function verifyUsage() {
      const checkedUsage = readiness("usage");
      const usage = await readUsage(native);
      checkedUsage();
      const quota = quotaMetadata(plan!, usage);
      const credits = usage.rate_limits?.extra_usage;
      if (usage.rate_limits_available !== true || usage.subscription_type !== plan ||
          !credits || credits.is_enabled !== false) {
        emit({type: credits?.is_enabled === true ? 'credits_enabled' : 'usage_unverified', quota});
        return undefined;
      }
      if ([usage.rate_limits?.five_hour, usage.rate_limits?.seven_day, usage.rate_limits?.seven_day_oauth_apps]
          .some(window => (window?.utilization ?? 0) >= 100)) {
        emit({type: 'plan_limit', quota});
        return undefined;
      }
      return {quota};
    }
    async function verifyDeckInventory(quota: ReturnType<typeof quotaMetadata>) {
      const verified = readiness("deck_inventory");
      // One native snapshot verifies the Deck server. Other servers can still be pending.
      const servers = await native.mcpServerStatus();
      verified();
      const deckServers = servers.filter(candidate => candidate.name === deckServer);
      const [server] = deckServers;
      const advertised = server?.tools?.map(tool => tool.name);
      if (deckServers.length !== 1 || server?.status !== 'connected' ||
          server.source !== 'dynamic' || !advertised ||
          !sameTools(advertised, bootstrap.toolNames)) {
        emit({type: 'coordination_unavailable', quota});
        return false;
      }
      return true;
    }
    const usageCheck = await verifyUsage();
    if (!usageCheck) return;
    // Register over the SDK control pipe so the per-attempt token stays out of argv.
    const registered = readiness("deck_registration");
    const registration = await native.setMcpServers({[deckServer]: bootstrap.server});
    registered();
    if (!registration.added.includes(deckServer) || deckServer in registration.errors) {
      emit({type: 'coordination_unavailable', quota: usageCheck.quota});
      return;
    }
    if (!(await verifyDeckInventory(usageCheck.quota))) return;
    emit({type: 'ready', quota: usageCheck.quota});
    // Current-request occupancy comes from the CLI itself: 'summary' answers from
    // the last response's usage (input + cache read/creation) and local estimates,
    // with no token-count API calls. Reads are serialized and coalesced, never block
    // the event loop, and a failed or malformed read leaves the prior reading.
    const safe = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
    let reading: Promise<void> | undefined;
    let again = false;
    // A compaction boundary or turn end invalidates every earlier measurement:
    // replies already in flight are dropped by epoch.
    let epoch = 0;
    function refreshContext(): void {
      if (!turnActive) return;
      if (reading) {
        again = true;
        return;
      }
      reading = (async () => {
        do {
          again = false;
          const started = epoch;
          try {
            const usage = await native.getContextUsage({detail: 'summary'});
            // Before the first response apiUsage is null and the total is a bare 0:
            // that is absence of data, not an empty window.
            if (started === epoch && turnActive && usage.apiUsage && safe(usage.totalTokens)) {
              // A missing window is reported as absent, never guessed.
              const capacity = safe(usage.rawMaxTokens) && usage.rawMaxTokens > 0 ? usage.rawMaxTokens : undefined;
              emit({type: 'context', session_id: thread, tokens: usage.totalTokens,
                    ...(capacity ? {capacity} : {}),
                    ...(typeof usage.model === 'string' ? {model: usage.model} : {})});
            }
          } catch {
            // Unsupported or interrupted: the host keeps showing the last reading.
          }
        } while (again && turnActive);
      })().finally(() => { reading = undefined; });
    }
    // Activity is lifecycle only. Raw thinking, tool payloads and tool output
    // never leave this process; only a bounded one-line summary does.
    const open = new Map<string, {kind: string; extra: Record<string, unknown>}>();
    const blocks = new Map<number, string>();
    let messageId = '';
    const clip = (v: unknown, cap: number): string =>
      typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, cap) : '';
    function step(phase: 'started' | 'completed', id: string, kind: string, extra: Record<string, unknown> = {}): void {
      if (!id || id.length > 200) return;
      if (phase === 'started') {
        if (open.has(id)) return;
        open.set(id, {kind, extra});
      } else {
        // A completion restates the start summary so the stored step keeps its label.
        const started = open.get(id);
        if (!started) return;
        open.delete(id);
        extra = {...started.extra, ...extra};
      }
      emit({type: 'activity', session_id: thread, phase, id, kind, ...extra});
    }
    function closeSteps(status: string): void {
      for (const [id, started] of [...open]) step('completed', id, started.kind, {status});
      blocks.clear();
    }
    function toolStep(block: {id?: unknown; name?: unknown; input?: unknown}): void {
      const id = typeof block.id === 'string' ? block.id : '';
      const name = clip(block.name, 64);
      if (!name || name.startsWith('mcp__deck-')) return;
      if (!member) {
        const tool = /^[a-zA-Z0-9_.:-]+$/.test(name) ? name : 'Tool';
        step('started', id, name === 'Bash' ? 'command' : 'tool', {tool});
        return;
      }
      const input = (block.input && typeof block.input === 'object' ? block.input : {}) as Record<string, unknown>;
      if (name === 'Bash') {
        step('started', id, 'command', {tool: name, command: summarizeCommand(input.command)});
      } else if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') {
        step('started', id, 'file', {tool: name, path: clip(input.file_path ?? input.notebook_path, 240)});
      } else {
        // Only a plain file path may be shown; patterns, queries and URLs can hold secrets.
        const path = clip(input.file_path ?? input.path, 160);
        step('started', id, 'tool', {tool: name, summary: plainPath.test(path) && !looksSecret(path) ? path : ''});
      }
    }
    function observeActivity(event: SDKMessage): void {
      if (event.type === 'stream_event' && !event.parent_tool_use_id) {
        const e = event.event as {type: string; index?: number; message?: {id?: string};
                                  content_block?: {type?: string}};
        if (e.type === 'message_start') {
          messageId = typeof e.message?.id === 'string' ? e.message.id : '';
        } else if (e.type === 'content_block_start' && e.content_block?.type &&
            ['thinking', 'redacted_thinking'].includes(e.content_block.type) && typeof e.index === 'number') {
          const id = `thinking:${messageId || 'm'}:${e.index}`;
          blocks.set(e.index, id);
          step('started', id, 'reasoning');
        } else if (e.type === 'content_block_stop' && typeof e.index === 'number') {
          const id = blocks.get(e.index);
          blocks.delete(e.index);
          if (id) step('completed', id, 'reasoning', {status: 'completed'});
        }
      } else if (event.type === 'assistant' && !event.parent_tool_use_id) {
        const content = (event.message as {content?: unknown}).content;
        if (Array.isArray(content)) for (const block of content) {
          if (block && block.type === 'tool_use') toolStep(block);
        }
      } else if (event.type === 'user' && !event.parent_tool_use_id) {
        const content = (event.message as {content?: unknown}).content;
        if (Array.isArray(content)) for (const block of content) {
          if (block && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            const started = open.get(block.tool_use_id);
            if (started) step('completed', block.tool_use_id, started.kind, {status: block.is_error === true ? 'failed' : 'completed'});
          }
        }
      }
    }
    stdinLoop = (async () => {
      try {
        while (!closing) {
          const {value, done} = await inbox.next();
          if (done) {
            if (turnActive) {
              stopped = true;
              abortController.abort();
            } else {
              closing = true;
              closeUsers();
              native.close();
            }
            return;
          }
          const message = JSON.parse(value);
          if (message.type === 'close') {
            closing = true;
            closeUsers();
            native.close();
            return;
          }
          if (message.type === 'prepare_turn') {
            if (member || turnActive || !sessionInitialized) {
              emit({type: 'transport_error'});
              closing = true;
              closeUsers();
              native.close();
              return;
            }
            const nextUsage = await verifyUsage();
            if (!nextUsage || !(await verifyDeckInventory(nextUsage.quota))) {
              closing = true;
              closeUsers();
              native.close();
              return;
            }
            emit({type: 'ready', quota: nextUsage.quota});
            continue;
          }
          if (message.type === 'send') {
            if (turnActive || typeof message.text !== 'string') {
              stopped = true;
              abortController.abort();
              return;
            }
            if (member && (typeof message.message_id !== 'string' || !uuid.test(message.message_id))) {
              throw Error('Missing member message identity');
            }
            if (member && message.images !== undefined) throw Error('Members do not accept images');
            const content = userContent(message.text, message.images);
            const initialId = member ? message.message_id : randomUUID();
            stopped = false;
            sent = true;
            turnActive = true;
            turnInitEmitted = false;
            inputClosed = false;
            steerEvidence = false;
            limited = false;
            currentInitialId = initialId;
            steers.clear();
            open.clear();
            blocks.clear();
            messageId = '';
            pushUser({
              type: 'user',
              message: {role: 'user', content},
              parent_tool_use_id: null,
              session_id: thread,
              uuid: initialId as SDKUserMessage['uuid'],
            });
            continue;
          }
          if (message.type === 'stop') {
            stopped = true;
            if (turnActive) {
              void native.interrupt().catch(() => abortController.abort());
            } else {
              closing = true;
              closeUsers();
              native.close();
            }
            return;
          }
          if (message.type === 'steer') {
            // Members take Lead guidance as text only: never images.
            if (!turnActive || inputClosed || (member && message.images !== undefined) ||
                typeof message.id !== 'string' || !uuid.test(message.id) || typeof message.text !== 'string') {
              emit({type: 'steer_rejected', session_id: thread, id: message.id});
              continue;
            }
            if (steers.has(message.id)) {
              if (steers.get(message.id) === 'acked') emit({type: 'steer_ack', session_id: thread, id: message.id});
              continue;
            }
            let live: string | UserContent;
            try {
              live = userContent(message.text, message.images);
              if (typeof live === 'string' && !live.trim()) throw Error('Empty live message');
            } catch {
              emit({type: 'steer_rejected', session_id: thread, id: message.id});
              continue;
            }
            steers.set(message.id, 'sent');
            // 'next' folds the message into the running turn between tool rounds. It
            // neither aborts that turn nor waits for the next one.
            pushUser({
              type: 'user',
              message: {role: 'user', content: live},
              parent_tool_use_id: null,
              session_id: thread,
              uuid: message.id as `${string}-${string}-${string}-${string}-${string}`,
              priority: 'next',
            });
            continue;
          }
          if (message.type !== 'permission_reply' || typeof message.allowed !== 'boolean') {
            throw Error('Unexpected Deck reply');
          }
          pending.get(message.request)?.(
            message.allowed ? message.permit ?? null : typeof message.reason === 'string' ? {denial: message.reason} : null,
          );
        }
      } catch (error) {
        if (!closing) {
          stdinError = error;
          closing = true;
          closeUsers();
          abortController.abort();
          native.close();
        }
      }
    })();
    function ensureReusedInit() {
      if (sessionInitialized && !turnInitEmitted) {
        turnInitEmitted = true;
        emit({type: 'init', session_id: thread, model: lastInitModel});
        refreshContext();
      }
    }
    try {
      for await (const event of native) {
        const sdkReceivedMs = Date.now();
        if (!turnActive || !sent || !('session_id' in event)) continue;
        if (event.session_id !== thread) {
          if (member && (event.type === 'result' || (event.type === 'system' && event.subtype === 'init'))) {
            emit({type: 'session_mismatch'});
            return;
          }
          continue;
        }
        // The CLI names every user message a turn has consumed on its replies.
        const {user_message_uuids: consumed, user_message_uuid: primary} = event as
          {user_message_uuids?: unknown; user_message_uuid?: unknown};
        const mainThread = !('parent_tool_use_id' in event) || !event.parent_tool_use_id;
        if (event.type === 'system' && event.subtype === 'init') {
          const deckServers = event.mcp_servers.filter(candidate => candidate.name === deckServer);
          if (!sameTools(event.tools.filter(tool => tool.startsWith(deckToolPrefix)), deckTools) ||
              // The SDK can advertise its discovery helper alongside dynamic MCP tools.
              // This init check does not add it to the executable tool configuration.
              event.tools.some(tool => !tool.startsWith('mcp__') && tool !== 'ToolSearch' && !tools.includes(tool)) ||
              deckServers.length !== 1 || deckServers[0]?.status !== 'connected') {
            throw Error('Unexpected runtime capabilities');
          }
          sessionInitialized = true;
          lastInitModel = event.model;
          if (!turnInitEmitted) {
            turnInitEmitted = true;
            emit({type: 'init', session_id: thread, model: event.model});
            refreshContext();
          }
          continue;
        }
        if (sessionInitialized && !turnInitEmitted && (
            event.type === 'stream_event' || event.type === 'assistant' || event.type === 'result' ||
            (mainThread && event.type === 'user' && 'isReplay' in event && event.isReplay &&
              typeof event.uuid === 'string' && event.uuid === currentInitialId))) {
          ensureReusedInit();
        }
        if (mainThread && Array.isArray(consumed)) {
          for (const id of consumed) if (typeof id === 'string') settleSteer(id);
        }
        if (mainThread && typeof primary === 'string') settleSteer(primary);
        observeActivity(event);
        if (mainThread && event.type === 'user' && 'isReplay' in event && event.isReplay && typeof event.uuid === 'string') {
          settleSteer(event.uuid);
        } else if (event.type === 'stream_event' && !event.parent_tool_use_id &&
            event.event.type === 'content_block_delta' && event.event.delta.type === 'text_delta') {
          emit({type: 'delta', session_id: thread, text: event.event.delta.text, sdk_received_ms: sdkReceivedMs});
        } else if (event.type === 'assistant' && event.error === 'rate_limit') {
          limited = true;
        } else if (event.type === 'assistant' && !event.parent_tool_use_id) {
          refreshContext();
        } else if (event.type === 'system' && event.subtype === 'compact_boundary') {
          epoch++;
          again = false;
          emit({type: 'context_reset', session_id: thread});
        } else if (event.type === 'result') {
          // The result inventories only its own turn. An already yielded input
          // can be consumed in a subsequent native turn.
          epoch++;
          again = false;
          closeSteering();
          closeSteps(stopped ? 'cancelled' : event.subtype === 'success' && !event.is_error ? 'completed' : 'failed');
          for (const resolve of pending.values()) resolve(null);
          pending.clear();
          if (member) for (const [id, state] of steers) if (state === 'sent') {
            emit({type: 'steer_unconsumed', session_id: thread, id});
          }
          const completedCleanly = !limited && !stopped && event.subtype === 'success' && !event.is_error;
          turnActive = false;
          sent = false;
          if (completedCleanly) {
            emit({type: 'result', session_id: thread, outcome: 'completed', text: event.result});
          } else {
            emit({type: 'result', session_id: thread, outcome: stopped ? 'cancelled' : limited ? 'limited' : 'failed'});
          }
          if (member || !completedCleanly) break;
        }
      }
    } catch (error) {
      if (!closing || stdinError !== undefined) throw error;
    }
  } finally {
    closing = true;
    closeUsers();
    closeSteering();
    for (const resolve of pending.values()) resolve(null);
    pending.clear();
    input.close();
    process.stdin.pause();
    native.close();
    if (stdinLoop) await stdinLoop.catch(() => {});
  }
  if (stdinError !== undefined) throw stdinError;
}

try {
  await (operation === 'catalog' || operation === 'quota' ? accountRead() : run());
} catch {
  // SDK errors may contain native stderr, account data or command details.
  if (!abortController.signal.aborted) {
    emit({type: 'transport_error'});
    process.exitCode = 1;
  }
} finally {
  input.close();
  process.stdin.pause();
}
