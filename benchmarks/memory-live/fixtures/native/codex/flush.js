#!/usr/bin/env node
"use strict";

// src/hooks/flush.ts
var import_node_fs8 = require("node:fs");

// src/config.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var import_node_os2 = require("node:os");

// src/services/auth.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_os = require("node:os");

// src/version.ts
var PLUGIN_VERSION = "1.0.19";

// src/services/auth.ts
var SUPERMEMORY_DIR = (0, import_node_path.join)((0, import_node_os.homedir)(), ".codex", "supermemory");
var CREDENTIALS_FILE = (0, import_node_path.join)(SUPERMEMORY_DIR, "credentials.json");
var AUTH_BASE_URL = process.env.SUPERMEMORY_AUTH_URL || "https://console.supermemory.ai/auth/connect";
var configuredAuthTimeout = Number(process.env.SUPERMEMORY_AUTH_TIMEOUT);
var AUTH_TIMEOUT = Number.isFinite(configuredAuthTimeout) && configuredAuthTimeout > 0 ? configuredAuthTimeout : 5 * 6e4;
function loadCredentialData() {
  try {
    if ((0, import_node_fs.existsSync)(CREDENTIALS_FILE)) {
      return JSON.parse((0, import_node_fs.readFileSync)(CREDENTIALS_FILE, "utf-8"));
    }
  } catch {
  }
  return null;
}
function loadCredentials() {
  const data = loadCredentialData();
  if (data?.apiKey) return data.apiKey;
  return void 0;
}

// src/config.ts
var CONFIG_FILE = (0, import_node_path2.join)((0, import_node_os2.homedir)(), ".codex", "supermemory.json");
var DEFAULT_BASE_URL = "https://api.supermemory.ai";
var DEFAULT_RECALL_DIRECTIVE = "Relevant prior context may exist in Supermemory. Search memory before answering when the request depends on previous decisions, preferences, or project history.";
var DEFAULT_SIGNAL_KEYWORDS = [
  "prefer",
  "like",
  "love",
  "use",
  "hate",
  "dislike",
  "avoid",
  "remember",
  "forget",
  "note",
  "decision",
  "decided",
  "chose",
  "choose",
  "picked",
  "switched",
  "moved",
  "migrated",
  "architecture",
  "pattern",
  "approach",
  "design",
  "tradeoff",
  "implementation",
  "refactor",
  "upgrade",
  "deprecate",
  "bug",
  "fix",
  "fixed",
  "solved",
  "solution",
  "important",
  "stack",
  "framework",
  "library",
  "tool",
  "database"
];
var DEFAULTS = {
  similarityThreshold: 0.6,
  maxMemories: 5,
  maxProfileItems: 5,
  injectProfile: true,
  containerTagPrefix: "codex",
  filterPrompt: "You are a stateful coding agent. Remember all the information, including but not limited to user's coding preferences, tech stack, behaviours, workflows, and any other relevant details.",
  debug: false,
  signalExtraction: false,
  signalKeywords: DEFAULT_SIGNAL_KEYWORDS,
  signalTurnsBefore: 3,
  autoSaveEveryTurns: 3,
  autoRecallEveryPrompt: false,
  recallMode: "direct",
  captureEveryNTurns: 0
};
function loadRawConfig() {
  if ((0, import_node_fs2.existsSync)(CONFIG_FILE)) {
    try {
      const content = (0, import_node_fs2.readFileSync)(CONFIG_FILE, "utf-8");
      return { config: JSON.parse(content), existed: true };
    } catch {
      return { config: {}, existed: true };
    }
  }
  return { config: {}, existed: false };
}
var { config: fileConfig, existed: configExisted } = loadRawConfig();
function resolveCaptureEveryNTurns(config) {
  if (config.captureEveryNTurns !== void 0) return config.captureEveryNTurns;
  if (config.autoSaveEveryTurns !== void 0) return config.autoSaveEveryTurns;
  if (configExisted) return 3;
  return DEFAULTS.captureEveryNTurns;
}
function resolveRecallMode(config) {
  if (["direct", "off", "advisory"].includes(config.recallMode ?? "")) {
    return config.recallMode;
  }
  if (config.autoRecallEveryPrompt !== void 0) {
    return config.autoRecallEveryPrompt ? "direct" : "off";
  }
  return DEFAULTS.recallMode;
}
function getApiKey() {
  if (process.env.SUPERMEMORY_CODEX_API_KEY) return process.env.SUPERMEMORY_CODEX_API_KEY;
  if (fileConfig.apiKey) return fileConfig.apiKey;
  return loadCredentials();
}
var SUPERMEMORY_API_KEY = getApiKey();
var recallMode = resolveRecallMode(fileConfig);
var CONFIG = {
  similarityThreshold: fileConfig.similarityThreshold ?? DEFAULTS.similarityThreshold,
  maxMemories: fileConfig.maxMemories ?? DEFAULTS.maxMemories,
  maxProfileItems: fileConfig.maxProfileItems ?? DEFAULTS.maxProfileItems,
  injectProfile: fileConfig.injectProfile ?? DEFAULTS.injectProfile,
  containerTagPrefix: fileConfig.containerTagPrefix ?? DEFAULTS.containerTagPrefix,
  userContainerTag: fileConfig.userContainerTag,
  projectContainerTag: fileConfig.projectContainerTag,
  filterPrompt: fileConfig.filterPrompt ?? DEFAULTS.filterPrompt,
  debug: fileConfig.debug ?? DEFAULTS.debug,
  signalExtraction: fileConfig.signalExtraction ?? DEFAULTS.signalExtraction,
  signalKeywords: fileConfig.signalKeywords ?? DEFAULTS.signalKeywords,
  signalTurnsBefore: fileConfig.signalTurnsBefore ?? DEFAULTS.signalTurnsBefore,
  autoSaveEveryTurns: fileConfig.autoSaveEveryTurns ?? DEFAULTS.autoSaveEveryTurns,
  recallMode,
  recallDirective: typeof fileConfig.recallDirective === "string" && fileConfig.recallDirective.trim() ? fileConfig.recallDirective.trim() : DEFAULT_RECALL_DIRECTIVE,
  /** @deprecated Prefer recallMode. */
  autoRecallEveryPrompt: recallMode === "direct",
  captureEveryNTurns: resolveCaptureEveryNTurns(fileConfig)
};
function isConfigured() {
  return !!SUPERMEMORY_API_KEY;
}
function getApiKeyValue() {
  return SUPERMEMORY_API_KEY;
}
function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) return null;
  const trimmed = baseUrl.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}
function getBaseUrl() {
  const configured = process.env.SUPERMEMORY_API_URL || process.env.SUPERMEMORY_BASE_URL || fileConfig.baseUrl || loadCredentialData()?.apiBaseUrl || DEFAULT_BASE_URL;
  const normalized = normalizeBaseUrl(configured);
  if (!normalized) {
    throw new Error("Invalid baseUrl: expected an absolute http(s) URL");
  }
  return normalized;
}
function getSignalConfig() {
  return {
    enabled: CONFIG.signalExtraction,
    keywords: CONFIG.signalKeywords.map((k) => k.toLowerCase()),
    turnsBefore: CONFIG.signalTurnsBefore
  };
}

// node_modules/supermemory/internal/tslib.mjs
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}

// node_modules/supermemory/internal/utils/uuid.mjs
var uuid4 = function() {
  const { crypto } = globalThis;
  if (crypto?.randomUUID) {
    uuid4 = crypto.randomUUID.bind(crypto);
    return crypto.randomUUID();
  }
  const u8 = new Uint8Array(1);
  const randomByte = crypto ? () => crypto.getRandomValues(u8)[0] : () => Math.random() * 255 & 255;
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (+c ^ randomByte() & 15 >> +c / 4).toString(16));
};

// node_modules/supermemory/internal/errors.mjs
function isAbortError(err) {
  return typeof err === "object" && err !== null && // Spec-compliant fetch implementations
  ("name" in err && err.name === "AbortError" || // Expo fetch
  "message" in err && String(err.message).includes("FetchRequestCanceledException"));
}
var castToError = (err) => {
  if (err instanceof Error)
    return err;
  if (typeof err === "object" && err !== null) {
    try {
      if (Object.prototype.toString.call(err) === "[object Error]") {
        const error = new Error(err.message, err.cause ? { cause: err.cause } : {});
        if (err.stack)
          error.stack = err.stack;
        if (err.cause && !error.cause)
          error.cause = err.cause;
        if (err.name)
          error.name = err.name;
        return error;
      }
    } catch {
    }
    try {
      return new Error(JSON.stringify(err));
    } catch {
    }
  }
  return new Error(err);
};

// node_modules/supermemory/core/error.mjs
var SupermemoryError = class extends Error {
};
var APIError = class _APIError extends SupermemoryError {
  constructor(status, error, message, headers) {
    super(`${_APIError.makeMessage(status, error, message)}`);
    this.status = status;
    this.headers = headers;
    this.error = error;
  }
  static makeMessage(status, error, message) {
    const msg = error?.message ? typeof error.message === "string" ? error.message : JSON.stringify(error.message) : error ? JSON.stringify(error) : message;
    if (status && msg) {
      return `${status} ${msg}`;
    }
    if (status) {
      return `${status} status code (no body)`;
    }
    if (msg) {
      return msg;
    }
    return "(no status code or body)";
  }
  static generate(status, errorResponse, message, headers) {
    if (!status || !headers) {
      return new APIConnectionError({ message, cause: castToError(errorResponse) });
    }
    const error = errorResponse;
    if (status === 400) {
      return new BadRequestError(status, error, message, headers);
    }
    if (status === 401) {
      return new AuthenticationError(status, error, message, headers);
    }
    if (status === 403) {
      return new PermissionDeniedError(status, error, message, headers);
    }
    if (status === 404) {
      return new NotFoundError(status, error, message, headers);
    }
    if (status === 409) {
      return new ConflictError(status, error, message, headers);
    }
    if (status === 422) {
      return new UnprocessableEntityError(status, error, message, headers);
    }
    if (status === 429) {
      return new RateLimitError(status, error, message, headers);
    }
    if (status >= 500) {
      return new InternalServerError(status, error, message, headers);
    }
    return new _APIError(status, error, message, headers);
  }
};
var APIUserAbortError = class extends APIError {
  constructor({ message } = {}) {
    super(void 0, void 0, message || "Request was aborted.", void 0);
  }
};
var APIConnectionError = class extends APIError {
  constructor({ message, cause }) {
    super(void 0, void 0, message || "Connection error.", void 0);
    if (cause)
      this.cause = cause;
  }
};
var APIConnectionTimeoutError = class extends APIConnectionError {
  constructor({ message } = {}) {
    super({ message: message ?? "Request timed out." });
  }
};
var BadRequestError = class extends APIError {
};
var AuthenticationError = class extends APIError {
};
var PermissionDeniedError = class extends APIError {
};
var NotFoundError = class extends APIError {
};
var ConflictError = class extends APIError {
};
var UnprocessableEntityError = class extends APIError {
};
var RateLimitError = class extends APIError {
};
var InternalServerError = class extends APIError {
};

// node_modules/supermemory/internal/utils/values.mjs
var startsWithSchemeRegexp = /^[a-z][a-z0-9+.-]*:/i;
var isAbsoluteURL = (url) => {
  return startsWithSchemeRegexp.test(url);
};
var isArray = (val) => (isArray = Array.isArray, isArray(val));
var isReadonlyArray = isArray;
function isEmptyObj(obj) {
  if (!obj)
    return true;
  for (const _k in obj)
    return false;
  return true;
}
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
var validatePositiveInteger = (name, n) => {
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new SupermemoryError(`${name} must be an integer`);
  }
  if (n < 0) {
    throw new SupermemoryError(`${name} must be a positive integer`);
  }
  return n;
};
var safeJSON = (text) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    return void 0;
  }
};

// node_modules/supermemory/internal/utils/sleep.mjs
var sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));

// node_modules/supermemory/version.mjs
var VERSION = "4.0.0";

// node_modules/supermemory/internal/detect-platform.mjs
function getDetectedPlatform() {
  if (typeof Deno !== "undefined" && Deno.build != null) {
    return "deno";
  }
  if (typeof EdgeRuntime !== "undefined") {
    return "edge";
  }
  if (Object.prototype.toString.call(typeof globalThis.process !== "undefined" ? globalThis.process : 0) === "[object process]") {
    return "node";
  }
  return "unknown";
}
var getPlatformProperties = () => {
  const detectedPlatform = getDetectedPlatform();
  if (detectedPlatform === "deno") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(Deno.build.os),
      "X-Stainless-Arch": normalizeArch(Deno.build.arch),
      "X-Stainless-Runtime": "deno",
      "X-Stainless-Runtime-Version": typeof Deno.version === "string" ? Deno.version : Deno.version?.deno ?? "unknown"
    };
  }
  if (typeof EdgeRuntime !== "undefined") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": `other:${EdgeRuntime}`,
      "X-Stainless-Runtime": "edge",
      "X-Stainless-Runtime-Version": globalThis.process.version
    };
  }
  if (detectedPlatform === "node") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(globalThis.process.platform ?? "unknown"),
      "X-Stainless-Arch": normalizeArch(globalThis.process.arch ?? "unknown"),
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": globalThis.process.version ?? "unknown"
    };
  }
  const browserInfo = getBrowserInfo();
  if (browserInfo) {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": "unknown",
      "X-Stainless-Runtime": `browser:${browserInfo.browser}`,
      "X-Stainless-Runtime-Version": browserInfo.version
    };
  }
  return {
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": VERSION,
    "X-Stainless-OS": "Unknown",
    "X-Stainless-Arch": "unknown",
    "X-Stainless-Runtime": "unknown",
    "X-Stainless-Runtime-Version": "unknown"
  };
};
function getBrowserInfo() {
  if (typeof navigator === "undefined" || !navigator) {
    return null;
  }
  const browserPatterns = [
    { key: "edge", pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "chrome", pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "firefox", pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "safari", pattern: /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/ }
  ];
  for (const { key, pattern } of browserPatterns) {
    const match = pattern.exec(navigator.userAgent);
    if (match) {
      const major = match[1] || 0;
      const minor = match[2] || 0;
      const patch = match[3] || 0;
      return { browser: key, version: `${major}.${minor}.${patch}` };
    }
  }
  return null;
}
var normalizeArch = (arch2) => {
  if (arch2 === "x32")
    return "x32";
  if (arch2 === "x86_64" || arch2 === "x64")
    return "x64";
  if (arch2 === "arm")
    return "arm";
  if (arch2 === "aarch64" || arch2 === "arm64")
    return "arm64";
  if (arch2)
    return `other:${arch2}`;
  return "unknown";
};
var normalizePlatform = (platform2) => {
  platform2 = platform2.toLowerCase();
  if (platform2.includes("ios"))
    return "iOS";
  if (platform2 === "android")
    return "Android";
  if (platform2 === "darwin")
    return "MacOS";
  if (platform2 === "win32")
    return "Windows";
  if (platform2 === "freebsd")
    return "FreeBSD";
  if (platform2 === "openbsd")
    return "OpenBSD";
  if (platform2 === "linux")
    return "Linux";
  if (platform2)
    return `Other:${platform2}`;
  return "Unknown";
};
var _platformHeaders;
var getPlatformHeaders = () => {
  return _platformHeaders ?? (_platformHeaders = getPlatformProperties());
};

// node_modules/supermemory/internal/shims.mjs
function getDefaultFetch() {
  if (typeof fetch !== "undefined") {
    return fetch;
  }
  throw new Error("`fetch` is not defined as a global; Either pass `fetch` to the client, `new Supermemory({ fetch })` or polyfill the global, `globalThis.fetch = fetch`");
}
function makeReadableStream(...args) {
  const ReadableStream = globalThis.ReadableStream;
  if (typeof ReadableStream === "undefined") {
    throw new Error("`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`");
  }
  return new ReadableStream(...args);
}
function ReadableStreamFrom(iterable) {
  let iter = Symbol.asyncIterator in iterable ? iterable[Symbol.asyncIterator]() : iterable[Symbol.iterator]();
  return makeReadableStream({
    start() {
    },
    async pull(controller) {
      const { done, value } = await iter.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    async cancel() {
      await iter.return?.();
    }
  });
}
async function CancelReadableStream(stream) {
  if (stream === null || typeof stream !== "object")
    return;
  if (stream[Symbol.asyncIterator]) {
    await stream[Symbol.asyncIterator]().return?.();
    return;
  }
  const reader = stream.getReader();
  const cancelPromise = reader.cancel();
  reader.releaseLock();
  await cancelPromise;
}

// node_modules/supermemory/internal/request-options.mjs
var FallbackEncoder = ({ headers, body }) => {
  return {
    bodyHeaders: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };
};

// node_modules/supermemory/internal/uploads.mjs
var checkFileSupport = () => {
  if (typeof File === "undefined") {
    const { process: process2 } = globalThis;
    const isOldNode = typeof process2?.versions?.node === "string" && parseInt(process2.versions.node.split(".")) < 20;
    throw new Error("`File` is not defined as a global, which is required for file uploads." + (isOldNode ? " Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`." : ""));
  }
};
function makeFile(fileBits, fileName, options) {
  checkFileSupport();
  return new File(fileBits, fileName ?? "unknown_file", options);
}
function getName(value) {
  return (typeof value === "object" && value !== null && ("name" in value && value.name && String(value.name) || "url" in value && value.url && String(value.url) || "filename" in value && value.filename && String(value.filename) || "path" in value && value.path && String(value.path)) || "").split(/[\\/]/).pop() || void 0;
}
var isAsyncIterable = (value) => value != null && typeof value === "object" && typeof value[Symbol.asyncIterator] === "function";
var multipartFormRequestOptions = async (opts, fetch2) => {
  return { ...opts, body: await createForm(opts.body, fetch2) };
};
var supportsFormDataMap = /* @__PURE__ */ new WeakMap();
function supportsFormData(fetchObject) {
  const fetch2 = typeof fetchObject === "function" ? fetchObject : fetchObject.fetch;
  const cached = supportsFormDataMap.get(fetch2);
  if (cached)
    return cached;
  const promise = (async () => {
    try {
      const FetchResponse = "Response" in fetch2 ? fetch2.Response : (await fetch2("data:,")).constructor;
      const data = new FormData();
      if (data.toString() === await new FetchResponse(data).text()) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  })();
  supportsFormDataMap.set(fetch2, promise);
  return promise;
}
var createForm = async (body, fetch2) => {
  if (!await supportsFormData(fetch2)) {
    throw new TypeError("The provided fetch function does not support file uploads with the current global FormData class.");
  }
  const form = new FormData();
  await Promise.all(Object.entries(body || {}).map(([key, value]) => addFormValue(form, key, value)));
  return form;
};
var isNamedBlob = (value) => value instanceof Blob && "name" in value;
var addFormValue = async (form, key, value) => {
  if (value === void 0)
    return;
  if (value == null) {
    throw new TypeError(`Received null for "${key}"; to pass null in FormData, you must use the string 'null'`);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    form.append(key, String(value));
  } else if (value instanceof Response) {
    form.append(key, makeFile([await value.blob()], getName(value)));
  } else if (isAsyncIterable(value)) {
    form.append(key, makeFile([await new Response(ReadableStreamFrom(value)).blob()], getName(value)));
  } else if (isNamedBlob(value)) {
    form.append(key, value, getName(value));
  } else if (Array.isArray(value)) {
    await Promise.all(value.map((entry) => addFormValue(form, key + "[]", entry)));
  } else if (typeof value === "object") {
    await Promise.all(Object.entries(value).map(([name, prop]) => addFormValue(form, `${key}[${name}]`, prop)));
  } else {
    throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`);
  }
};

// node_modules/supermemory/internal/to-file.mjs
var isBlobLike = (value) => value != null && typeof value === "object" && typeof value.size === "number" && typeof value.type === "string" && typeof value.text === "function" && typeof value.slice === "function" && typeof value.arrayBuffer === "function";
var isFileLike = (value) => value != null && typeof value === "object" && typeof value.name === "string" && typeof value.lastModified === "number" && isBlobLike(value);
var isResponseLike = (value) => value != null && typeof value === "object" && typeof value.url === "string" && typeof value.blob === "function";
async function toFile(value, name, options) {
  checkFileSupport();
  value = await value;
  if (isFileLike(value)) {
    if (value instanceof File) {
      return value;
    }
    return makeFile([await value.arrayBuffer()], value.name);
  }
  if (isResponseLike(value)) {
    const blob = await value.blob();
    name || (name = new URL(value.url).pathname.split(/[\\/]/).pop());
    return makeFile(await getBytes(blob), name, options);
  }
  const parts = await getBytes(value);
  name || (name = getName(value));
  if (!options?.type) {
    const type = parts.find((part) => typeof part === "object" && "type" in part && part.type);
    if (typeof type === "string") {
      options = { ...options, type };
    }
  }
  return makeFile(parts, name, options);
}
async function getBytes(value) {
  let parts = [];
  if (typeof value === "string" || ArrayBuffer.isView(value) || // includes Uint8Array, Buffer, etc.
  value instanceof ArrayBuffer) {
    parts.push(value);
  } else if (isBlobLike(value)) {
    parts.push(value instanceof Blob ? value : await value.arrayBuffer());
  } else if (isAsyncIterable(value)) {
    for await (const chunk of value) {
      parts.push(...await getBytes(chunk));
    }
  } else {
    const constructor = value?.constructor?.name;
    throw new Error(`Unexpected data type: ${typeof value}${constructor ? `; constructor: ${constructor}` : ""}${propsForError(value)}`);
  }
  return parts;
}
function propsForError(value) {
  if (typeof value !== "object" || value === null)
    return "";
  const props = Object.getOwnPropertyNames(value);
  return `; props: [${props.map((p) => `"${p}"`).join(", ")}]`;
}

// node_modules/supermemory/core/resource.mjs
var APIResource = class {
  constructor(client) {
    this._client = client;
  }
};

// node_modules/supermemory/internal/headers.mjs
var brand_privateNullableHeaders = /* @__PURE__ */ Symbol("brand.privateNullableHeaders");
function* iterateHeaders(headers) {
  if (!headers)
    return;
  if (brand_privateNullableHeaders in headers) {
    const { values, nulls } = headers;
    yield* values.entries();
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }
  let shouldClear = false;
  let iter;
  if (headers instanceof Headers) {
    iter = headers.entries();
  } else if (isReadonlyArray(headers)) {
    iter = headers;
  } else {
    shouldClear = true;
    iter = Object.entries(headers ?? {});
  }
  for (let row of iter) {
    const name = row[0];
    if (typeof name !== "string")
      throw new TypeError("expected header name to be a string");
    const values = isReadonlyArray(row[1]) ? row[1] : [row[1]];
    let didClear = false;
    for (const value of values) {
      if (value === void 0)
        continue;
      if (shouldClear && !didClear) {
        didClear = true;
        yield [name, null];
      }
      yield [name, value];
    }
  }
}
var buildHeaders = (newHeaders) => {
  const targetHeaders = new Headers();
  const nullHeaders = /* @__PURE__ */ new Set();
  for (const headers of newHeaders) {
    const seenHeaders = /* @__PURE__ */ new Set();
    for (const [name, value] of iterateHeaders(headers)) {
      const lowerName = name.toLowerCase();
      if (!seenHeaders.has(lowerName)) {
        targetHeaders.delete(name);
        seenHeaders.add(lowerName);
      }
      if (value === null) {
        targetHeaders.delete(name);
        nullHeaders.add(lowerName);
      } else {
        targetHeaders.append(name, value);
        nullHeaders.delete(lowerName);
      }
    }
  }
  return { [brand_privateNullableHeaders]: true, values: targetHeaders, nulls: nullHeaders };
};

// node_modules/supermemory/internal/utils/path.mjs
function encodeURIPath(str) {
  return str.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}
var EMPTY = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.create(null));
var createPathTagFunction = (pathEncoder = encodeURIPath) => function path2(statics, ...params) {
  if (statics.length === 1)
    return statics[0];
  let postPath = false;
  const invalidSegments = [];
  const path3 = statics.reduce((previousValue, currentValue, index) => {
    if (/[?#]/.test(currentValue)) {
      postPath = true;
    }
    const value = params[index];
    let encoded = (postPath ? encodeURIComponent : pathEncoder)("" + value);
    if (index !== params.length && (value == null || typeof value === "object" && // handle values from other realms
    value.toString === Object.getPrototypeOf(Object.getPrototypeOf(value.hasOwnProperty ?? EMPTY) ?? EMPTY)?.toString)) {
      encoded = value + "";
      invalidSegments.push({
        start: previousValue.length + currentValue.length,
        length: encoded.length,
        error: `Value of type ${Object.prototype.toString.call(value).slice(8, -1)} is not a valid path parameter`
      });
    }
    return previousValue + currentValue + (index === params.length ? "" : encoded);
  }, "");
  const pathOnly = path3.split(/[?#]/, 1)[0];
  const invalidSegmentPattern = /(?<=^|\/)(?:\.|%2e){1,2}(?=\/|$)/gi;
  let match;
  while ((match = invalidSegmentPattern.exec(pathOnly)) !== null) {
    invalidSegments.push({
      start: match.index,
      length: match[0].length,
      error: `Value "${match[0]}" can't be safely passed as a path parameter`
    });
  }
  invalidSegments.sort((a, b) => a.start - b.start);
  if (invalidSegments.length > 0) {
    let lastEnd = 0;
    const underline = invalidSegments.reduce((acc, segment) => {
      const spaces = " ".repeat(segment.start - lastEnd);
      const arrows = "^".repeat(segment.length);
      lastEnd = segment.start + segment.length;
      return acc + spaces + arrows;
    }, "");
    throw new SupermemoryError(`Path parameters result in path with invalid segments:
${invalidSegments.map((e) => e.error).join("\n")}
${path3}
${underline}`);
  }
  return path3;
};
var path = /* @__PURE__ */ createPathTagFunction(encodeURIPath);

// node_modules/supermemory/resources/connections.mjs
var Connections = class extends APIResource {
  /**
   * Initialize connection and get authorization URL
   *
   * @example
   * ```ts
   * const connection = await client.connections.create(
   *   'notion',
   * );
   * ```
   */
  create(provider, body = {}, options) {
    return this._client.post(path`/v3/connections/${provider}`, { body, ...options });
  }
  /**
   * List all connections
   *
   * @example
   * ```ts
   * const connections = await client.connections.list();
   * ```
   */
  list(body = {}, options) {
    return this._client.post("/v3/connections/list", { body, ...options });
  }
  /**
   * Configure resources for a connection (supported providers: GitHub for now)
   *
   * @example
   * ```ts
   * const response = await client.connections.configure(
   *   'connectionId',
   *   { resources: [{ foo: 'bar' }] },
   * );
   * ```
   */
  configure(connectionID, body, options) {
    return this._client.post(path`/v3/connections/${connectionID}/configure`, { body, ...options });
  }
  /**
   * Delete a specific connection by ID
   *
   * @example
   * ```ts
   * const response = await client.connections.deleteByID(
   *   'connectionId',
   * );
   * ```
   */
  deleteByID(connectionID, options) {
    return this._client.delete(path`/v3/connections/${connectionID}`, options);
  }
  /**
   * Delete connection for a specific provider and container tags
   *
   * @example
   * ```ts
   * const response = await client.connections.deleteByProvider(
   *   'notion',
   *   { containerTags: ['user_123', 'project_123'] },
   * );
   * ```
   */
  deleteByProvider(provider, body, options) {
    return this._client.delete(path`/v3/connections/${provider}`, { body, ...options });
  }
  /**
   * Get connection details with id
   *
   * @example
   * ```ts
   * const response = await client.connections.getByID(
   *   'connectionId',
   * );
   * ```
   */
  getByID(connectionID, options) {
    return this._client.get(path`/v3/connections/${connectionID}`, options);
  }
  /**
   * Get connection details with provider and container tags
   *
   * @example
   * ```ts
   * const response = await client.connections.getByTag(
   *   'notion',
   *   { containerTags: ['user_123', 'project_123'] },
   * );
   * ```
   */
  getByTag(provider, body, options) {
    return this._client.post(path`/v3/connections/${provider}/connection`, { body, ...options });
  }
  /**
   * Initiate a manual sync of connections
   *
   * @example
   * ```ts
   * const response = await client.connections.import('notion');
   * ```
   */
  import(provider, body = {}, options) {
    return this._client.post(path`/v3/connections/${provider}/import`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "text/plain" }, options?.headers])
    });
  }
  /**
   * List documents indexed for a provider and container tags
   *
   * @example
   * ```ts
   * const response = await client.connections.listDocuments(
   *   'notion',
   * );
   * ```
   */
  listDocuments(provider, body = {}, options) {
    return this._client.post(path`/v3/connections/${provider}/documents`, { body, ...options });
  }
  /**
   * Fetch resources for a connection (supported providers: GitHub for now)
   *
   * @example
   * ```ts
   * const response = await client.connections.resources(
   *   'connectionId',
   * );
   * ```
   */
  resources(connectionID, query = {}, options) {
    return this._client.get(path`/v3/connections/${connectionID}/resources`, { query, ...options });
  }
};

// node_modules/supermemory/resources/documents.mjs
var Documents = class extends APIResource {
  /**
   * Update a document with any content type (text, url, file, etc.) and metadata
   *
   * @example
   * ```ts
   * const document = await client.documents.update('id');
   * ```
   */
  update(id, body = {}, options) {
    return this._client.patch(path`/v3/documents/${id}`, { body, ...options });
  }
  /**
   * Retrieves a paginated list of documents with their metadata and workflow status
   *
   * @example
   * ```ts
   * const documents = await client.documents.list();
   * ```
   */
  list(body = {}, options) {
    return this._client.post("/v3/documents/list", { body, ...options });
  }
  /**
   * Delete a document by ID or customId
   *
   * @example
   * ```ts
   * await client.documents.delete('id');
   * ```
   */
  delete(id, options) {
    return this._client.delete(path`/v3/documents/${id}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
  /**
   * Add a document with any content type (text, url, file, etc.) and metadata
   *
   * @example
   * ```ts
   * const response = await client.documents.add({
   *   content: 'content',
   * });
   * ```
   */
  add(body, options) {
    return this._client.post("/v3/documents", { body, ...options });
  }
  /**
   * Add multiple documents in a single request. Each document can have any content
   * type (text, url, file, etc.) and metadata
   *
   * @example
   * ```ts
   * const response = await client.documents.batchAdd({
   *   documents: [
   *     {
   *       content:
   *         'This is a detailed article about machine learning concepts...',
   *     },
   *   ],
   * });
   * ```
   */
  batchAdd(body, options) {
    return this._client.post("/v3/documents/batch", { body, ...options });
  }
  /**
   * Bulk delete documents by IDs or container tags
   *
   * @example
   * ```ts
   * const response = await client.documents.deleteBulk();
   * ```
   */
  deleteBulk(body = {}, options) {
    return this._client.delete("/v3/documents/bulk", { body, ...options });
  }
  /**
   * Get a document by ID
   *
   * @example
   * ```ts
   * const document = await client.documents.get('id');
   * ```
   */
  get(id, options) {
    return this._client.get(path`/v3/documents/${id}`, options);
  }
  /**
   * Get documents that are currently being processed
   *
   * @example
   * ```ts
   * const response = await client.documents.listProcessing();
   * ```
   */
  listProcessing(options) {
    return this._client.get("/v3/documents/processing", options);
  }
  /**
   * Upload a file to be processed
   *
   * @example
   * ```ts
   * const response = await client.documents.uploadFile({
   *   file: fs.createReadStream('path/to/file'),
   * });
   * ```
   */
  uploadFile(body, options) {
    return this._client.post("/v3/documents/file", multipartFormRequestOptions({ body, ...options }, this._client));
  }
};

// node_modules/supermemory/resources/memories.mjs
var Memories = class extends APIResource {
  /**
   * Update a document with any content type (text, url, file, etc.) and metadata
   *
   * @example
   * ```ts
   * const memory = await client.memories.update('id');
   * ```
   */
  update(id, body = {}, options) {
    return this._client.patch(path`/v3/documents/${id}`, { body, ...options });
  }
  /**
   * Retrieves a paginated list of documents with their metadata and workflow status
   *
   * @example
   * ```ts
   * const memories = await client.memories.list();
   * ```
   */
  list(body = {}, options) {
    return this._client.post("/v3/documents/list", { body, ...options });
  }
  /**
   * Delete a document by ID or customId
   *
   * @example
   * ```ts
   * await client.memories.delete('id');
   * ```
   */
  delete(id, options) {
    return this._client.delete(path`/v3/documents/${id}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
  /**
   * Add a document with any content type (text, url, file, etc.) and metadata
   *
   * @example
   * ```ts
   * const response = await client.memories.add({
   *   content: 'content',
   * });
   * ```
   */
  add(body, options) {
    return this._client.post("/v3/documents", { body, ...options });
  }
  /**
   * Forget (soft delete) a memory entry. The memory is marked as forgotten but not
   * permanently deleted.
   *
   * @example
   * ```ts
   * const response = await client.memories.forget({
   *   containerTag: 'user_123',
   * });
   * ```
   */
  forget(body, options) {
    return this._client.delete("/v4/memories", { body, ...options });
  }
  /**
   * Get a document by ID
   *
   * @example
   * ```ts
   * const memory = await client.memories.get('id');
   * ```
   */
  get(id, options) {
    return this._client.get(path`/v3/documents/${id}`, options);
  }
  /**
   * Update a memory by creating a new version. The original memory is preserved with
   * isLatest=false.
   *
   * @example
   * ```ts
   * const response = await client.memories.updateMemory({
   *   containerTag: 'user_123',
   *   newContent: 'John now prefers light mode',
   * });
   * ```
   */
  updateMemory(body, options) {
    return this._client.patch("/v4/memories", { body, ...options });
  }
  /**
   * Upload a file to be processed
   *
   * @example
   * ```ts
   * const response = await client.memories.uploadFile({
   *   file: fs.createReadStream('path/to/file'),
   * });
   * ```
   */
  uploadFile(body, options) {
    return this._client.post("/v3/documents/file", multipartFormRequestOptions({ body, ...options }, this._client));
  }
};

// node_modules/supermemory/resources/search.mjs
var Search = class extends APIResource {
  /**
   * Search memories with advanced filtering
   *
   * @example
   * ```ts
   * const response = await client.search.documents({
   *   q: 'machine learning concepts',
   * });
   * ```
   */
  documents(body, options) {
    return this._client.post("/v3/search", { body, ...options });
  }
  /**
   * Search memories with advanced filtering
   *
   * @example
   * ```ts
   * const response = await client.search.execute({
   *   q: 'machine learning concepts',
   * });
   * ```
   */
  execute(body, options) {
    return this._client.post("/v3/search", { body, ...options });
  }
  /**
   * Search memory entries - Low latency for conversational
   *
   * @example
   * ```ts
   * const response = await client.search.memories({
   *   q: 'machine learning concepts',
   * });
   * ```
   */
  memories(body, options) {
    return this._client.post("/v4/search", { body, ...options });
  }
};

// node_modules/supermemory/resources/settings.mjs
var Settings = class extends APIResource {
  /**
   * Update settings for an organization
   */
  update(body = {}, options) {
    return this._client.patch("/v3/settings", { body, ...options });
  }
  /**
   * Get settings for an organization
   */
  get(options) {
    return this._client.get("/v3/settings", options);
  }
};

// node_modules/supermemory/internal/utils/log.mjs
var levelNumbers = {
  off: 0,
  error: 200,
  warn: 300,
  info: 400,
  debug: 500
};
var parseLogLevel = (maybeLevel, sourceName, client) => {
  if (!maybeLevel) {
    return void 0;
  }
  if (hasOwn(levelNumbers, maybeLevel)) {
    return maybeLevel;
  }
  loggerFor(client).warn(`${sourceName} was set to ${JSON.stringify(maybeLevel)}, expected one of ${JSON.stringify(Object.keys(levelNumbers))}`);
  return void 0;
};
function noop() {
}
function makeLogFn(fnLevel, logger, logLevel) {
  if (!logger || levelNumbers[fnLevel] > levelNumbers[logLevel]) {
    return noop;
  } else {
    return logger[fnLevel].bind(logger);
  }
}
var noopLogger = {
  error: noop,
  warn: noop,
  info: noop,
  debug: noop
};
var cachedLoggers = /* @__PURE__ */ new WeakMap();
function loggerFor(client) {
  const logger = client.logger;
  const logLevel = client.logLevel ?? "off";
  if (!logger) {
    return noopLogger;
  }
  const cachedLogger = cachedLoggers.get(logger);
  if (cachedLogger && cachedLogger[0] === logLevel) {
    return cachedLogger[1];
  }
  const levelLogger = {
    error: makeLogFn("error", logger, logLevel),
    warn: makeLogFn("warn", logger, logLevel),
    info: makeLogFn("info", logger, logLevel),
    debug: makeLogFn("debug", logger, logLevel)
  };
  cachedLoggers.set(logger, [logLevel, levelLogger]);
  return levelLogger;
}
var formatRequestDetails = (details) => {
  if (details.options) {
    details.options = { ...details.options };
    delete details.options["headers"];
  }
  if (details.headers) {
    details.headers = Object.fromEntries((details.headers instanceof Headers ? [...details.headers] : Object.entries(details.headers)).map(([name, value]) => [
      name,
      name.toLowerCase() === "authorization" || name.toLowerCase() === "cookie" || name.toLowerCase() === "set-cookie" ? "***" : value
    ]));
  }
  if ("retryOfRequestLogID" in details) {
    if (details.retryOfRequestLogID) {
      details.retryOf = details.retryOfRequestLogID;
    }
    delete details.retryOfRequestLogID;
  }
  return details;
};

// node_modules/supermemory/internal/parse.mjs
async function defaultParseResponse(client, props) {
  const { response, requestLogID, retryOfRequestLogID, startTime } = props;
  const body = await (async () => {
    if (response.status === 204) {
      return null;
    }
    if (props.options.__binaryResponse) {
      return response;
    }
    const contentType = response.headers.get("content-type");
    const mediaType = contentType?.split(";")[0]?.trim();
    const isJSON = mediaType?.includes("application/json") || mediaType?.endsWith("+json");
    if (isJSON) {
      const json = await response.json();
      return json;
    }
    const text = await response.text();
    return text;
  })();
  loggerFor(client).debug(`[${requestLogID}] response parsed`, formatRequestDetails({
    retryOfRequestLogID,
    url: response.url,
    status: response.status,
    body,
    durationMs: Date.now() - startTime
  }));
  return body;
}

// node_modules/supermemory/core/api-promise.mjs
var _APIPromise_client;
var APIPromise = class _APIPromise extends Promise {
  constructor(client, responsePromise, parseResponse = defaultParseResponse) {
    super((resolve2) => {
      resolve2(null);
    });
    this.responsePromise = responsePromise;
    this.parseResponse = parseResponse;
    _APIPromise_client.set(this, void 0);
    __classPrivateFieldSet(this, _APIPromise_client, client, "f");
  }
  _thenUnwrap(transform) {
    return new _APIPromise(__classPrivateFieldGet(this, _APIPromise_client, "f"), this.responsePromise, async (client, props) => transform(await this.parseResponse(client, props), props));
  }
  /**
   * Gets the raw `Response` instance instead of parsing the response
   * data.
   *
   * If you want to parse the response body but still get the `Response`
   * instance, you can use {@link withResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  asResponse() {
    return this.responsePromise.then((p) => p.response);
  }
  /**
   * Gets the parsed response data and the raw `Response` instance.
   *
   * If you just want to get the raw `Response` instance without parsing it,
   * you can use {@link asResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  async withResponse() {
    const [data, response] = await Promise.all([this.parse(), this.asResponse()]);
    return { data, response };
  }
  parse() {
    if (!this.parsedPromise) {
      this.parsedPromise = this.responsePromise.then((data) => this.parseResponse(__classPrivateFieldGet(this, _APIPromise_client, "f"), data));
    }
    return this.parsedPromise;
  }
  then(onfulfilled, onrejected) {
    return this.parse().then(onfulfilled, onrejected);
  }
  catch(onrejected) {
    return this.parse().catch(onrejected);
  }
  finally(onfinally) {
    return this.parse().finally(onfinally);
  }
};
_APIPromise_client = /* @__PURE__ */ new WeakMap();

// node_modules/supermemory/internal/utils/env.mjs
var readEnv = (env) => {
  if (typeof globalThis.process !== "undefined") {
    return globalThis.process.env?.[env]?.trim() ?? void 0;
  }
  if (typeof globalThis.Deno !== "undefined") {
    return globalThis.Deno.env?.get?.(env)?.trim();
  }
  return void 0;
};

// node_modules/supermemory/client.mjs
var _Supermemory_instances;
var _a;
var _Supermemory_encoder;
var _Supermemory_baseURLOverridden;
var Supermemory = class {
  /**
   * API Client for interfacing with the Supermemory API.
   *
   * @param {string | undefined} [opts.apiKey=process.env['SUPERMEMORY_API_KEY'] ?? undefined]
   * @param {string} [opts.baseURL=process.env['SUPERMEMORY_BASE_URL'] ?? https://api.supermemory.ai] - Override the default base URL for the API.
   * @param {number} [opts.timeout=1 minute] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
   * @param {MergedRequestInit} [opts.fetchOptions] - Additional `RequestInit` options to be passed to `fetch` calls.
   * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
   * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
   * @param {HeadersLike} opts.defaultHeaders - Default headers to include with every request to the API.
   * @param {Record<string, string | undefined>} opts.defaultQuery - Default query parameters to include with every request to the API.
   */
  constructor({ baseURL = readEnv("SUPERMEMORY_BASE_URL"), apiKey = readEnv("SUPERMEMORY_API_KEY"), ...opts } = {}) {
    _Supermemory_instances.add(this);
    _Supermemory_encoder.set(this, void 0);
    this.memories = new Memories(this);
    this.documents = new Documents(this);
    this.search = new Search(this);
    this.settings = new Settings(this);
    this.connections = new Connections(this);
    if (apiKey === void 0) {
      throw new SupermemoryError("The SUPERMEMORY_API_KEY environment variable is missing or empty; either provide it, or instantiate the Supermemory client with an apiKey option, like new Supermemory({ apiKey: 'My API Key' }).");
    }
    const options = {
      apiKey,
      ...opts,
      baseURL: baseURL || `https://api.supermemory.ai`
    };
    this.baseURL = options.baseURL;
    this.timeout = options.timeout ?? _a.DEFAULT_TIMEOUT;
    this.logger = options.logger ?? console;
    const defaultLogLevel = "warn";
    this.logLevel = defaultLogLevel;
    this.logLevel = parseLogLevel(options.logLevel, "ClientOptions.logLevel", this) ?? parseLogLevel(readEnv("SUPERMEMORY_LOG"), "process.env['SUPERMEMORY_LOG']", this) ?? defaultLogLevel;
    this.fetchOptions = options.fetchOptions;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetch = options.fetch ?? getDefaultFetch();
    __classPrivateFieldSet(this, _Supermemory_encoder, FallbackEncoder, "f");
    this._options = options;
    this.apiKey = apiKey;
  }
  /**
   * Create a new client instance re-using the same options given to the current client with optional overriding.
   */
  withOptions(options) {
    const client = new this.constructor({
      ...this._options,
      baseURL: this.baseURL,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
      logger: this.logger,
      logLevel: this.logLevel,
      fetch: this.fetch,
      fetchOptions: this.fetchOptions,
      apiKey: this.apiKey,
      ...options
    });
    return client;
  }
  /**
   * Add a document with any content type (text, url, file, etc.) and metadata
   */
  add(body, options) {
    return this.post("/v3/documents", { body, ...options });
  }
  /**
   * Get user profile with optional search results
   */
  profile(body, options) {
    return this.post("/v4/profile", { body, ...options });
  }
  defaultQuery() {
    return this._options.defaultQuery;
  }
  validateHeaders({ values, nulls }) {
    return;
  }
  async authHeaders(opts) {
    return buildHeaders([{ Authorization: `Bearer ${this.apiKey}` }]);
  }
  /**
   * Basic re-implementation of `qs.stringify` for primitive types.
   */
  stringifyQuery(query) {
    return Object.entries(query).filter(([_, value]) => typeof value !== "undefined").map(([key, value]) => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      }
      if (value === null) {
        return `${encodeURIComponent(key)}=`;
      }
      throw new SupermemoryError(`Cannot stringify type ${typeof value}; Expected string, number, boolean, or null. If you need to pass nested query parameters, you can manually encode them, e.g. { query: { 'foo[key1]': value1, 'foo[key2]': value2 } }, and please open a GitHub issue requesting better support for your use case.`);
    }).join("&");
  }
  getUserAgent() {
    return `${this.constructor.name}/JS ${VERSION}`;
  }
  defaultIdempotencyKey() {
    return `stainless-node-retry-${uuid4()}`;
  }
  makeStatusError(status, error, message, headers) {
    return APIError.generate(status, error, message, headers);
  }
  buildURL(path2, query, defaultBaseURL) {
    const baseURL = !__classPrivateFieldGet(this, _Supermemory_instances, "m", _Supermemory_baseURLOverridden).call(this) && defaultBaseURL || this.baseURL;
    const url = isAbsoluteURL(path2) ? new URL(path2) : new URL(baseURL + (baseURL.endsWith("/") && path2.startsWith("/") ? path2.slice(1) : path2));
    const defaultQuery = this.defaultQuery();
    if (!isEmptyObj(defaultQuery)) {
      query = { ...defaultQuery, ...query };
    }
    if (typeof query === "object" && query && !Array.isArray(query)) {
      url.search = this.stringifyQuery(query);
    }
    return url.toString();
  }
  /**
   * Used as a callback for mutating the given `FinalRequestOptions` object.
   */
  async prepareOptions(options) {
  }
  /**
   * Used as a callback for mutating the given `RequestInit` object.
   *
   * This is useful for cases where you want to add certain headers based off of
   * the request properties, e.g. `method` or `url`.
   */
  async prepareRequest(request, { url, options }) {
  }
  get(path2, opts) {
    return this.methodRequest("get", path2, opts);
  }
  post(path2, opts) {
    return this.methodRequest("post", path2, opts);
  }
  patch(path2, opts) {
    return this.methodRequest("patch", path2, opts);
  }
  put(path2, opts) {
    return this.methodRequest("put", path2, opts);
  }
  delete(path2, opts) {
    return this.methodRequest("delete", path2, opts);
  }
  methodRequest(method, path2, opts) {
    return this.request(Promise.resolve(opts).then((opts2) => {
      return { method, path: path2, ...opts2 };
    }));
  }
  request(options, remainingRetries = null) {
    return new APIPromise(this, this.makeRequest(options, remainingRetries, void 0));
  }
  async makeRequest(optionsInput, retriesRemaining, retryOfRequestLogID) {
    const options = await optionsInput;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    if (retriesRemaining == null) {
      retriesRemaining = maxRetries;
    }
    await this.prepareOptions(options);
    const { req, url, timeout } = await this.buildRequest(options, {
      retryCount: maxRetries - retriesRemaining
    });
    await this.prepareRequest(req, { url, options });
    const requestLogID = "log_" + (Math.random() * (1 << 24) | 0).toString(16).padStart(6, "0");
    const retryLogStr = retryOfRequestLogID === void 0 ? "" : `, retryOf: ${retryOfRequestLogID}`;
    const startTime = Date.now();
    loggerFor(this).debug(`[${requestLogID}] sending request`, formatRequestDetails({
      retryOfRequestLogID,
      method: options.method,
      url,
      options,
      headers: req.headers
    }));
    if (options.signal?.aborted) {
      throw new APIUserAbortError();
    }
    const controller = new AbortController();
    const response = await this.fetchWithTimeout(url, req, timeout, controller).catch(castToError);
    const headersTime = Date.now();
    if (response instanceof globalThis.Error) {
      const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
      if (options.signal?.aborted) {
        throw new APIUserAbortError();
      }
      const isTimeout = isAbortError(response) || /timed? ?out/i.test(String(response) + ("cause" in response ? String(response.cause) : ""));
      if (retriesRemaining) {
        loggerFor(this).info(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} - ${retryMessage}`);
        loggerFor(this).debug(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} (${retryMessage})`, formatRequestDetails({
          retryOfRequestLogID,
          url,
          durationMs: headersTime - startTime,
          message: response.message
        }));
        return this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? requestLogID);
      }
      loggerFor(this).info(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} - error; no more retries left`);
      loggerFor(this).debug(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} (error; no more retries left)`, formatRequestDetails({
        retryOfRequestLogID,
        url,
        durationMs: headersTime - startTime,
        message: response.message
      }));
      if (isTimeout) {
        throw new APIConnectionTimeoutError();
      }
      throw new APIConnectionError({ cause: response });
    }
    const responseInfo = `[${requestLogID}${retryLogStr}] ${req.method} ${url} ${response.ok ? "succeeded" : "failed"} with status ${response.status} in ${headersTime - startTime}ms`;
    if (!response.ok) {
      const shouldRetry = await this.shouldRetry(response);
      if (retriesRemaining && shouldRetry) {
        const retryMessage2 = `retrying, ${retriesRemaining} attempts remaining`;
        await CancelReadableStream(response.body);
        loggerFor(this).info(`${responseInfo} - ${retryMessage2}`);
        loggerFor(this).debug(`[${requestLogID}] response error (${retryMessage2})`, formatRequestDetails({
          retryOfRequestLogID,
          url: response.url,
          status: response.status,
          headers: response.headers,
          durationMs: headersTime - startTime
        }));
        return this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? requestLogID, response.headers);
      }
      const retryMessage = shouldRetry ? `error; no more retries left` : `error; not retryable`;
      loggerFor(this).info(`${responseInfo} - ${retryMessage}`);
      const errText = await response.text().catch((err2) => castToError(err2).message);
      const errJSON = safeJSON(errText);
      const errMessage = errJSON ? void 0 : errText;
      loggerFor(this).debug(`[${requestLogID}] response error (${retryMessage})`, formatRequestDetails({
        retryOfRequestLogID,
        url: response.url,
        status: response.status,
        headers: response.headers,
        message: errMessage,
        durationMs: Date.now() - startTime
      }));
      const err = this.makeStatusError(response.status, errJSON, errMessage, response.headers);
      throw err;
    }
    loggerFor(this).info(responseInfo);
    loggerFor(this).debug(`[${requestLogID}] response start`, formatRequestDetails({
      retryOfRequestLogID,
      url: response.url,
      status: response.status,
      headers: response.headers,
      durationMs: headersTime - startTime
    }));
    return { response, options, controller, requestLogID, retryOfRequestLogID, startTime };
  }
  async fetchWithTimeout(url, init, ms, controller) {
    const { signal, method, ...options } = init || {};
    if (signal)
      signal.addEventListener("abort", () => controller.abort());
    const timeout = setTimeout(() => controller.abort(), ms);
    const isReadableBody = globalThis.ReadableStream && options.body instanceof globalThis.ReadableStream || typeof options.body === "object" && options.body !== null && Symbol.asyncIterator in options.body;
    const fetchOptions = {
      signal: controller.signal,
      ...isReadableBody ? { duplex: "half" } : {},
      method: "GET",
      ...options
    };
    if (method) {
      fetchOptions.method = method.toUpperCase();
    }
    try {
      return await this.fetch.call(void 0, url, fetchOptions);
    } finally {
      clearTimeout(timeout);
    }
  }
  async shouldRetry(response) {
    const shouldRetryHeader = response.headers.get("x-should-retry");
    if (shouldRetryHeader === "true")
      return true;
    if (shouldRetryHeader === "false")
      return false;
    if (response.status === 408)
      return true;
    if (response.status === 409)
      return true;
    if (response.status === 429)
      return true;
    if (response.status >= 500)
      return true;
    return false;
  }
  async retryRequest(options, retriesRemaining, requestLogID, responseHeaders) {
    let timeoutMillis;
    const retryAfterMillisHeader = responseHeaders?.get("retry-after-ms");
    if (retryAfterMillisHeader) {
      const timeoutMs = parseFloat(retryAfterMillisHeader);
      if (!Number.isNaN(timeoutMs)) {
        timeoutMillis = timeoutMs;
      }
    }
    const retryAfterHeader = responseHeaders?.get("retry-after");
    if (retryAfterHeader && !timeoutMillis) {
      const timeoutSeconds = parseFloat(retryAfterHeader);
      if (!Number.isNaN(timeoutSeconds)) {
        timeoutMillis = timeoutSeconds * 1e3;
      } else {
        timeoutMillis = Date.parse(retryAfterHeader) - Date.now();
      }
    }
    if (!(timeoutMillis && 0 <= timeoutMillis && timeoutMillis < 60 * 1e3)) {
      const maxRetries = options.maxRetries ?? this.maxRetries;
      timeoutMillis = this.calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries);
    }
    await sleep(timeoutMillis);
    return this.makeRequest(options, retriesRemaining - 1, requestLogID);
  }
  calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries) {
    const initialRetryDelay = 0.5;
    const maxRetryDelay = 8;
    const numRetries = maxRetries - retriesRemaining;
    const sleepSeconds = Math.min(initialRetryDelay * Math.pow(2, numRetries), maxRetryDelay);
    const jitter = 1 - Math.random() * 0.25;
    return sleepSeconds * jitter * 1e3;
  }
  async buildRequest(inputOptions, { retryCount = 0 } = {}) {
    const options = { ...inputOptions };
    const { method, path: path2, query, defaultBaseURL } = options;
    const url = this.buildURL(path2, query, defaultBaseURL);
    if ("timeout" in options)
      validatePositiveInteger("timeout", options.timeout);
    options.timeout = options.timeout ?? this.timeout;
    const { bodyHeaders, body } = this.buildBody({ options });
    const reqHeaders = await this.buildHeaders({ options: inputOptions, method, bodyHeaders, retryCount });
    const req = {
      method,
      headers: reqHeaders,
      ...options.signal && { signal: options.signal },
      ...globalThis.ReadableStream && body instanceof globalThis.ReadableStream && { duplex: "half" },
      ...body && { body },
      ...this.fetchOptions ?? {},
      ...options.fetchOptions ?? {}
    };
    return { req, url, timeout: options.timeout };
  }
  async buildHeaders({ options, method, bodyHeaders, retryCount }) {
    let idempotencyHeaders = {};
    if (this.idempotencyHeader && method !== "get") {
      if (!options.idempotencyKey)
        options.idempotencyKey = this.defaultIdempotencyKey();
      idempotencyHeaders[this.idempotencyHeader] = options.idempotencyKey;
    }
    const headers = buildHeaders([
      idempotencyHeaders,
      {
        Accept: "application/json",
        "User-Agent": this.getUserAgent(),
        "X-Stainless-Retry-Count": String(retryCount),
        ...options.timeout ? { "X-Stainless-Timeout": String(Math.trunc(options.timeout / 1e3)) } : {},
        ...getPlatformHeaders()
      },
      await this.authHeaders(options),
      this._options.defaultHeaders,
      bodyHeaders,
      options.headers
    ]);
    this.validateHeaders(headers);
    return headers.values;
  }
  buildBody({ options: { body, headers: rawHeaders } }) {
    if (!body) {
      return { bodyHeaders: void 0, body: void 0 };
    }
    const headers = buildHeaders([rawHeaders]);
    if (
      // Pass raw type verbatim
      ArrayBuffer.isView(body) || body instanceof ArrayBuffer || body instanceof DataView || typeof body === "string" && // Preserve legacy string encoding behavior for now
      headers.values.has("content-type") || // `Blob` is superset of `File`
      globalThis.Blob && body instanceof globalThis.Blob || // `FormData` -> `multipart/form-data`
      body instanceof FormData || // `URLSearchParams` -> `application/x-www-form-urlencoded`
      body instanceof URLSearchParams || // Send chunked stream (each chunk has own `length`)
      globalThis.ReadableStream && body instanceof globalThis.ReadableStream
    ) {
      return { bodyHeaders: void 0, body };
    } else if (typeof body === "object" && (Symbol.asyncIterator in body || Symbol.iterator in body && "next" in body && typeof body.next === "function")) {
      return { bodyHeaders: void 0, body: ReadableStreamFrom(body) };
    } else {
      return __classPrivateFieldGet(this, _Supermemory_encoder, "f").call(this, { body, headers });
    }
  }
};
_a = Supermemory, _Supermemory_encoder = /* @__PURE__ */ new WeakMap(), _Supermemory_instances = /* @__PURE__ */ new WeakSet(), _Supermemory_baseURLOverridden = function _Supermemory_baseURLOverridden2() {
  return this.baseURL !== "https://api.supermemory.ai";
};
Supermemory.Supermemory = _a;
Supermemory.DEFAULT_TIMEOUT = 6e4;
Supermemory.SupermemoryError = SupermemoryError;
Supermemory.APIError = APIError;
Supermemory.APIConnectionError = APIConnectionError;
Supermemory.APIConnectionTimeoutError = APIConnectionTimeoutError;
Supermemory.APIUserAbortError = APIUserAbortError;
Supermemory.NotFoundError = NotFoundError;
Supermemory.ConflictError = ConflictError;
Supermemory.RateLimitError = RateLimitError;
Supermemory.BadRequestError = BadRequestError;
Supermemory.AuthenticationError = AuthenticationError;
Supermemory.InternalServerError = InternalServerError;
Supermemory.PermissionDeniedError = PermissionDeniedError;
Supermemory.UnprocessableEntityError = UnprocessableEntityError;
Supermemory.toFile = toFile;
Supermemory.Memories = Memories;
Supermemory.Documents = Documents;
Supermemory.Search = Search;
Supermemory.Settings = Settings;
Supermemory.Connections = Connections;

// src/services/logger.ts
var import_node_fs3 = require("node:fs");
var import_node_os3 = require("node:os");
var import_node_path3 = require("node:path");
var LOG_FILE = (0, import_node_path3.join)((0, import_node_os3.homedir)(), ".codex-supermemory.log");
var sessionStarted = false;
function ensureSessionStarted() {
  if (!sessionStarted) {
    sessionStarted = true;
    try {
      (0, import_node_fs3.appendFileSync)(
        LOG_FILE,
        `
--- Session started: ${(/* @__PURE__ */ new Date()).toISOString()} ---
`
      );
    } catch {
    }
  }
}
function log(message, data) {
  if (!CONFIG.debug && !process.env.SUPERMEMORY_DEBUG) return;
  ensureSessionStarted();
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const line = data ? `[${timestamp}] ${message}: ${JSON.stringify(data)}
` : `[${timestamp}] ${message}
`;
  try {
    (0, import_node_fs3.appendFileSync)(LOG_FILE, line);
  } catch {
  }
}

// src/services/resultText.ts
var RECALL_MIN_SIMILARITY = 0.55;
var RECALL_MAX_RESULTS = 5;
function memoryText(result) {
  for (const value of [
    result.memory,
    result.chunk,
    result.content,
    result.text,
    result.context
  ]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
function stringValue(...values) {
  const value = values.find(
    (candidate) => typeof candidate === "string" && candidate.trim().length > 0
  );
  return typeof value === "string" ? value.trim() : void 0;
}
function recallProvenance(result) {
  const metadata = result.metadata && typeof result.metadata === "object" ? result.metadata : {};
  return {
    title: stringValue(result.title, metadata.title),
    filepath: stringValue(
      result.filepath,
      result.filePath,
      result.path,
      metadata.filepath,
      metadata.filePath,
      metadata.path
    )
  };
}

// src/services/resultMerge.ts
function normalize(value) {
  return String(value ?? "").toLowerCase().trim();
}
function dedupe(items, getKey) {
  const seen = /* @__PURE__ */ new Set();
  return items.filter((item) => {
    const key = normalize(getKey(item));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function searchKey(result) {
  const content = normalize(memoryText(result));
  if (content) return `content:${content}`;
  return result.id ? `id:${result.id}` : "";
}
function score(result) {
  if (Number.isFinite(result.similarity)) return result.similarity;
  if (Number.isFinite(result.score)) return result.score;
  return -1;
}
function passesRecallThreshold(result) {
  const relevance = Number.isFinite(result.similarity) ? result.similarity : Number.isFinite(result.score) ? result.score : null;
  return relevance === null || relevance >= RECALL_MIN_SIMILARITY;
}
function mergeSearchResponses(responses, limit) {
  const successful = responses.filter((response) => response.success);
  if (successful.length === 0) {
    return {
      success: false,
      error: responses.find((response) => response.error)?.error || "All container searches failed",
      results: [],
      total: 0,
      timing: 0
    };
  }
  const results = successful.flatMap((response) => response.results ?? []).sort((a, b) => {
    const scoreDiff = score(b) - score(a);
    if (scoreDiff !== 0) return scoreDiff;
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return bTime - aTime;
  });
  const merged = dedupe(results, searchKey).slice(0, limit);
  return {
    success: true,
    results: merged,
    total: merged.length,
    timing: Math.max(0, ...successful.map((response) => response.timing ?? 0))
  };
}
function mergeProfileResults(responses, limit) {
  const successful = responses.filter((response) => response.success && response.profile);
  if (successful.length === 0) {
    return {
      success: false,
      error: responses.find((response) => response.error)?.error || "All profile requests failed",
      profile: null
    };
  }
  const staticFacts = dedupe(
    successful.flatMap((response) => response.profile?.static ?? []),
    (fact) => fact
  );
  const staticKeys = new Set(staticFacts.map(normalize));
  const dynamicFacts = dedupe(
    successful.flatMap((response) => response.profile?.dynamic ?? []),
    (fact) => fact
  ).filter((fact) => !staticKeys.has(normalize(fact)));
  const mergedSearch = mergeSearchResponses(
    successful.map((response) => ({
      success: true,
      results: (response.searchResults?.results ?? []).filter(
        (result) => passesRecallThreshold(result) && memoryText(result).length > 0
      ),
      total: response.searchResults?.total ?? 0,
      timing: response.searchResults?.timing
    })),
    Math.min(limit, RECALL_MAX_RESULTS)
  );
  return {
    success: true,
    profile: { static: staticFacts, dynamic: dynamicFacts },
    searchResults: mergedSearch.results && mergedSearch.results.length > 0 ? {
      results: mergedSearch.results.map((result) => {
        const provenance = recallProvenance(result);
        return {
          id: result.id,
          memory: memoryText(result),
          score: result.score,
          similarity: result.similarity,
          title: provenance.title,
          filepath: provenance.filepath,
          updatedAt: result.updatedAt
        };
      }),
      total: mergedSearch.total ?? mergedSearch.results.length,
      timing: mergedSearch.timing
    } : void 0
  };
}

// src/services/client.ts
var TIMEOUT_MS = 3e4;
var HOOK_API_TIMEOUT_MS = 3e3;
var SPACE_NAME_TIMEOUT_MS = 5e3;
var CODEX_SOURCE = "codex";
function getScopeFilters(scope) {
  return {
    AND: [{ key: "sm_scope", value: scope, filterType: "metadata" }]
  };
}
function supportsScopedCanonicalTag(containerTag) {
  return /^repo_.+__[0-9a-f]{16}$/i.test(containerTag);
}
function withTimeout(promise, ms) {
  let id;
  const timeout = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}
function withBoundedSdkRequest(request, timeoutMs) {
  const controller = new AbortController();
  let timeout;
  const backstop = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const requestPromise = Promise.resolve().then(() => request(controller.signal));
  return Promise.race([requestPromise, backstop]).finally(() => {
    clearTimeout(timeout);
  });
}
var AGENT_ENTITY_CONTEXT = `Shared coding-agent memory for one software repository. Extract what a human teammate would remember and use later, not a replay of the current terminal state.

RULES:
- Prefer decisions, constraints, preferences, and lessons that remain useful after the current task
- Preserve durable context that helps Claude Code, Codex, OpenCode, or Cursor continue the work
- Condense assistant responses into decisions, outcomes, and reusable knowledge
- Keep user preferences and project facts concise and independently understandable

EXTRACT:
- User preferences, accepted decisions, durable workflows, actions, and learnings
- Architecture: "uses monorepo with turborepo", "API in /apps/api"
- Conventions: "components in PascalCase", "hooks prefixed with use"
- Patterns: "all API routes use withAuth wrapper", "errors thrown as ApiError"
- Setup: "requires .env with DATABASE_URL", "run pnpm db:migrate first"
- Decisions: "chose Drizzle over Prisma for performance", "using RSC for data fetching"

SKIP:
- Generic assistant suggestions the user did not accept
- Transient command output and low-value implementation chatter
- Transient Git state already tracked by the repository: current branch or HEAD, uncommitted file lists, diffs, commit/push status, and in-flight worktree state
- Granular details that do not help future work`;
var USER_ENTITY_CONTEXT = AGENT_ENTITY_CONTEXT;
var SupermemoryClient = class {
  client = null;
  getClient() {
    if (!this.client) {
      if (!isConfigured()) {
        throw new Error("SUPERMEMORY_API_KEY not set");
      }
      this.client = new Supermemory({
        apiKey: getApiKeyValue(),
        baseURL: getBaseUrl(),
        defaultHeaders: { "x-sm-source": CODEX_SOURCE }
      });
    }
    return this.client;
  }
  /**
   * Get a profile with embedded search results from one container. A scope is
   * optional because default recall searches the unified project container.
   */
  async getProfileWithSearch(containerTag, query, scope, requestOptions) {
    log("getProfileWithSearch: start", { containerTag, hasQuery: !!query });
    try {
      const profileParams = {
        containerTag,
        q: query,
        filters: scope ? getScopeFilters(scope) : void 0
      };
      const result = requestOptions ? await withBoundedSdkRequest(
        (signal) => this.getClient().profile(profileParams, {
          timeout: requestOptions.timeoutMs,
          maxRetries: 0,
          signal
        }),
        requestOptions.timeoutMs
      ) : await withTimeout(this.getClient().profile(profileParams), TIMEOUT_MS);
      const seen = /* @__PURE__ */ new Set();
      const dedupeWithSeen = (items, getKey = (x) => String(x)) => items.filter((item) => {
        const key = getKey(item).toLowerCase().trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const staticFacts = dedupeWithSeen(result.profile?.static || [], (x) => x);
      const dynamicFacts = dedupeWithSeen(result.profile?.dynamic || [], (x) => x);
      let searchResults;
      if (result.searchResults) {
        const mapped = result.searchResults.results.map((r) => {
          const provenance = recallProvenance(r);
          return {
            id: r.id,
            memory: memoryText(r),
            score: r.score,
            similarity: r.similarity,
            title: provenance.title,
            filepath: provenance.filepath,
            metadata: r.metadata,
            updatedAt: r.updatedAt
          };
        }).filter((r) => r.memory.length > 0);
        searchResults = {
          results: dedupeWithSeen(mapped, (r) => r.memory),
          total: result.searchResults.total,
          timing: result.searchResults.timing
        };
      }
      log("getProfileWithSearch: success", {
        staticCount: staticFacts.length,
        dynamicCount: dynamicFacts.length,
        searchCount: searchResults?.results.length || 0
      });
      return {
        success: true,
        profile: { static: staticFacts, dynamic: dynamicFacts },
        searchResults
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("getProfileWithSearch: error", { error: errorMessage });
      return { success: false, error: errorMessage, profile: null };
    }
  }
  async getProfileWithSearchMany(containerTags, query, requestOptions) {
    const uniqueTags2 = [...new Set(containerTags.filter(Boolean))];
    const results = await Promise.all(
      uniqueTags2.map(
        (containerTag) => this.getProfileWithSearch(containerTag, query, void 0, requestOptions)
      )
    );
    return mergeProfileResults(results, CONFIG.maxMemories);
  }
  async getProfileWithSearchScoped(canonicalTag, containerTags, scope, query) {
    const legacyTags = [...new Set(
      containerTags.filter((tag) => tag && tag !== canonicalTag)
    )];
    const results = await Promise.all([
      this.getProfileWithSearch(
        canonicalTag,
        query,
        supportsScopedCanonicalTag(canonicalTag) ? scope : void 0
      ),
      ...legacyTags.map(
        (containerTag) => this.getProfileWithSearch(containerTag, query)
      )
    ]);
    return mergeProfileResults(results, CONFIG.maxMemories);
  }
  // Keep old methods for backward compatibility
  async searchMemories(query, containerTag, scope) {
    log("searchMemories: start", { containerTag });
    try {
      const result = await withTimeout(
        this.getClient().search.memories({
          q: query,
          containerTag,
          threshold: CONFIG.similarityThreshold,
          limit: CONFIG.maxMemories,
          searchMode: "hybrid",
          filters: scope ? getScopeFilters(scope) : void 0
        }),
        TIMEOUT_MS
      );
      log("searchMemories: success", { count: result.results?.length || 0 });
      const results = result.results.map((item) => ({
        ...item,
        containerTag
      }));
      return { success: true, results, total: result.total, timing: result.timing };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("searchMemories: error", { error: errorMessage });
      return { success: false, error: errorMessage, results: [], total: 0, timing: 0 };
    }
  }
  async searchMemoriesMany(query, containerTags) {
    const uniqueTags2 = [...new Set(containerTags.filter(Boolean))];
    const results = await Promise.all(
      uniqueTags2.map((containerTag) => this.searchMemories(query, containerTag))
    );
    return mergeSearchResponses(results, CONFIG.maxMemories);
  }
  async searchMemoriesScoped(query, canonicalTag, containerTags, scope) {
    const legacyTags = [...new Set(
      containerTags.filter((tag) => tag && tag !== canonicalTag)
    )];
    const results = await Promise.all([
      this.searchMemories(
        query,
        canonicalTag,
        supportsScopedCanonicalTag(canonicalTag) ? scope : void 0
      ),
      ...legacyTags.map(
        (containerTag) => this.searchMemories(query, containerTag)
      )
    ]);
    return mergeSearchResponses(results, CONFIG.maxMemories);
  }
  async getProfile(containerTag, query, scope) {
    log("getProfile: start", { containerTag });
    try {
      const result = await withTimeout(
        this.getClient().profile({
          containerTag,
          q: query,
          filters: scope ? getScopeFilters(scope) : void 0
        }),
        TIMEOUT_MS
      );
      log("getProfile: success", { hasProfile: !!result?.profile });
      return { success: true, ...result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("getProfile: error", { error: errorMessage });
      return { success: false, error: errorMessage, profile: null };
    }
  }
  async getProfileMany(containerTags, query, requestOptions) {
    return this.getProfileWithSearchMany(containerTags, query, requestOptions);
  }
  async getProfileScopedMany(canonicalTag, containerTags, scope, query) {
    return this.getProfileWithSearchScoped(
      canonicalTag,
      containerTags,
      scope,
      query
    );
  }
  async addMemory(content, containerTag, metadata, options) {
    log("addMemory: start", {
      containerTag,
      contentLength: content.length,
      customId: options?.customId,
      hasEntityContext: !!options?.entityContext
    });
    try {
      const mergedMetadata = {
        sm_source: CODEX_SOURCE,
        sm_client: CODEX_SOURCE,
        sm_plugin_version: PLUGIN_VERSION,
        ...metadata ?? {}
      };
      const payload = {
        content,
        containerTag,
        metadata: mergedMetadata
      };
      if (options?.customId) {
        payload.customId = options.customId;
      }
      if (options?.entityContext) {
        payload.entityContext = options.entityContext;
      }
      const result = options?.timeoutMs ? await withBoundedSdkRequest(
        (signal) => this.getClient().memories.add(payload, {
          timeout: options.timeoutMs,
          maxRetries: 0,
          signal
        }),
        options.timeoutMs
      ) : await withTimeout(this.getClient().memories.add(payload), TIMEOUT_MS);
      log("addMemory: success", { id: result.id });
      return { success: true, ...result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("addMemory: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }
  async updateContainerTagName(containerTag, name) {
    log("updateContainerTagName: start", { containerTag, name });
    try {
      const baseUrl = getBaseUrl();
      const currentResponse = await withTimeout(
        fetch(`${baseUrl}/v3/container-tags/${encodeURIComponent(containerTag)}`, {
          headers: {
            Authorization: `Bearer ${getApiKeyValue()}`
          }
        }),
        SPACE_NAME_TIMEOUT_MS
      );
      if (!currentResponse.ok) {
        log("updateContainerTagName: skipped", {
          containerTag,
          status: currentResponse.status
        });
        return { success: false, error: `HTTP ${currentResponse.status}` };
      }
      const current = await currentResponse.json();
      const currentName = current.name?.trim();
      if (currentName && currentName !== `Space ${containerTag}` && !currentName.startsWith("Codex \xB7 ") && !currentName.startsWith("Agents \xB7 ")) {
        log("updateContainerTagName: kept custom name", { containerTag, currentName });
        return { success: true };
      }
      if (currentName === name) {
        return { success: true };
      }
      const response = await withTimeout(
        fetch(`${baseUrl}/v3/container-tags/${encodeURIComponent(containerTag)}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${getApiKeyValue()}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ name })
        }),
        SPACE_NAME_TIMEOUT_MS
      );
      if (!response.ok) {
        log("updateContainerTagName: skipped", {
          containerTag,
          status: response.status
        });
        return { success: false, error: `HTTP ${response.status}` };
      }
      log("updateContainerTagName: success", { containerTag, name });
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("updateContainerTagName: error", { containerTag, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }
  async forgetMemory(content, containerTag) {
    log("forgetMemory: start", { containerTag, contentLength: content.length });
    try {
      const result = await withTimeout(
        this.getClient().memories.forget({ containerTag, content }),
        TIMEOUT_MS
      );
      log("forgetMemory: success", { id: result.id });
      return { success: true, message: "Memory forgotten", id: result.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("forgetMemory: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }
};

// src/services/tags.ts
var import_node_crypto = require("node:crypto");
var import_node_child_process = require("node:child_process");
var import_node_fs4 = require("node:fs");
var import_node_os4 = require("node:os");
var import_node_path4 = require("node:path");
function sha256(input) {
  return (0, import_node_crypto.createHash)("sha256").update(input).digest("hex").slice(0, 16);
}
var repoInfoCache = /* @__PURE__ */ new Map();
function getGitRoot(directory) {
  const isolateWorktrees = process.env.SUPERMEMORY_ISOLATE_WORKTREES === "true";
  try {
    if (isolateWorktrees) {
      const gitRoot2 = (0, import_node_child_process.execSync)("git rev-parse --show-toplevel", {
        cwd: directory,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      return gitRoot2 || null;
    }
    const gitCommonDir = (0, import_node_child_process.execSync)("git rev-parse --git-common-dir", {
      cwd: directory,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    if (gitCommonDir === ".git") {
      const gitRoot2 = (0, import_node_child_process.execSync)("git rev-parse --show-toplevel", {
        cwd: directory,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      return gitRoot2 || null;
    }
    const resolved = (0, import_node_path4.resolve)(directory, gitCommonDir);
    if ((0, import_node_path4.basename)(resolved) === ".git" && !resolved.includes(`${import_node_path4.sep}.git${import_node_path4.sep}`)) {
      return (0, import_node_path4.dirname)(resolved);
    }
    const gitRoot = (0, import_node_child_process.execSync)("git rev-parse --show-toplevel", {
      cwd: directory,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return gitRoot || null;
  } catch {
    return null;
  }
}
function getProjectBasePath(directory) {
  return getGitRoot(directory) || (0, import_node_path4.resolve)(directory);
}
function getGitEmail(directory) {
  try {
    const email = (0, import_node_child_process.execSync)("git config user.email", {
      cwd: getProjectBasePath(directory),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return email || null;
  } catch {
    return null;
  }
}
function normalizeGitRemote(remoteUrl) {
  const raw = remoteUrl.trim();
  if (!raw) return null;
  let normalized;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      normalized = parsed.protocol === "file:" ? `file:${decodeURIComponent(parsed.pathname)}` : `${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}/${parsed.pathname.replace(/^\/+/, "")}`;
    } catch {
      normalized = raw;
    }
  } else {
    const scpStyle = raw.match(/^(?:[^@/]+@)?([^:]+):(.+)$/);
    normalized = scpStyle ? `${scpStyle[1].toLowerCase()}/${scpStyle[2]}` : `file:${(0, import_node_path4.resolve)(raw)}`;
  }
  return normalized.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/{2,}/g, "/").toLowerCase();
}
function getGitRepoInfo(directory) {
  const cached = repoInfoCache.get(directory);
  if (cached) return cached;
  try {
    const remoteUrl = (0, import_node_child_process.execSync)("git remote get-url origin", {
      cwd: directory,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    const normalizedRemote = normalizeGitRemote(remoteUrl);
    const displayRemote = remoteUrl.replace(/\/+$/, "").replace(/\.git$/i, "");
    const separator = Math.max(
      displayRemote.lastIndexOf("/"),
      displayRemote.lastIndexOf(":")
    );
    const result = {
      name: displayRemote.slice(separator + 1) || null,
      normalizedRemote
    };
    repoInfoCache.set(directory, result);
    return result;
  } catch {
    const result = { name: null, normalizedRemote: null };
    repoInfoCache.set(directory, result);
    return result;
  }
}
function getGitRepoName(directory) {
  return getGitRepoInfo(directory).name;
}
function loadClaudeProjectConfig(directory) {
  try {
    const configPath = (0, import_node_path4.join)(
      getProjectBasePath(directory),
      ".claude",
      ".supermemory-claude",
      "config.json"
    );
    if (!(0, import_node_fs4.existsSync)(configPath)) return null;
    return JSON.parse((0, import_node_fs4.readFileSync)(configPath, "utf-8"));
  } catch {
    return null;
  }
}
function stripJsoncComments(content) {
  let result = "";
  let index = 0;
  let inString = false;
  let singleLineComment = false;
  let multiLineComment = false;
  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];
    if (!singleLineComment && !multiLineComment && char === '"') {
      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && content[cursor] === "\\"; cursor--) {
        backslashes++;
      }
      if (backslashes % 2 === 0) inString = !inString;
      result += char;
      index++;
      continue;
    }
    if (inString) {
      result += char;
      index++;
      continue;
    }
    if (!singleLineComment && !multiLineComment && char === "/" && next === "/") {
      singleLineComment = true;
      index += 2;
      continue;
    }
    if (!singleLineComment && !multiLineComment && char === "/" && next === "*") {
      multiLineComment = true;
      index += 2;
      continue;
    }
    if (singleLineComment) {
      if (char === "\n") {
        singleLineComment = false;
        result += char;
      }
      index++;
      continue;
    }
    if (multiLineComment) {
      if (char === "*" && next === "/") {
        multiLineComment = false;
        index += 2;
        continue;
      }
      if (char === "\n") result += char;
      index++;
      continue;
    }
    result += char;
    index++;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}
function loadLegacyOpenCodeConfig() {
  const configDir = (0, import_node_path4.join)((0, import_node_os4.homedir)(), ".config", "opencode");
  for (const filename of ["supermemory.jsonc", "supermemory.json"]) {
    try {
      const configPath = (0, import_node_path4.join)(configDir, filename);
      if (!(0, import_node_fs4.existsSync)(configPath)) continue;
      return JSON.parse(
        stripJsoncComments((0, import_node_fs4.readFileSync)(configPath, "utf-8"))
      );
    } catch {
      return null;
    }
  }
  return null;
}
function loadLegacyCursorConfig(directory) {
  let globalConfig = null;
  try {
    const configPath = (0, import_node_path4.join)(
      (0, import_node_os4.homedir)(),
      ".config",
      "cursor",
      "supermemory.json"
    );
    if ((0, import_node_fs4.existsSync)(configPath)) {
      globalConfig = JSON.parse((0, import_node_fs4.readFileSync)(configPath, "utf-8"));
    }
  } catch {
  }
  let projectConfig = null;
  let current = (0, import_node_path4.resolve)(directory);
  while (true) {
    try {
      const configPath = (0, import_node_path4.join)(
        current,
        ".cursor",
        ".supermemory",
        "config.json"
      );
      if ((0, import_node_fs4.existsSync)(configPath)) {
        projectConfig = JSON.parse((0, import_node_fs4.readFileSync)(configPath, "utf-8"));
        break;
      }
    } catch {
    }
    const parent = (0, import_node_path4.dirname)(current);
    if (parent === current) break;
    current = parent;
  }
  return { ...globalConfig ?? {}, ...projectConfig ?? {} };
}
function sanitizeRepoName(name) {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return sanitized.slice(0, 95).replace(/_+$/g, "") || "unknown";
}
function getGeneratedPersonalTag(directory) {
  return `user_project_${sha256(getProjectBasePath(directory))}`;
}
function getPersonalTag(directory) {
  return getProjectTag(directory);
}
function getGeneratedProjectTag(directory) {
  const basePath = getProjectBasePath(directory);
  const repoName = getGitRepoName(basePath) || (0, import_node_path4.basename)(basePath) || "unknown";
  const shortName = sanitizeRepoName(repoName).slice(0, 72).replace(/_+$/g, "");
  return `repo_${shortName || "unknown"}__${getProjectIdentity(directory)}`;
}
function getLegacyGeneratedProjectTag(directory) {
  const basePath = getProjectBasePath(directory);
  const repoName = getGitRepoName(basePath) || (0, import_node_path4.basename)(basePath) || "unknown";
  return `repo_${sanitizeRepoName(repoName)}`;
}
function getProjectIdentity(directory) {
  const basePath = getProjectBasePath(directory);
  const { normalizedRemote } = getGitRepoInfo(basePath);
  const isolateWorktrees = process.env.SUPERMEMORY_ISOLATE_WORKTREES === "true";
  let localIdentity = basePath;
  try {
    localIdentity = import_node_fs4.realpathSync.native(basePath);
  } catch {
  }
  return sha256(
    !isolateWorktrees && normalizedRemote ? normalizedRemote : `path:${localIdentity}`
  );
}
function getProjectTag(directory) {
  return loadClaudeProjectConfig(directory)?.repoContainerTag || process.env.SUPERMEMORY_REPO_TAG || loadLegacyCursorConfig(directory).repoContainerTag || CONFIG.projectContainerTag || loadLegacyOpenCodeConfig()?.projectContainerTag || getGeneratedProjectTag(directory);
}
function getProjectName(directory) {
  const basePath = getProjectBasePath(directory);
  return getGitRepoName(basePath) || (0, import_node_path4.basename)(basePath) || "unknown";
}
function getLegacyCodexUserTags(directory) {
  const identity = getGitEmail(directory) || process.env.USER || process.env.USERNAME || (0, import_node_os4.hostname)();
  return [
    CONFIG.userContainerTag,
    `${CONFIG.containerTagPrefix}_user_${sha256(identity)}`,
    `codex_user_${sha256(identity)}`
  ].filter((tag) => !!tag);
}
function getLegacyCodexProjectTags(directory) {
  const projectHash = sha256(getProjectBasePath(directory));
  return [
    CONFIG.projectContainerTag,
    `${CONFIG.containerTagPrefix}_project_${projectHash}`,
    `codex_project_${projectHash}`
  ].filter((tag) => !!tag);
}
function getLegacyOpenCodeUserTags(directory) {
  const config = loadLegacyOpenCodeConfig();
  const identity = getGitEmail(directory) || process.env.USER || process.env.USERNAME || "anonymous";
  const hash = sha256(identity);
  return uniqueTags([
    config?.userContainerTag,
    `${config?.containerTagPrefix || "opencode"}_user_${hash}`,
    `opencode_user_${hash}`
  ]);
}
function getLegacyOpenCodeProjectTags(directory) {
  const config = loadLegacyOpenCodeConfig();
  const hashes = [
    ...new Set(
      [directory, (0, import_node_path4.resolve)(directory), getProjectBasePath(directory)].map(
        (value) => sha256(value)
      )
    )
  ];
  return uniqueTags([
    config?.projectContainerTag,
    ...hashes.flatMap((hash) => [
      `${config?.containerTagPrefix || "opencode"}_project_${hash}`,
      `opencode_project_${hash}`
    ])
  ]);
}
function getLegacyCursorUserTags(directory) {
  const config = loadLegacyCursorConfig(directory);
  const identity = config.userContainerTag || process.env.SUPERMEMORY_USER_TAG || process.env.CURSOR_USER_EMAIL || getGitEmail(directory) || `${(0, import_node_os4.hostname)()}_${(0, import_node_os4.userInfo)().username}`;
  return [`cursor_user_${sha256(identity)}`];
}
function getLegacyCursorProjectTags(directory) {
  const config = loadLegacyCursorConfig(directory);
  const identity = config.projectContainerTag || process.env.SUPERMEMORY_PROJECT_TAG || getProjectBasePath(directory);
  return [`cursor_project_${sha256(identity)}`];
}
function uniqueTags(tags) {
  return [
    ...new Set(
      tags.filter(
        (tag) => typeof tag === "string" && tag.trim().length > 0
      )
    )
  ];
}
function getPersonalReadTags(directory) {
  const projectHash = sha256(getProjectBasePath(directory));
  const claudeConfig = loadClaudeProjectConfig(directory);
  return uniqueTags([
    getPersonalTag(directory),
    getGeneratedProjectTag(directory),
    claudeConfig?.personalContainerTag,
    CONFIG.userContainerTag,
    getGeneratedPersonalTag(directory),
    `claudecode_project_${projectHash}`,
    ...getLegacyCodexUserTags(directory),
    ...getLegacyOpenCodeUserTags(directory),
    ...getLegacyCursorUserTags(directory)
  ]);
}
function getProjectReadTags(directory) {
  return uniqueTags([
    getProjectTag(directory),
    getGeneratedProjectTag(directory),
    getLegacyGeneratedProjectTag(directory),
    ...getLegacyCodexProjectTags(directory),
    ...getLegacyOpenCodeProjectTags(directory),
    ...getLegacyCursorProjectTags(directory)
  ]);
}
function getAllReadTags(directory) {
  return uniqueTags([
    ...getPersonalReadTags(directory),
    ...getProjectReadTags(directory)
  ]);
}
function getTags(directory) {
  const canonical = getProjectTag(directory);
  return {
    canonical,
    user: canonical,
    project: canonical,
    projectId: getProjectIdentity(directory),
    projectName: getProjectName(directory),
    personalReads: getPersonalReadTags(directory),
    projectReads: getProjectReadTags(directory),
    allReads: getAllReadTags(directory)
  };
}

// src/services/capture.ts
var import_node_fs7 = require("node:fs");

// src/services/transcript.ts
var import_node_fs5 = require("node:fs");
var import_node_path5 = require("node:path");
var import_node_os5 = require("node:os");

// src/services/privacy.ts
function stripPrivateContent(content) {
  return content.replace(/<private>[\s\S]*?<\/private>/gi, "[REDACTED]");
}
function cleanContent(content) {
  return content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "").replace(/<supermemory-context>[\s\S]*?<\/supermemory-context>/gi, "").trim();
}

// src/services/transcript.ts
var SESSIONS_DIR = (0, import_node_path5.join)((0, import_node_os5.homedir)(), ".codex", "sessions");
function findTranscriptPath(sessionId) {
  if (!(0, import_node_fs5.existsSync)(SESSIONS_DIR)) {
    return null;
  }
  const now = /* @__PURE__ */ new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const todayDir = (0, import_node_path5.join)(SESSIONS_DIR, year, month, day);
  const found = searchDirForSession(todayDir, sessionId);
  if (found) return found;
  for (let i = 1; i <= 3; i++) {
    const pastDate = new Date(now);
    pastDate.setDate(pastDate.getDate() - i);
    const y = pastDate.getFullYear().toString();
    const m = (pastDate.getMonth() + 1).toString().padStart(2, "0");
    const d = pastDate.getDate().toString().padStart(2, "0");
    const pastDir = (0, import_node_path5.join)(SESSIONS_DIR, y, m, d);
    const found2 = searchDirForSession(pastDir, sessionId);
    if (found2) return found2;
  }
  return null;
}
function searchDirForSession(dir, sessionId) {
  if (!(0, import_node_fs5.existsSync)(dir)) {
    return null;
  }
  try {
    const files = (0, import_node_fs5.readdirSync)(dir);
    for (const file of files) {
      if (file.endsWith(".jsonl") && file.includes(sessionId)) {
        return (0, import_node_path5.join)(dir, file);
      }
    }
  } catch {
  }
  return null;
}
var DUPLICATE_LINE_WINDOW = 5;
function extractTextBlocks(content, blockTypes, separator = "\n") {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(
    (block) => !!block && blockTypes.includes(block.type ?? "") && typeof block.text === "string"
  ).map((block) => block.text).join(separator);
}
function parseTranscript(transcriptPath) {
  const entries = [];
  if (!(0, import_node_fs5.existsSync)(transcriptPath)) {
    return entries;
  }
  function pushEntry(index, role, rawContent) {
    const cleaned = cleanContent(stripPrivateContent(rawContent));
    if (!cleaned) return;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (index - entries[i].index > DUPLICATE_LINE_WINDOW) break;
      if (entries[i].role === role && entries[i].content === cleaned) return;
    }
    entries.push({ index, role, content: cleaned });
  }
  try {
    const raw = (0, import_node_fs5.readFileSync)(transcriptPath, "utf-8");
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "event_msg" && parsed.payload) {
          const payload = parsed.payload;
          if (payload.type === "user_message" && payload.message) {
            pushEntry(i, "user", payload.message);
          }
          if (payload.type === "assistant_output_text" && payload.text) {
            pushEntry(i, "assistant", payload.text);
          }
        }
        if (parsed.type === "response_item" && parsed.payload) {
          const payload = parsed.payload;
          if (payload.role === "user" && payload.content) {
            pushEntry(
              i,
              "user",
              extractTextBlocks(payload.content, ["input_text"], "")
            );
          } else if (payload.role === "assistant" && payload.content) {
            pushEntry(
              i,
              "assistant",
              extractTextBlocks(payload.content, ["output_text"])
            );
          }
        }
      } catch {
      }
    }
  } catch {
  }
  return entries;
}
function getEntriesSince(entries, lastIndex) {
  if (lastIndex === null) {
    return entries;
  }
  return entries.filter((e) => e.index > lastIndex);
}
function formatTranscript(entries) {
  return entries.map((e, idx) => `${idx + 1}. [${e.role}] ${e.content}`).join("\n");
}

// src/services/tracker.ts
var import_node_fs6 = require("node:fs");
var import_node_path6 = require("node:path");
var import_node_os6 = require("node:os");
var TRACKER_DIR = (0, import_node_path6.join)((0, import_node_os6.homedir)(), ".codex-supermemory", "trackers");
var LOCK_RETRY_MS = 5;
var LOCK_ATTEMPTS = 100;
var STALE_LOCK_MS = 6e4;
var WAIT_ARRAY = new Int32Array(new SharedArrayBuffer(4));
var CAPTURE_LOCK_RETRY_MS = 20;
var CAPTURE_LOCK_WAIT_MS = 25e3;
var CAPTURE_LOCK_STALE_MS = 35e3;
function ensureTrackerDir() {
  if (!(0, import_node_fs6.existsSync)(TRACKER_DIR)) {
    (0, import_node_fs6.mkdirSync)(TRACKER_DIR, { recursive: true });
  }
}
function getLastCapturedIndex(sessionId) {
  ensureTrackerDir();
  const trackerFile = (0, import_node_path6.join)(TRACKER_DIR, `${sessionId}.txt`);
  if ((0, import_node_fs6.existsSync)(trackerFile)) {
    const content = (0, import_node_fs6.readFileSync)(trackerFile, "utf-8").trim();
    const num = parseInt(content, 10);
    return isNaN(num) ? null : num;
  }
  return null;
}
function setLastCapturedIndex(sessionId, index) {
  ensureTrackerDir();
  const trackerFile = (0, import_node_path6.join)(TRACKER_DIR, `${sessionId}.txt`);
  const lockFile = `${trackerFile}.lock`;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    let lockFd = null;
    try {
      lockFd = (0, import_node_fs6.openSync)(lockFile, "wx");
      const current = getLastCapturedIndex(sessionId);
      if (current !== null && current >= index) return;
      const tempFile = `${trackerFile}.${process.pid}.${Date.now()}.tmp`;
      (0, import_node_fs6.writeFileSync)(tempFile, String(index));
      (0, import_node_fs6.renameSync)(tempFile, trackerFile);
      return;
    } catch (error) {
      const code = error.code;
      if (code !== "EEXIST") throw error;
      try {
        if (Date.now() - (0, import_node_fs6.statSync)(lockFile).mtimeMs > STALE_LOCK_MS) {
          (0, import_node_fs6.unlinkSync)(lockFile);
          continue;
        }
      } catch {
      }
      Atomics.wait(WAIT_ARRAY, 0, 0, LOCK_RETRY_MS);
    } finally {
      if (lockFd !== null) {
        (0, import_node_fs6.closeSync)(lockFd);
        try {
          (0, import_node_fs6.unlinkSync)(lockFile);
        } catch {
        }
      }
    }
  }
}
function delay(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function getCaptureLockOwnerState(lockFile) {
  try {
    const [pidText] = (0, import_node_fs6.readFileSync)(lockFile, "utf-8").split(":", 1);
    const pid = Number(pidText);
    if (!Number.isSafeInteger(pid) || pid <= 0) return "unknown";
    try {
      process.kill(pid, 0);
      return "alive";
    } catch (error) {
      return error.code === "ESRCH" ? "dead" : "alive";
    }
  } catch {
    return "unknown";
  }
}
async function withSessionCaptureLock(sessionId, action, waitMs = CAPTURE_LOCK_WAIT_MS) {
  ensureTrackerDir();
  const lockFile = (0, import_node_path6.join)(TRACKER_DIR, `${sessionId}.capture.lock`);
  const deadline = Date.now() + waitMs;
  while (Date.now() <= deadline) {
    let lockFd = null;
    const owner = `${process.pid}:${Date.now()}:${Math.random()}`;
    try {
      lockFd = (0, import_node_fs6.openSync)(lockFile, "wx");
      (0, import_node_fs6.writeFileSync)(lockFd, owner);
      await action();
      return true;
    } catch (error) {
      const code = error.code;
      if (lockFd !== null || code !== "EEXIST") throw error;
      try {
        const ownerState = getCaptureLockOwnerState(lockFile);
        const lockAge = Date.now() - (0, import_node_fs6.statSync)(lockFile).mtimeMs;
        if (ownerState === "dead" || lockAge > CAPTURE_LOCK_STALE_MS) {
          (0, import_node_fs6.unlinkSync)(lockFile);
          continue;
        }
      } catch {
      }
      await delay(CAPTURE_LOCK_RETRY_MS);
    } finally {
      if (lockFd !== null) {
        (0, import_node_fs6.closeSync)(lockFd);
        try {
          if ((0, import_node_fs6.readFileSync)(lockFile, "utf-8") === owner) (0, import_node_fs6.unlinkSync)(lockFile);
        } catch {
        }
      }
    }
  }
  return false;
}

// src/services/signals.ts
function hasSignal(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}
function getEntryText(entry) {
  return entry.content || "";
}
function groupEntriesIntoTurns(entries) {
  const turns = [];
  let currentTurn = { userEntries: [], assistantEntries: [], allEntries: [] };
  for (const entry of entries) {
    if (entry.role === "user") {
      if (currentTurn.assistantEntries.length > 0) {
        turns.push(currentTurn);
        currentTurn = { userEntries: [], assistantEntries: [], allEntries: [] };
      }
      currentTurn.userEntries.push(entry);
      currentTurn.allEntries.push(entry);
    } else if (entry.role === "assistant") {
      currentTurn.assistantEntries.push(entry);
      currentTurn.allEntries.push(entry);
    }
  }
  if (currentTurn.allEntries.length > 0) {
    turns.push(currentTurn);
  }
  return turns;
}
function getTurnUserText(turn) {
  return turn.userEntries.map((e) => getEntryText(e)).join(" ").toLowerCase();
}
function findSignalTurnIndices(turns, keywords) {
  const signalIndices = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const userText = getTurnUserText(turn);
    if (hasSignal(userText, keywords)) {
      signalIndices.push(i);
      continue;
    }
    const assistantText = turn.assistantEntries.map((e) => getEntryText(e)).join(" ").toLowerCase();
    if (hasSignal(assistantText, keywords)) {
      signalIndices.push(i);
    }
  }
  return signalIndices;
}
function getTurnsAroundSignals(turns, signalIndices, turnsBefore) {
  if (signalIndices.length === 0) return [];
  const includeSet = /* @__PURE__ */ new Set();
  for (const signalIdx of signalIndices) {
    const startIdx = Math.max(0, signalIdx - turnsBefore);
    for (let i = startIdx; i <= signalIdx; i++) {
      includeSet.add(i);
    }
  }
  const sortedIndices = Array.from(includeSet).sort((a, b) => a - b);
  return sortedIndices.map((idx) => turns[idx]);
}
function filterBySignals(entries) {
  const config = getSignalConfig();
  if (!config.enabled) {
    return entries;
  }
  const turns = groupEntriesIntoTurns(entries);
  if (turns.length === 0) return [];
  const signalIndices = findSignalTurnIndices(turns, config.keywords);
  if (signalIndices.length === 0) return [];
  const turnsToInclude = getTurnsAroundSignals(turns, signalIndices, config.turnsBefore);
  const result = [];
  for (const turn of turnsToInclude) {
    result.push(...turn.allEntries);
  }
  return result;
}

// src/services/capture.ts
function resolveTranscriptPath(transcriptPath, sessionId) {
  if (transcriptPath) return transcriptPath;
  return findTranscriptPath(sessionId);
}
async function captureEntries(caller, client, sessionId, transcriptPath, tags, options = {}) {
  if (!transcriptPath || !(0, import_node_fs7.existsSync)(transcriptPath)) {
    log(`${caller}: no transcript to capture from`, { sessionId, transcriptPath });
    return { status: "skipped" };
  }
  let result = { status: "skipped" };
  const acquired = await withSessionCaptureLock(sessionId, async () => {
    result = await captureEntriesLocked(
      caller,
      client,
      sessionId,
      transcriptPath,
      tags,
      options
    );
  });
  if (!acquired) {
    log(`${caller}: capture lock timed out`, { sessionId });
    return { status: "failed" };
  }
  return result;
}
async function captureEntriesLocked(caller, client, sessionId, transcriptPath, tags, options) {
  const { requireMinEntries = 0, requireMinTurns = 0 } = options;
  const entries = parseTranscript(transcriptPath);
  if (entries.length === 0) {
    log(`${caller}: transcript empty`, { sessionId });
    return { status: "skipped" };
  }
  const lastIndex = getLastCapturedIndex(sessionId);
  const newEntries = getEntriesSince(entries, lastIndex);
  if (requireMinEntries > 0 && newEntries.length < requireMinEntries) {
    log(`${caller}: not enough new entries to capture`, {
      sessionId,
      newCount: newEntries.length,
      required: requireMinEntries,
      lastIndex
    });
    return { status: "skipped" };
  }
  if (newEntries.length === 0) {
    log(`${caller}: no new entries to capture`, { sessionId });
    return { status: "skipped" };
  }
  if (requireMinTurns > 0) {
    const turns = groupEntriesIntoTurns(newEntries);
    const effectiveTurnCount = turns.length + 1;
    if (effectiveTurnCount < requireMinTurns) {
      log(`${caller}: waiting for more turns before capture`, {
        sessionId,
        turnCount: effectiveTurnCount,
        requiredTurns: requireMinTurns,
        lastIndex
      });
      return { status: "skipped" };
    }
  }
  const signalEntries = filterBySignals(newEntries);
  if (signalEntries.length === 0) {
    log(`${caller}: no signal entries to capture`, {
      sessionId,
      totalNew: newEntries.length,
      lastIndex
    });
    const lastEntry = newEntries[newEntries.length - 1];
    setLastCapturedIndex(sessionId, lastEntry.index);
    return { status: "skipped" };
  }
  log(`${caller}: capturing signal entries`, {
    sessionId,
    signalCount: signalEntries.length,
    totalNew: newEntries.length,
    lastIndex
  });
  const transcript = formatTranscript(signalEntries);
  const rawContent = `[Session ${sessionId}]
${transcript}`;
  const content = rawContent.replace(/\[SUPERMEMORY CONTAINERS\][\s\S]*?\[END SUPERMEMORY CONTAINERS\]\s*/g, "").replace(/<supermemory-containers>[\s\S]*?<\/supermemory-containers>\s*/g, "").trim();
  const metadata = {
    type: "conversation",
    project: tags.projectName,
    sm_project_id: tags.projectId,
    sessionId,
    entryCount: newEntries.length,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    sm_scope: "personal",
    sm_capture_mode: caller === "flush" ? "session_end" : "turn"
  };
  try {
    const result = await client.addMemory(content, tags.canonical, metadata, {
      customId: sessionId,
      entityContext: USER_ENTITY_CONTEXT,
      timeoutMs: HOOK_API_TIMEOUT_MS
    });
    if (!result.success) {
      log(`${caller}: capture upload failed, tracker not advanced`, {
        sessionId,
        error: result.error
      });
      return { status: "failed" };
    }
    const lastEntry = newEntries[newEntries.length - 1];
    setLastCapturedIndex(sessionId, lastEntry.index);
    log(`${caller}: captured entries`, {
      sessionId,
      count: newEntries.length,
      lastIndex: lastEntry.index
    });
    return { status: "captured", entryCount: newEntries.length };
  } catch (error) {
    log(`${caller}: capture error`, { error: String(error) });
    return { status: "failed" };
  }
}

// src/services/session.ts
var import_node_crypto2 = require("node:crypto");
var FOUR_HOURS_MS = 4 * 60 * 60 * 1e3;
function sha2562(input) {
  return (0, import_node_crypto2.createHash)("sha256").update(input).digest("hex").slice(0, 16);
}
function getFourHourBucket(date = /* @__PURE__ */ new Date()) {
  return Math.floor(date.getTime() / FOUR_HOURS_MS);
}
function getSessionId(providedSessionId, scope, date = /* @__PURE__ */ new Date()) {
  if (providedSessionId?.trim()) return providedSessionId;
  return `codex_${sha2562(`${scope}:${getFourHourBucket(date)}`)}`;
}

// src/hooks/flush.ts
async function main() {
  let rawInput = "";
  try {
    rawInput = (0, import_node_fs8.readFileSync)(0, "utf-8");
  } catch {
    return;
  }
  if (!isConfigured()) {
    return;
  }
  let payload = {};
  try {
    payload = JSON.parse(rawInput);
  } catch {
    return;
  }
  const cwd = payload.cwd || process.cwd();
  const tags = getTags(cwd);
  const sessionId = getSessionId(payload.session_id, tags.project);
  const transcriptPath = resolveTranscriptPath(payload.transcript_path, sessionId);
  log("flush: start", { sessionId, transcriptPath });
  const client = new SupermemoryClient();
  const result = await captureEntries("flush", client, sessionId, transcriptPath, tags);
  if (result.status === "captured") {
    process.stdout.write(JSON.stringify({
      systemMessage: "\u25EA supermemory \xB7 saved this turn"
    }));
  }
}
main().catch(() => {
}).finally(() => process.exit(0));
