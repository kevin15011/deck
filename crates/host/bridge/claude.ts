import {getSessionInfo, query, type EffortLevel, type McpHttpServerConfig, type Options, type SDKUserMessage} from '@anthropic-ai/claude-agent-sdk/core';
import {randomUUID} from 'node:crypto';
import {lstat, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {createInterface} from 'node:readline';

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

type Permit = {input?: Record<string, unknown>};

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
  settingSources: sources === 'project' ? ['project'] : [],
  settings,
  mcpServers: {},
  strictMcpConfig: true,
  extraArgs: {'disable-slash-commands': null, ...(sources === 'project' ? {} : {'safe-mode': null})},
};

const deckServer = 'deck-session';
type Bootstrap = {type: 'bootstrap'; transcriptStorage?: string; instructions: string; server: McpHttpServerConfig; toolNames: string[]; workspaceTools: string[]; autoAllowBash: boolean};

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
  const deckTools = bootstrap.toolNames.map(name => `mcp__${deckServer}__${name}`);
  let stopped = false;
  let sent = false;
  const tools = bootstrap.workspaceTools;
  const pending = new Map<string, (permit: Permit | null) => void>();
  // Live messages by uuid. The CLI de-duplicates a repeated uuid, so a repeated
  // id is acknowledged from this state and never written to the CLI twice.
  const steers = new Map<string, 'sent' | 'acked'>();
  function settleSteer(id: string) {
    if (steers.get(id) !== 'sent') return;
    steers.set(id, 'acked');
    emit({type: 'steer_ack', session_id: thread, id});
  }
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    const request = await next();
    if (request.type !== 'send' || typeof request.text !== 'string') {
      stopped = true;
      abortController.abort();
      return;
    }
    if (member && (typeof request.message_id !== 'string' || !uuid.test(request.message_id))) {
      throw Error('Missing member message identity');
    }
    if (member && request.images !== undefined) throw Error('Members do not accept images');
    const content = userContent(request.text, request.images);
    sent = true;
    yield {
      type: 'user',
      message: {role: 'user', content},
      parent_tool_use_id: null,
      session_id: thread,
      ...(member ? {uuid: request.message_id} : {}),
    };
    while (true) {
      const message = await next();
      if (message.type === 'stop') {
        stopped = true;
        void native.interrupt().catch(() => abortController.abort());
        return;
      }
      if (message.type === 'steer') {
        // Members take Lead guidance as text only: never images.
        if ((member && message.images !== undefined) || typeof message.id !== 'string' ||
            !uuid.test(message.id) || typeof message.text !== 'string') {
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
        yield {
          type: 'user',
          message: {role: 'user', content: live},
          parent_tool_use_id: null,
          session_id: thread,
          uuid: message.id as `${string}-${string}-${string}-${string}-${string}`,
          priority: 'next',
        };
        continue;
      }
      if (message.type !== 'permission_reply' || typeof message.allowed !== 'boolean') {
        throw Error('Unexpected Deck reply');
      }
      pending.get(message.request)?.(message.allowed ? message.permit ?? null : null);
    }
  }

  const native = query({
    prompt: prompt(),
    options: {
      ...options,
      ...(member ? {
        settingSources: [],
        // The replay echo is the CLI's acknowledgment of live Lead guidance.
        extraArgs: {...options.extraArgs, 'safe-mode': null, 'replay-user-messages': null},
      } : {extraArgs: {...options.extraArgs, 'replay-user-messages': null}}),
      ...(resume ? {resume: thread} : {sessionId: thread}),
      ...(model && model !== 'default' ? {model} : {}),
      ...(isEffort(effort) ? {effort} : {}),
      systemPrompt: {type: 'preset', preset: 'claude_code', append: bootstrap.instructions},
      includePartialMessages: true,
      persistSession: true,
      permissionMode: tools.length ? 'default' : 'dontAsk',
      tools,
      allowedTools: bootstrap.autoAllowBash && tools.includes('Bash') ? [...deckTools, 'Bash'] : deckTools,
      // Let Claude evaluate Bash permissions; relay requests that need a decision.
      settings: {...settings, permissions: {ask: tools.filter(tool => tool !== 'Bash')}},
      canUseTool: async (tool, input, {signal, toolUseID}) => {
        const deny = {behavior: 'deny', message: 'Deck did not authorize this tool call.'} as const;
        if (!sent || stopped || signal.aborted || !tools.includes(tool) ||
            typeof toolUseID !== 'string' || !toolUseID || toolUseID.length > 128) return deny;
        const edit = tool === 'Edit' || tool === 'Write';
        const bash = tool === 'Bash';
        if (bash && (
            (input.dangerouslyDisableSandbox !== undefined && input.dangerouslyDisableSandbox !== false) ||
            (input.run_in_background !== undefined && input.run_in_background !== false))) return deny;
        if (edit && (typeof input.file_path !== 'string' || input.file_path.length > 4096)) return deny;
        const request = randomUUID();
        const abort = new AbortController();
        const permit = await new Promise<Permit | null>(resolve => {
          pending.set(request, resolve);
          signal.addEventListener('abort', () => resolve(null), {once: true, signal: abort.signal});
          if (edit) {
            emit({type: 'workspace_write', session_id: thread, request, tool, file_path: input.file_path});
          } else {
            emit({type: bash ? 'workspace_bash' : 'permission', session_id: thread, request, tool, tool_use_id: toolUseID, input});
          }
        });
        abort.abort();
        pending.delete(request);
        if (signal.aborted && !stopped && !edit) {
          emit({type: bash ? 'workspace_bash_closed' : 'permission_closed', session_id: thread, request});
        }
        if (!permit || stopped || signal.aborted) return deny;
        return {behavior: 'allow', updatedInput: edit || bash ? input : permit.input};
      },
    },
  });
  try {
    const plan = await subscription(native);
    if (!plan) {
      emit({type: 'unqualified'});
      return;
    }
    if (model !== 'default' || effort) {
      const selected = (await models(native)).find(row => row.modelId === model);
      if (!selected || (effort && !selected.thinkingLevels.some(level => level === effort))) {
        emit({type: 'selection_unavailable'});
        return;
      }
    }
    // Read the native plan on this exact SDK process. Credits can otherwise
    // take over after the included cap. Skip transcript-derived usage stats.
    const usage = await readUsage(native);
    const quota = quotaMetadata(plan, usage);
    const credits = usage.rate_limits?.extra_usage;
    if (usage.rate_limits_available !== true || usage.subscription_type !== plan ||
        !credits || credits.is_enabled !== false) {
      emit({type: credits?.is_enabled === true ? 'credits_enabled' : 'usage_unverified', quota});
      return;
    }
    if ([usage.rate_limits?.five_hour, usage.rate_limits?.seven_day, usage.rate_limits?.seven_day_oauth_apps]
        .some(window => (window?.utilization ?? 0) >= 100)) {
      emit({type: 'plan_limit', quota});
      return;
    }
    // Register over the SDK control pipe so the per-attempt token stays out of argv.
    const registration = await native.setMcpServers({[deckServer]: bootstrap.server});
    const servers = await native.mcpServerStatus();
    const server = servers[0];
    const advertised = server?.tools?.map(tool => tool.name);
    if (!registration.added.includes(deckServer) || Object.keys(registration.errors).length ||
        servers.length !== 1 || server?.name !== deckServer || server.status !== 'connected' ||
        server.source !== 'dynamic' || !advertised ||
        advertised.length !== bootstrap.toolNames.length ||
        !bootstrap.toolNames.every(name => advertised.includes(name))) {
      emit({type: 'coordination_unavailable', quota});
      return;
    }
    emit({type: 'ready', quota});
    let limited = false;
    for await (const event of native) {
      if (!sent || !('session_id' in event)) continue;
      if (event.session_id !== thread) {
        if (member && (event.type === 'result' || (event.type === 'system' && event.subtype === 'init'))) {
          emit({type: 'session_mismatch'});
          return;
        }
        continue;
      }
      // The CLI names every user message a turn has consumed on its replies.
      const consumed = (event as {user_message_uuids?: unknown}).user_message_uuids;
      if (Array.isArray(consumed)) for (const id of consumed) if (typeof id === 'string') settleSteer(id);
      if (event.type === 'user' && 'isReplay' in event && event.isReplay && typeof event.uuid === 'string') {
        settleSteer(event.uuid);
      } else if (event.type === 'system' && event.subtype === 'init') {
        if (event.tools.some(tool => !tools.includes(tool) && !deckTools.includes(tool)) ||
            event.mcp_servers.length !== 1 || event.mcp_servers[0].name !== deckServer ||
            event.mcp_servers[0].status !== 'connected') {
          throw Error('Unexpected runtime capabilities');
        }
        emit({type: 'init', session_id: thread, model: event.model});
      } else if (event.type === 'stream_event' && !event.parent_tool_use_id &&
          event.event.type === 'content_block_delta' && event.event.delta.type === 'text_delta') {
        emit({type: 'delta', session_id: thread, text: event.event.delta.text});
      } else if (event.type === 'assistant' && event.error === 'rate_limit') {
        limited = true;
      } else if (event.type === 'result') {
        // A message the turn never took in is neither delivered nor provably lost.
        for (const [id, state] of steers) if (state === 'sent') emit({type: 'steer_unconsumed', session_id: thread, id});
        if (!limited && event.subtype === 'success' && !event.is_error) {
          emit({type: 'result', session_id: thread, outcome: 'completed', text: event.result});
        } else {
          emit({type: 'result', session_id: thread, outcome: stopped ? 'cancelled' : limited ? 'limited' : 'failed'});
        }
        break;
      }
    }
  } finally {
    for (const resolve of pending.values()) resolve(null);
    input.close();
    process.stdin.pause();
    native.close();
  }
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
