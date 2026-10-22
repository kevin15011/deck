// src/v2/runtime.ts
import { createHash as createHash4 } from "node:crypto";

// src/config.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";

// src/services/jsonc.ts
function stripJsoncComments(content) {
  let result = "";
  let i = 0;
  let inString = false;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];
    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === '"') {
        let backslashCount = 0;
        let j = i - 1;
        while (j >= 0 && content[j] === "\\") {
          backslashCount++;
          j--;
        }
        if (backslashCount % 2 === 0) {
          inString = !inString;
        }
        result += char;
        i++;
        continue;
      }
    }
    if (inString) {
      result += char;
      i++;
      continue;
    }
    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === "/" && nextChar === "/") {
        inSingleLineComment = true;
        i += 2;
        continue;
      }
      if (char === "/" && nextChar === "*") {
        inMultiLineComment = true;
        i += 2;
        continue;
      }
    }
    if (inSingleLineComment) {
      if (char === `
`) {
        inSingleLineComment = false;
        result += char;
      }
      i++;
      continue;
    }
    if (inMultiLineComment) {
      if (char === "*" && nextChar === "/") {
        inMultiLineComment = false;
        i += 2;
        continue;
      }
      if (char === `
`) {
        result += char;
      }
      i++;
      continue;
    }
    result += char;
    i++;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

// src/services/auth.ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arch, homedir, hostname, platform } from "node:os";
var CREDENTIALS_DIR = join(homedir(), ".supermemory-opencode");
var CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");
var AUTH_BASE_URL = process.env.SUPERMEMORY_AUTH_URL || "https://console.supermemory.ai/auth/connect";
var AUTH_TIMEOUT = Number(process.env.SUPERMEMORY_AUTH_TIMEOUT) || 5 * 60000;
function loadCredentials() {
  if (!existsSync(CREDENTIALS_FILE))
    return null;
  try {
    const content = readFileSync(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// src/version.ts
var PLUGIN_VERSION = "2.0.15";

// src/config.ts
var CONFIG_DIR = join2(homedir2(), ".config", "opencode");
var CONFIG_FILES = [
  join2(CONFIG_DIR, "supermemory.jsonc"),
  join2(CONFIG_DIR, "supermemory.json")
];
var DEFAULT_BASE_URL = "https://api.supermemory.ai";
var DEFAULT_KEYWORD_PATTERNS = [
  "remember",
  "memorize",
  "save\\s+this",
  "note\\s+this",
  "keep\\s+in\\s+mind",
  "don'?t\\s+forget",
  "learn\\s+this",
  "store\\s+this",
  "record\\s+this",
  "make\\s+a\\s+note",
  "take\\s+note",
  "jot\\s+down",
  "commit\\s+to\\s+memory",
  "remember\\s+that",
  "never\\s+forget",
  "always\\s+remember"
];
var DEFAULTS = {
  similarityThreshold: 0.55,
  maxMemories: 5,
  maxProjectMemories: 10,
  maxProfileItems: 5,
  injectProfile: true,
  containerTagPrefix: "opencode",
  filterPrompt: "You are a stateful coding agent. Remember all the information, including but not limited to user's coding preferences, tech stack, behaviours, workflows, and any other relevant details.",
  keywordPatterns: [],
  compactionThreshold: 0.8,
  compactionEnabled: true,
  autoRecallEveryPrompt: false,
  captureEveryNTurns: 0,
  recallMode: "direct"
};
function isValidRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}
function validateCompactionThreshold(value) {
  if (value === undefined || typeof value !== "number" || isNaN(value)) {
    return DEFAULTS.compactionThreshold;
  }
  if (value <= 0 || value > 1)
    return DEFAULTS.compactionThreshold;
  return value;
}
function validateCaptureEveryNTurns(value, fallback) {
  if (value === undefined || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return fallback;
  }
  return value;
}
function resolveRecallMode() {
  if (fileConfig.recallMode === "direct" || fileConfig.recallMode === "advisory" || fileConfig.recallMode === "off") {
    return fileConfig.recallMode;
  }
  if (fileConfig.recallDirective?.trim())
    return "advisory";
  if (fileConfig.autoRecallEveryPrompt === true)
    return "direct";
  if (fileConfig.autoRecallEveryPrompt === false)
    return "advisory";
  return DEFAULTS.recallMode;
}
function loadRawConfig() {
  for (const path of CONFIG_FILES) {
    if (existsSync2(path)) {
      try {
        const content = readFileSync2(path, "utf-8");
        const json = stripJsoncComments(content);
        return { config: JSON.parse(json), existed: true };
      } catch {
        return { config: {}, existed: true };
      }
    }
  }
  return { config: {}, existed: false };
}
var { config: fileConfig, existed: configExisted } = loadRawConfig();
function getApiKey() {
  if (process.env.SUPERMEMORY_API_KEY)
    return process.env.SUPERMEMORY_API_KEY;
  if (fileConfig.apiKey)
    return fileConfig.apiKey;
  return loadCredentials()?.apiKey;
}
var SUPERMEMORY_API_KEY = getApiKey();
function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim())
    return null;
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
function getApiBaseUrl() {
  const configured = process.env.SUPERMEMORY_API_URL || process.env.SUPERMEMORY_BASE_URL || fileConfig.baseUrl || loadCredentials()?.apiBaseUrl || DEFAULT_BASE_URL;
  const normalized = normalizeBaseUrl(configured);
  if (!normalized) {
    throw new Error("Invalid baseUrl: expected an absolute http(s) URL");
  }
  return normalized;
}
var CONFIG_FILE = CONFIG_FILES[1];
var DEFAULT_CONFIG_FILE = CONFIG_FILE ?? join2(CONFIG_DIR, "supermemory.json");
var CONFIG = {
  similarityThreshold: fileConfig.similarityThreshold ?? DEFAULTS.similarityThreshold,
  maxMemories: fileConfig.maxMemories ?? DEFAULTS.maxMemories,
  maxProjectMemories: fileConfig.maxProjectMemories ?? DEFAULTS.maxProjectMemories,
  maxProfileItems: fileConfig.maxProfileItems ?? DEFAULTS.maxProfileItems,
  injectProfile: fileConfig.injectProfile ?? DEFAULTS.injectProfile,
  containerTagPrefix: fileConfig.containerTagPrefix ?? DEFAULTS.containerTagPrefix,
  userContainerTag: fileConfig.userContainerTag,
  projectContainerTag: fileConfig.projectContainerTag,
  filterPrompt: fileConfig.filterPrompt ?? DEFAULTS.filterPrompt,
  keywordPatterns: [
    ...DEFAULT_KEYWORD_PATTERNS,
    ...(fileConfig.keywordPatterns ?? []).filter(isValidRegex)
  ],
  compactionThreshold: validateCompactionThreshold(fileConfig.compactionThreshold),
  compactionEnabled: typeof fileConfig.compactionEnabled === "boolean" ? fileConfig.compactionEnabled : DEFAULTS.compactionEnabled,
  autoRecallEveryPrompt: fileConfig.autoRecallEveryPrompt ?? (configExisted ? true : DEFAULTS.autoRecallEveryPrompt),
  recallMode: resolveRecallMode(),
  captureEveryNTurns: validateCaptureEveryNTurns(fileConfig.captureEveryNTurns, configExisted ? 3 : DEFAULTS.captureEveryNTurns),
  recallDirective: fileConfig.recallDirective ?? null
};
function isConfigured() {
  return !!SUPERMEMORY_API_KEY;
}
function getRecallConfig() {
  return {
    directive: CONFIG.recallDirective ?? null,
    mode: CONFIG.recallMode
  };
}

// src/services/logger.ts
import { appendFileSync, writeFileSync as writeFileSync3 } from "fs";
import { homedir as homedir3 } from "os";
import { join as join3 } from "path";
var LOG_FILE = join3(homedir3(), ".opencode-supermemory.log");
writeFileSync3(LOG_FILE, `
--- Session started: ${new Date().toISOString()} ---
`, { flag: "a" });
function log(message, data) {
  const timestamp = new Date().toISOString();
  const line = data ? `[${timestamp}] ${message}: ${JSON.stringify(data)}
` : `[${timestamp}] ${message}
`;
  appendFileSync(LOG_FILE, line);
}

// src/services/activity.ts
var ACTIVITY_TITLE = "Supermemory";
var ACTIVITY_PREFIX = "◪ supermemory · ";
function notice(kind, message, variant, duration) {
  return {
    kind,
    title: ACTIVITY_TITLE,
    message: `${ACTIVITY_PREFIX}${message}`,
    variant,
    duration
  };
}
function createMemoryActivityReporterFromSink(show) {
  const emit = (item) => {
    try {
      show(item);
    } catch (error) {
      log("[activity] unable to show notification", { error: String(error) });
    }
  };
  return {
    recalling(query) {
      const suffix = query?.trim() ? `: ${query.trim().slice(0, 100)}` : "";
      emit(notice("recalling", `recalling${suffix}`, "info", 2000));
    },
    recalled(count, tokens) {
      emit(notice("recalled", `recalled ${count} ${count === 1 ? "memory" : "memories"} (${tokens} tok)`, "success", 3000));
    },
    recallUnavailable() {
      emit(notice("recall-unavailable", "recall unavailable; continuing without recalled context", "warning", 3000));
    },
    saved() {
      emit(notice("saved", "saved this turn", "success", 2000));
    },
    updateAvailable(info) {
      emit(notice("update-available", `update available: v${info.currentVersion} → v${info.latestVersion} · ${info.updateCommand}`, "info", 8000));
    }
  };
}
function createMemoryActivityReporter(client) {
  return createMemoryActivityReporterFromSink((item) => {
    client.tui.showToast({
      body: {
        title: item.title,
        message: item.message,
        variant: item.variant,
        duration: item.duration
      }
    }).catch((error) => {
      log("[activity] unable to show TUI notification", {
        error: String(error)
      });
    });
  });
}

// src/services/capture.ts
import { createHash } from "node:crypto";

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
  return typeof err === "object" && err !== null && (("name" in err) && err.name === "AbortError" || ("message" in err) && String(err.message).includes("FetchRequestCanceledException"));
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
    } catch {}
    try {
      return new Error(JSON.stringify(err));
    } catch {}
  }
  return new Error(err);
};

// node_modules/supermemory/core/error.mjs
class SupermemoryError extends Error {
}

class APIError extends SupermemoryError {
  constructor(status, error, message, headers) {
    super(`${APIError.makeMessage(status, error, message)}`);
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
    return new APIError(status, error, message, headers);
  }
}

class APIUserAbortError extends APIError {
  constructor({ message } = {}) {
    super(undefined, undefined, message || "Request was aborted.", undefined);
  }
}

class APIConnectionError extends APIError {
  constructor({ message, cause }) {
    super(undefined, undefined, message || "Connection error.", undefined);
    if (cause)
      this.cause = cause;
  }
}

class APIConnectionTimeoutError extends APIConnectionError {
  constructor({ message } = {}) {
    super({ message: message ?? "Request timed out." });
  }
}

class BadRequestError extends APIError {
}

class AuthenticationError extends APIError {
}

class PermissionDeniedError extends APIError {
}

class NotFoundError extends APIError {
}

class ConflictError extends APIError {
}

class UnprocessableEntityError extends APIError {
}

class RateLimitError extends APIError {
}

class InternalServerError extends APIError {
}

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
    return;
  }
};

// node_modules/supermemory/internal/utils/sleep.mjs
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
var normalizeArch = (arch) => {
  if (arch === "x32")
    return "x32";
  if (arch === "x86_64" || arch === "x64")
    return "x64";
  if (arch === "arm")
    return "arm";
  if (arch === "aarch64" || arch === "arm64")
    return "arm64";
  if (arch)
    return `other:${arch}`;
  return "unknown";
};
var normalizePlatform = (platform) => {
  platform = platform.toLowerCase();
  if (platform.includes("ios"))
    return "iOS";
  if (platform === "android")
    return "Android";
  if (platform === "darwin")
    return "MacOS";
  if (platform === "win32")
    return "Windows";
  if (platform === "freebsd")
    return "FreeBSD";
  if (platform === "openbsd")
    return "OpenBSD";
  if (platform === "linux")
    return "Linux";
  if (platform)
    return `Other:${platform}`;
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
    start() {},
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
  return (typeof value === "object" && value !== null && (("name" in value) && value.name && String(value.name) || ("url" in value) && value.url && String(value.url) || ("filename" in value) && value.filename && String(value.filename) || ("path" in value) && value.path && String(value.path)) || "").split(/[\\/]/).pop() || undefined;
}
var isAsyncIterable = (value) => value != null && typeof value === "object" && typeof value[Symbol.asyncIterator] === "function";
var multipartFormRequestOptions = async (opts, fetch2) => {
  return { ...opts, body: await createForm(opts.body, fetch2) };
};
var supportsFormDataMap = /* @__PURE__ */ new WeakMap;
function supportsFormData(fetchObject) {
  const fetch2 = typeof fetchObject === "function" ? fetchObject : fetchObject.fetch;
  const cached = supportsFormDataMap.get(fetch2);
  if (cached)
    return cached;
  const promise = (async () => {
    try {
      const FetchResponse = "Response" in fetch2 ? fetch2.Response : (await fetch2("data:,")).constructor;
      const data = new FormData;
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
  const form = new FormData;
  await Promise.all(Object.entries(body || {}).map(([key, value]) => addFormValue(form, key, value)));
  return form;
};
var isNamedBlob = (value) => value instanceof Blob && ("name" in value);
var addFormValue = async (form, key, value) => {
  if (value === undefined)
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
    const type = parts.find((part) => typeof part === "object" && ("type" in part) && part.type);
    if (typeof type === "string") {
      options = { ...options, type };
    }
  }
  return makeFile(parts, name, options);
}
async function getBytes(value) {
  let parts = [];
  if (typeof value === "string" || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
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
class APIResource {
  constructor(client) {
    this._client = client;
  }
}

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
      if (value === undefined)
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
  const targetHeaders = new Headers;
  const nullHeaders = new Set;
  for (const headers of newHeaders) {
    const seenHeaders = new Set;
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
var createPathTagFunction = (pathEncoder = encodeURIPath) => function path(statics, ...params) {
  if (statics.length === 1)
    return statics[0];
  let postPath = false;
  const invalidSegments = [];
  const path = statics.reduce((previousValue, currentValue, index) => {
    if (/[?#]/.test(currentValue)) {
      postPath = true;
    }
    const value = params[index];
    let encoded = (postPath ? encodeURIComponent : pathEncoder)("" + value);
    if (index !== params.length && (value == null || typeof value === "object" && value.toString === Object.getPrototypeOf(Object.getPrototypeOf(value.hasOwnProperty ?? EMPTY) ?? EMPTY)?.toString)) {
      encoded = value + "";
      invalidSegments.push({
        start: previousValue.length + currentValue.length,
        length: encoded.length,
        error: `Value of type ${Object.prototype.toString.call(value).slice(8, -1)} is not a valid path parameter`
      });
    }
    return previousValue + currentValue + (index === params.length ? "" : encoded);
  }, "");
  const pathOnly = path.split(/[?#]/, 1)[0];
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
${invalidSegments.map((e) => e.error).join(`
`)}
${path}
${underline}`);
  }
  return path;
};
var path = /* @__PURE__ */ createPathTagFunction(encodeURIPath);

// node_modules/supermemory/resources/connections.mjs
class Connections extends APIResource {
  create(provider, body = {}, options) {
    return this._client.post(path`/v3/connections/${provider}`, { body, ...options });
  }
  list(body = {}, options) {
    return this._client.post("/v3/connections/list", { body, ...options });
  }
  configure(connectionID, body, options) {
    return this._client.post(path`/v3/connections/${connectionID}/configure`, { body, ...options });
  }
  deleteByID(connectionID, options) {
    return this._client.delete(path`/v3/connections/${connectionID}`, options);
  }
  deleteByProvider(provider, body, options) {
    return this._client.delete(path`/v3/connections/${provider}`, { body, ...options });
  }
  getByID(connectionID, options) {
    return this._client.get(path`/v3/connections/${connectionID}`, options);
  }
  getByTag(provider, body, options) {
    return this._client.post(path`/v3/connections/${provider}/connection`, { body, ...options });
  }
  import(provider, body = {}, options) {
    return this._client.post(path`/v3/connections/${provider}/import`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "text/plain" }, options?.headers])
    });
  }
  listDocuments(provider, body = {}, options) {
    return this._client.post(path`/v3/connections/${provider}/documents`, { body, ...options });
  }
  resources(connectionID, query = {}, options) {
    return this._client.get(path`/v3/connections/${connectionID}/resources`, { query, ...options });
  }
}
// node_modules/supermemory/resources/documents.mjs
class Documents extends APIResource {
  update(id, body = {}, options) {
    return this._client.patch(path`/v3/documents/${id}`, { body, ...options });
  }
  list(body = {}, options) {
    return this._client.post("/v3/documents/list", { body, ...options });
  }
  delete(id, options) {
    return this._client.delete(path`/v3/documents/${id}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
  add(body, options) {
    return this._client.post("/v3/documents", { body, ...options });
  }
  batchAdd(body, options) {
    return this._client.post("/v3/documents/batch", { body, ...options });
  }
  deleteBulk(body = {}, options) {
    return this._client.delete("/v3/documents/bulk", { body, ...options });
  }
  get(id, options) {
    return this._client.get(path`/v3/documents/${id}`, options);
  }
  listProcessing(options) {
    return this._client.get("/v3/documents/processing", options);
  }
  uploadFile(body, options) {
    return this._client.post("/v3/documents/file", multipartFormRequestOptions({ body, ...options }, this._client));
  }
}
// node_modules/supermemory/resources/memories.mjs
class Memories extends APIResource {
  update(id, body = {}, options) {
    return this._client.patch(path`/v3/documents/${id}`, { body, ...options });
  }
  list(body = {}, options) {
    return this._client.post("/v3/documents/list", { body, ...options });
  }
  delete(id, options) {
    return this._client.delete(path`/v3/documents/${id}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
  add(body, options) {
    return this._client.post("/v3/documents", { body, ...options });
  }
  forget(body, options) {
    return this._client.delete("/v4/memories", { body, ...options });
  }
  get(id, options) {
    return this._client.get(path`/v3/documents/${id}`, options);
  }
  updateMemory(body, options) {
    return this._client.patch("/v4/memories", { body, ...options });
  }
  uploadFile(body, options) {
    return this._client.post("/v3/documents/file", multipartFormRequestOptions({ body, ...options }, this._client));
  }
}
// node_modules/supermemory/resources/search.mjs
class Search extends APIResource {
  documents(body, options) {
    return this._client.post("/v3/search", { body, ...options });
  }
  execute(body, options) {
    return this._client.post("/v3/search", { body, ...options });
  }
  memories(body, options) {
    return this._client.post("/v4/search", { body, ...options });
  }
}
// node_modules/supermemory/resources/settings.mjs
class Settings extends APIResource {
  update(body = {}, options) {
    return this._client.patch("/v3/settings", { body, ...options });
  }
  get(options) {
    return this._client.get("/v3/settings", options);
  }
}
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
    return;
  }
  if (hasOwn(levelNumbers, maybeLevel)) {
    return maybeLevel;
  }
  loggerFor(client).warn(`${sourceName} was set to ${JSON.stringify(maybeLevel)}, expected one of ${JSON.stringify(Object.keys(levelNumbers))}`);
  return;
};
function noop() {}
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
var cachedLoggers = /* @__PURE__ */ new WeakMap;
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

class APIPromise extends Promise {
  constructor(client, responsePromise, parseResponse = defaultParseResponse) {
    super((resolve) => {
      resolve(null);
    });
    this.responsePromise = responsePromise;
    this.parseResponse = parseResponse;
    _APIPromise_client.set(this, undefined);
    __classPrivateFieldSet(this, _APIPromise_client, client, "f");
  }
  _thenUnwrap(transform) {
    return new APIPromise(__classPrivateFieldGet(this, _APIPromise_client, "f"), this.responsePromise, async (client, props) => transform(await this.parseResponse(client, props), props));
  }
  asResponse() {
    return this.responsePromise.then((p) => p.response);
  }
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
}
_APIPromise_client = new WeakMap;

// node_modules/supermemory/internal/utils/env.mjs
var readEnv = (env) => {
  if (typeof globalThis.process !== "undefined") {
    return globalThis.process.env?.[env]?.trim() ?? undefined;
  }
  if (typeof globalThis.Deno !== "undefined") {
    return globalThis.Deno.env?.get?.(env)?.trim();
  }
  return;
};

// node_modules/supermemory/client.mjs
var _Supermemory_instances;
var _a;
var _Supermemory_encoder;
var _Supermemory_baseURLOverridden;

class Supermemory {
  constructor({ baseURL = readEnv("SUPERMEMORY_BASE_URL"), apiKey = readEnv("SUPERMEMORY_API_KEY"), ...opts } = {}) {
    _Supermemory_instances.add(this);
    _Supermemory_encoder.set(this, undefined);
    this.memories = new Memories(this);
    this.documents = new Documents(this);
    this.search = new Search(this);
    this.settings = new Settings(this);
    this.connections = new Connections(this);
    if (apiKey === undefined) {
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
  add(body, options) {
    return this.post("/v3/documents", { body, ...options });
  }
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
  buildURL(path, query, defaultBaseURL) {
    const baseURL = !__classPrivateFieldGet(this, _Supermemory_instances, "m", _Supermemory_baseURLOverridden).call(this) && defaultBaseURL || this.baseURL;
    const url = isAbsoluteURL(path) ? new URL(path) : new URL(baseURL + (baseURL.endsWith("/") && path.startsWith("/") ? path.slice(1) : path));
    const defaultQuery = this.defaultQuery();
    if (!isEmptyObj(defaultQuery)) {
      query = { ...defaultQuery, ...query };
    }
    if (typeof query === "object" && query && !Array.isArray(query)) {
      url.search = this.stringifyQuery(query);
    }
    return url.toString();
  }
  async prepareOptions(options) {}
  async prepareRequest(request, { url, options }) {}
  get(path, opts) {
    return this.methodRequest("get", path, opts);
  }
  post(path, opts) {
    return this.methodRequest("post", path, opts);
  }
  patch(path, opts) {
    return this.methodRequest("patch", path, opts);
  }
  put(path, opts) {
    return this.methodRequest("put", path, opts);
  }
  delete(path, opts) {
    return this.methodRequest("delete", path, opts);
  }
  methodRequest(method, path, opts) {
    return this.request(Promise.resolve(opts).then((opts) => {
      return { method, path, ...opts };
    }));
  }
  request(options, remainingRetries = null) {
    return new APIPromise(this, this.makeRequest(options, remainingRetries, undefined));
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
    const retryLogStr = retryOfRequestLogID === undefined ? "" : `, retryOf: ${retryOfRequestLogID}`;
    const startTime = Date.now();
    loggerFor(this).debug(`[${requestLogID}] sending request`, formatRequestDetails({
      retryOfRequestLogID,
      method: options.method,
      url,
      options,
      headers: req.headers
    }));
    if (options.signal?.aborted) {
      throw new APIUserAbortError;
    }
    const controller = new AbortController;
    const response = await this.fetchWithTimeout(url, req, timeout, controller).catch(castToError);
    const headersTime = Date.now();
    if (response instanceof globalThis.Error) {
      const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
      if (options.signal?.aborted) {
        throw new APIUserAbortError;
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
        throw new APIConnectionTimeoutError;
      }
      throw new APIConnectionError({ cause: response });
    }
    const responseInfo = `[${requestLogID}${retryLogStr}] ${req.method} ${url} ${response.ok ? "succeeded" : "failed"} with status ${response.status} in ${headersTime - startTime}ms`;
    if (!response.ok) {
      const shouldRetry = await this.shouldRetry(response);
      if (retriesRemaining && shouldRetry) {
        const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
        await CancelReadableStream(response.body);
        loggerFor(this).info(`${responseInfo} - ${retryMessage}`);
        loggerFor(this).debug(`[${requestLogID}] response error (${retryMessage})`, formatRequestDetails({
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
      const errText = await response.text().catch((err) => castToError(err).message);
      const errJSON = safeJSON(errText);
      const errMessage = errJSON ? undefined : errText;
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
      return await this.fetch.call(undefined, url, fetchOptions);
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
        timeoutMillis = timeoutSeconds * 1000;
      } else {
        timeoutMillis = Date.parse(retryAfterHeader) - Date.now();
      }
    }
    if (!(timeoutMillis && 0 <= timeoutMillis && timeoutMillis < 60 * 1000)) {
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
    return sleepSeconds * jitter * 1000;
  }
  async buildRequest(inputOptions, { retryCount = 0 } = {}) {
    const options = { ...inputOptions };
    const { method, path, query, defaultBaseURL } = options;
    const url = this.buildURL(path, query, defaultBaseURL);
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
        ...options.timeout ? { "X-Stainless-Timeout": String(Math.trunc(options.timeout / 1000)) } : {},
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
      return { bodyHeaders: undefined, body: undefined };
    }
    const headers = buildHeaders([rawHeaders]);
    if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer || body instanceof DataView || typeof body === "string" && headers.values.has("content-type") || globalThis.Blob && body instanceof globalThis.Blob || body instanceof FormData || body instanceof URLSearchParams || globalThis.ReadableStream && body instanceof globalThis.ReadableStream) {
      return { bodyHeaders: undefined, body };
    } else if (typeof body === "object" && ((Symbol.asyncIterator in body) || (Symbol.iterator in body) && ("next" in body) && typeof body.next === "function")) {
      return { bodyHeaders: undefined, body: ReadableStreamFrom(body) };
    } else {
      return __classPrivateFieldGet(this, _Supermemory_encoder, "f").call(this, { body, headers });
    }
  }
}
_a = Supermemory, _Supermemory_encoder = new WeakMap, _Supermemory_instances = new WeakSet, _Supermemory_baseURLOverridden = function _Supermemory_baseURLOverridden() {
  return this.baseURL !== "https://api.supermemory.ai";
};
Supermemory.Supermemory = _a;
Supermemory.DEFAULT_TIMEOUT = 60000;
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
// src/services/recall-results.ts
var MIN_RECALL_SIMILARITY = 0.55;
var MAX_RECALL_RESULTS = 5;
var MAX_RECALL_HIT_CHARS = 300;
function finiteSimilarity(result) {
  return [result.similarity, result.score].find((value) => typeof value === "number" && Number.isFinite(value));
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
function getRecallResultText(result) {
  return nonEmptyString(result.memory) ?? nonEmptyString(result.chunk) ?? nonEmptyString(result.content) ?? nonEmptyString(result.text) ?? nonEmptyString(result.context) ?? "";
}
function getRecallResultTitle(result) {
  return nonEmptyString(result.title) ?? nonEmptyString(result.metadata?.title);
}
function getRecallResultFilepath(result) {
  return nonEmptyString(result.filepath) ?? nonEmptyString(result.metadata?.filepath) ?? nonEmptyString(result.metadata?.filePath) ?? nonEmptyString(result.metadata?.path);
}
function truncateHit(text, maxChars) {
  if (text.length <= maxChars)
    return text;
  if (maxChars <= 3)
    return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}
function normalizeRecallResult(result, maxHitChars) {
  const text = getRecallResultText(result);
  if (!text)
    return null;
  return {
    result,
    text: maxHitChars === undefined ? text : truncateHit(text, Math.max(1, maxHitChars)),
    similarity: finiteSimilarity(result),
    title: getRecallResultTitle(result),
    filepath: getRecallResultFilepath(result)
  };
}
function normalizeRecallResults(results, options) {
  const limit = Math.max(0, options?.limit ?? MAX_RECALL_RESULTS);
  const minSimilarity = Math.max(MIN_RECALL_SIMILARITY, options?.minSimilarity ?? MIN_RECALL_SIMILARITY);
  const maxHitChars = Math.max(1, options?.maxHitChars ?? MAX_RECALL_HIT_CHARS);
  const seen = new Set;
  return results.map((result) => normalizeRecallResult(result, maxHitChars)).filter((hit) => hit !== null).filter((hit) => hit.similarity === undefined || hit.similarity >= minSimilarity).sort((a, b) => (b.similarity ?? Number.NEGATIVE_INFINITY) - (a.similarity ?? Number.NEGATIVE_INFINITY)).filter((hit) => {
    const key = hit.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}
function formatRecallHit(hit) {
  const title = hit.title && !hit.text.toLocaleLowerCase().startsWith(hit.title.toLocaleLowerCase()) ? `${hit.title}: ` : "";
  const filepath = hit.filepath ? ` (${hit.filepath})` : "";
  return `${title}${hit.text}${filepath}`;
}

// src/services/result-merge.ts
function normalize(value) {
  return String(value ?? "").toLowerCase().trim();
}
function dedupe(items, getKey) {
  const seen = new Set;
  return items.filter((item) => {
    const key = normalize(getKey(item));
    if (!key || seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}
function searchKey(result) {
  const content = normalize(getRecallResultText(result));
  if (content)
    return `content:${content}`;
  return result.id ? `id:${result.id}` : "";
}
function score(result) {
  return [result.similarity, result.score].find((value) => typeof value === "number" && Number.isFinite(value)) ?? -1;
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
    if (scoreDiff !== 0)
      return scoreDiff;
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
function mergeProfileResponses(responses, limit) {
  const successful = responses.filter((response) => response.success && response.profile);
  if (successful.length === 0) {
    return {
      success: false,
      error: responses.find((response) => response.error)?.error || "All memory profiles failed",
      profile: null
    };
  }
  const staticFacts = dedupe(successful.flatMap((response) => response.profile?.static ?? []), (fact) => fact);
  const staticKeys = new Set(staticFacts.map(normalize));
  const dynamicFacts = dedupe(successful.flatMap((response) => response.profile?.dynamic ?? []), (fact) => fact).filter((fact) => !staticKeys.has(normalize(fact)));
  const mergedSearch = mergeSearchResponses(successful.map((response) => ({
    success: true,
    results: response.searchResults?.results ?? [],
    total: response.searchResults?.total ?? 0,
    timing: response.searchResults?.timing
  })), limit);
  return {
    success: true,
    profile: { static: staticFacts, dynamic: dynamicFacts },
    searchResults: mergedSearch.results && mergedSearch.results.length > 0 ? {
      results: mergedSearch.results,
      total: mergedSearch.total ?? mergedSearch.results.length,
      timing: mergedSearch.timing
    } : undefined
  };
}
function listKey(memory) {
  const content = normalize(memory.summary ?? memory.content ?? memory.title);
  if (content)
    return `content:${content}`;
  return memory.id ? `id:${memory.id}` : "";
}
function listTimestamp(memory) {
  const timestamp = memory.updatedAt ?? memory.createdAt;
  return timestamp ? Date.parse(timestamp) : 0;
}
function mergeListResponses(responses, limit) {
  const successful = responses.filter((response) => response.success);
  if (successful.length === 0) {
    return {
      success: false,
      error: responses.find((response) => response.error)?.error || "All memory lists failed",
      memories: [],
      pagination: { currentPage: 1, totalItems: 0, totalPages: 0 }
    };
  }
  const memories = dedupe(successful.flatMap((response) => response.memories ?? []).sort((a, b) => listTimestamp(b) - listTimestamp(a)), listKey).slice(0, limit);
  return {
    success: true,
    memories,
    pagination: {
      currentPage: 1,
      totalItems: memories.length,
      totalPages: memories.length > 0 ? 1 : 0
    }
  };
}

// src/services/client.ts
var TIMEOUT_MS = 30000;
var TIMEOUT_BACKSTOP_GRACE_MS = 250;
var SETTINGS_UPDATE_TIMEOUT_MS = 3000;
var MAX_CONVERSATION_CHARS = 1e5;
var OPENCODE_SOURCE = "opencode";
function getScopeFilters(scope) {
  return {
    AND: [{ key: "sm_scope", value: scope, filterType: "metadata" }]
  };
}
function supportsScopedCanonicalTag(containerTag) {
  return /^repo_.+__[0-9a-f]{16}$/i.test(containerTag);
}
function isNotFoundError(error) {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}
function isAuthorizationError(error) {
  return typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403);
}
function withTimeout(promise, ms) {
  let id;
  const timeout = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}

class SupermemoryClient {
  client = null;
  formatConversationMessage(message) {
    const content = typeof message.content === "string" ? message.content : message.content.map((part) => part.type === "text" ? part.text : `[image] ${part.imageUrl.url}`).join(`
`);
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return `[${message.role}]`;
    }
    return `[${message.role}] ${trimmed}`;
  }
  formatConversationTranscript(messages) {
    return messages.map((message, idx) => `${idx + 1}. ${this.formatConversationMessage(message)}`).join(`
`);
  }
  getClient() {
    if (!this.client) {
      if (!isConfigured()) {
        throw new Error("SUPERMEMORY_API_KEY not set");
      }
      this.client = new Supermemory({
        apiKey: SUPERMEMORY_API_KEY,
        baseURL: getApiBaseUrl(),
        defaultHeaders: { "x-sm-source": OPENCODE_SOURCE }
      });
      try {
        this.client.settings.update({
          shouldLLMFilter: true,
          filterPrompt: CONFIG.filterPrompt
        }, { timeout: SETTINGS_UPDATE_TIMEOUT_MS, maxRetries: 0 }).catch((error) => {
          log("settings.update: best-effort update failed", {
            error: error instanceof Error ? error.message : String(error)
          });
        });
      } catch (error) {
        log("settings.update: best-effort update failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return this.client;
  }
  async searchMemories(query, containerTag, scope, options) {
    log("searchMemories: start", { containerTag, scope });
    try {
      const hookTimeout = options?.timeoutMs;
      const result = await withTimeout(this.getClient().search.memories({
        q: query,
        containerTag,
        threshold: CONFIG.similarityThreshold,
        limit: CONFIG.maxMemories,
        searchMode: "hybrid",
        filters: scope ? getScopeFilters(scope) : undefined
      }, hookTimeout ? { timeout: hookTimeout, maxRetries: 0 } : undefined), hookTimeout ? hookTimeout + TIMEOUT_BACKSTOP_GRACE_MS : TIMEOUT_MS);
      const results = result.results.map((item) => ({
        ...item,
        containerTag
      }));
      log("searchMemories: success", { count: results.length });
      return {
        success: true,
        results,
        total: result.total,
        timing: result.timing
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("searchMemories: error", { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
        results: [],
        total: 0,
        timing: 0
      };
    }
  }
  async searchMemoriesMany(query, containerTags, options) {
    const uniqueTags = [...new Set(containerTags.filter(Boolean))];
    const responses = await Promise.all(uniqueTags.map((containerTag) => this.searchMemories(query, containerTag, undefined, options)));
    return mergeSearchResponses(responses, CONFIG.maxMemories);
  }
  async searchMemoriesScoped(query, canonicalTag, containerTags, scope, options) {
    const legacyTags = [
      ...new Set(containerTags.filter((tag) => tag && tag !== canonicalTag))
    ];
    const responses = await Promise.all([
      this.searchMemories(query, canonicalTag, supportsScopedCanonicalTag(canonicalTag) ? scope : undefined, options),
      ...legacyTags.map((containerTag) => this.searchMemories(query, containerTag, undefined, options))
    ]);
    return mergeSearchResponses(responses, CONFIG.maxMemories);
  }
  async searchMemoriesForRecall(query, canonicalTag, personalTags, projectTags, options) {
    const responses = await Promise.all([
      this.searchMemoriesScoped(query, canonicalTag, personalTags, "personal", options),
      this.searchMemoriesScoped(query, canonicalTag, projectTags, "project", options)
    ]);
    return mergeSearchResponses(responses, CONFIG.maxMemories);
  }
  async getProfile(containerTag, query, scope, options) {
    log("getProfile: start", { containerTag, scope });
    try {
      const hookTimeout = options?.timeoutMs;
      const result = await withTimeout(this.getClient().profile({
        containerTag,
        q: query,
        filters: scope ? getScopeFilters(scope) : undefined
      }, hookTimeout ? { timeout: hookTimeout, maxRetries: 0 } : undefined), hookTimeout ? hookTimeout + TIMEOUT_BACKSTOP_GRACE_MS : TIMEOUT_MS);
      const searchResults = result.searchResults ? {
        results: result.searchResults.results.map((item) => ({
          ...item,
          containerTag
        })),
        total: result.searchResults.total,
        timing: result.searchResults.timing
      } : undefined;
      log("getProfile: success", { hasProfile: !!result.profile });
      return {
        success: true,
        profile: {
          static: result.profile?.static ?? [],
          dynamic: result.profile?.dynamic ?? []
        },
        searchResults
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("getProfile: error", { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
        profile: null
      };
    }
  }
  async getProfileMany(containerTags, query, options) {
    const uniqueTags = [...new Set(containerTags.filter(Boolean))];
    const responses = await Promise.all(uniqueTags.map((containerTag) => this.getProfile(containerTag, query, undefined, options)));
    return mergeProfileResponses(responses, CONFIG.maxMemories);
  }
  async getProfileScoped(canonicalTag, containerTags, scope, query, options) {
    const legacyTags = [
      ...new Set(containerTags.filter((tag) => tag && tag !== canonicalTag))
    ];
    const responses = await Promise.all([
      this.getProfile(canonicalTag, query, supportsScopedCanonicalTag(canonicalTag) ? scope : undefined, options),
      ...legacyTags.map((containerTag) => this.getProfile(containerTag, query, undefined, options))
    ]);
    return mergeProfileResponses(responses, CONFIG.maxMemories);
  }
  async addMemory(content, containerTag, metadata, options) {
    log("addMemory: start", {
      containerTag,
      contentLength: content.length,
      customId: options?.customId,
      hasEntityContext: !!options?.entityContext
    });
    try {
      const requestTimeout = options?.timeoutMs;
      const mergedMetadata = Object.fromEntries(Object.entries({
        sm_source: OPENCODE_SOURCE,
        sm_client: OPENCODE_SOURCE,
        sm_plugin_version: PLUGIN_VERSION,
        sm_capture_mode: metadata?.sm_capture_mode ?? "tool",
        ...metadata ?? {}
      }).filter(([, value]) => value !== undefined));
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
      const result = await withTimeout(this.getClient().memories.add(payload, requestTimeout ? { timeout: requestTimeout, maxRetries: 0 } : undefined), requestTimeout ? requestTimeout + TIMEOUT_BACKSTOP_GRACE_MS : TIMEOUT_MS);
      log("addMemory: success", { id: result.id });
      return { success: true, ...result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("addMemory: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }
  async deleteMemory(memoryId, containerTags = []) {
    log("deleteMemory: start", { memoryId });
    const uniqueTags = [...new Set(containerTags.filter(Boolean))];
    let retainedAuthorizationError;
    for (const [index, containerTag] of uniqueTags.entries()) {
      try {
        await withTimeout(this.getClient().memories.forget({ id: memoryId, containerTag }), TIMEOUT_MS);
        log("deleteMemory: forgotten", { memoryId });
        return { success: true };
      } catch (error) {
        if (isNotFoundError(error))
          continue;
        if (index > 0 && isAuthorizationError(error)) {
          retainedAuthorizationError ??= error;
          continue;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        log("deleteMemory: forget error", { memoryId, error: errorMessage });
        return { success: false, error: errorMessage };
      }
    }
    try {
      await withTimeout(this.getClient().memories.delete(memoryId), TIMEOUT_MS);
      log("deleteMemory: deleted document", { memoryId });
      return { success: true };
    } catch (error) {
      const errorToReturn = isNotFoundError(error) && retainedAuthorizationError !== undefined ? retainedAuthorizationError : error;
      const errorMessage = errorToReturn instanceof Error ? errorToReturn.message : String(errorToReturn);
      log("deleteMemory: error", { memoryId, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }
  async listMemories(containerTag, limit = 20, scope) {
    log("listMemories: start", { containerTag, limit, scope });
    try {
      const result = await withTimeout(this.getClient().memories.list({
        containerTags: [containerTag],
        filters: scope ? getScopeFilters(scope) : undefined,
        limit,
        order: "desc",
        sort: "createdAt",
        includeContent: true
      }), TIMEOUT_MS);
      const memories = result.memories;
      log("listMemories: success", { count: memories.length });
      return {
        success: true,
        memories,
        pagination: result.pagination
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("listMemories: error", { error: errorMessage });
      return {
        success: false,
        error: errorMessage,
        memories: [],
        pagination: { currentPage: 1, totalItems: 0, totalPages: 0 }
      };
    }
  }
  async listMemoriesMany(containerTags, limit = 20) {
    const uniqueTags = [...new Set(containerTags.filter(Boolean))];
    const responses = await Promise.all(uniqueTags.map((containerTag) => this.listMemories(containerTag, limit)));
    return mergeListResponses(responses, limit);
  }
  async listMemoriesScoped(canonicalTag, containerTags, scope, limit = 20) {
    const legacyTags = [
      ...new Set(containerTags.filter((tag) => tag && tag !== canonicalTag))
    ];
    const responses = await Promise.all([
      this.listMemories(canonicalTag, limit, supportsScopedCanonicalTag(canonicalTag) ? scope : undefined),
      ...legacyTags.map((containerTag) => this.listMemories(containerTag, limit))
    ]);
    return mergeListResponses(responses, limit);
  }
  async ingestConversation(conversationId, messages, containerTags, metadata, options) {
    log("ingestConversation: start", {
      conversationId,
      messageCount: messages.length,
      containerTags
    });
    if (messages.length === 0) {
      return { success: false, error: "No messages to ingest" };
    }
    const uniqueTags = [
      ...new Set(containerTags)
    ].filter((tag) => tag.length > 0);
    if (uniqueTags.length === 0) {
      return {
        success: false,
        error: "At least one containerTag is required"
      };
    }
    const transcript = this.formatConversationTranscript(messages);
    const rawContent = `[Conversation ${conversationId}]
${transcript}`;
    const content = rawContent.length > MAX_CONVERSATION_CHARS ? `${rawContent.slice(0, MAX_CONVERSATION_CHARS)}
...[truncated]` : rawContent;
    const ingestMetadata = {
      type: "conversation",
      conversationId,
      messageCount: messages.length,
      originalContainerTags: uniqueTags,
      ...metadata
    };
    const savedIds = [];
    let firstError = null;
    for (const tag of uniqueTags) {
      const entityContext = options?.entityContextByContainerTag?.[tag] ?? options?.defaultEntityContext;
      const customId = options?.customId && uniqueTags.length > 1 ? `${options.customId}:${tag}` : options?.customId;
      const result = await this.addMemory(content, tag, ingestMetadata, {
        ...entityContext ? { entityContext } : {},
        ...customId ? { customId } : {},
        ...options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}
      });
      if (result.success) {
        savedIds.push(result.id);
      } else if (!firstError) {
        firstError = result.error || "Failed to store conversation";
      }
    }
    if (savedIds.length === 0) {
      log("ingestConversation: error", {
        conversationId,
        error: firstError
      });
      return {
        success: false,
        error: firstError || "Failed to ingest conversation"
      };
    }
    const status = savedIds.length === uniqueTags.length ? "stored" : "partial";
    const response = {
      id: savedIds[0],
      conversationId,
      status
    };
    log("ingestConversation: success", {
      conversationId,
      status,
      storedCount: savedIds.length,
      requestedCount: uniqueTags.length
    });
    return {
      success: true,
      ...response,
      storedMemoryIds: savedIds
    };
  }
}
var supermemoryClient = new SupermemoryClient;

// src/services/entity-context.ts
var AGENT_ENTITY_CONTEXT = `Shared coding-agent memory for one software repository.

RULES:
- Remember what a human teammate would remember: decisions, lessons, preferences, and durable project knowledge
- Preserve context that helps Claude Code, Codex, OpenCode, or Cursor continue the work later
- Condense assistant responses into decisions, outcomes, and reusable knowledge
- Keep user preferences and project facts concise and independently understandable
- Prefer why a choice was made and what was learned over mechanical progress updates

EXTRACT:
- User preferences, accepted decisions, durable workflows, outcomes, and lessons learned
- Architecture: "uses monorepo with turborepo", "API in /apps/api"
- Conventions: "components in PascalCase", "hooks prefixed with use"
- Patterns: "all API routes use withAuth wrapper", "errors thrown as ApiError"
- Setup: "requires .env with DATABASE_URL", "run pnpm db:migrate first"
- Decisions: "chose Drizzle over Prisma for performance", "using RSC for data fetching"

SKIP:
- Generic assistant suggestions the user did not accept
- Transient repository state Git already tracks: current branch or commit, uncommitted files and diffs, and in-flight commit, push, or PR status
- Transient command output and low-value implementation chatter
- Granular details that do not help future work`;

// src/services/privacy.ts
function stripPrivateContent(content) {
  return content.replace(/<private>[\s\S]*?<\/private>/gi, "[REDACTED]");
}
function isFullyPrivate(content) {
  const stripped = stripPrivateContent(content).trim();
  return stripped === "[REDACTED]" || stripped === "";
}

// src/services/capture.ts
var AUTOMATIC_CAPTURE_TIMEOUT_MS = 3000;
function extractText(parts) {
  const text = (parts ?? []).filter((part) => part.type === "text" && part.synthetic !== true && part.ignored !== true && typeof part.text === "string").map((part) => part.text).join(`
`).trim();
  if (!text || isFullyPrivate(text))
    return "";
  return stripPrivateContent(text).trim();
}
function isFinalAssistantMessage(info) {
  return info.role === "assistant" && info.summary !== true && typeof info.finish === "string" && info.finish.length > 0 && info.finish !== "tool-calls";
}
function buildCaptureTurns(messages) {
  const turns = [];
  let current;
  const finishCurrent = () => {
    if (current?.complete) {
      turns.push({
        id: current.id,
        messages: current.fullyPrivate ? [] : current.messages
      });
    }
    current = undefined;
  };
  for (const message of messages) {
    const { info } = message;
    if (info.role === "user") {
      finishCurrent();
      const rawText = (message.parts ?? []).filter((part) => part.type === "text" && part.synthetic !== true && part.ignored !== true && typeof part.text === "string").map((part) => part.text).join(`
`).trim();
      const text = extractText(message.parts);
      current = {
        id: info.id,
        messages: text ? [{ role: "user", content: text }] : [],
        fullyPrivate: rawText.length > 0 && isFullyPrivate(rawText),
        complete: false
      };
      continue;
    }
    if (!current || info.role !== "assistant" || info.summary === true) {
      continue;
    }
    const text = extractText(message.parts);
    if (text && !current.fullyPrivate) {
      current.messages.push({ role: "assistant", content: text });
    }
    if (isFinalAssistantMessage(info)) {
      current.complete = true;
    }
  }
  finishCurrent();
  return turns;
}
function buildCadenceBatches(turns, captureEveryNTurns) {
  if (captureEveryNTurns <= 0)
    return [];
  const batches = [];
  const completeBatchCount = Math.floor(turns.length / captureEveryNTurns);
  for (let index = 0;index < completeBatchCount; index += 1) {
    const start = index * captureEveryNTurns;
    const end = start + captureEveryNTurns;
    batches.push({
      startTurn: start + 1,
      endTurn: end,
      turns: turns.slice(start, end)
    });
  }
  return batches;
}
function buildSessionEndBatch(turns, captureEveryNTurns) {
  if (turns.length === 0)
    return null;
  const remainder = captureEveryNTurns > 0 ? turns.length % captureEveryNTurns : turns.length;
  if (remainder === 0)
    return null;
  const start = turns.length - remainder;
  return {
    startTurn: start + 1,
    endTurn: turns.length,
    turns: turns.slice(start)
  };
}
function getCaptureId(sessionID, batch) {
  const firstTurn = batch.turns[0]?.id ?? String(batch.startTurn);
  const lastTurn = batch.turns.at(-1)?.id ?? String(batch.endTurn);
  const fingerprint = `${sessionID}:${firstTurn}:${lastTurn}`;
  const digest = createHash("sha256").update(fingerprint).digest("hex");
  return `opencode:capture:${digest}`;
}
function createCaptureHook(ctx, tags, options) {
  const captureEveryNTurns = options?.captureEveryNTurns ?? CONFIG.captureEveryNTurns;
  const memoryClient = options?.memoryClient ?? supermemoryClient;
  const snapshots = new Map;
  const activeSessions = new Set;
  const completedCaptureIds = new Set;
  const inFlight = new Map;
  async function refreshSnapshot(sessionID) {
    const response = await ctx.client.session.messages({
      path: { id: sessionID },
      query: { directory: ctx.directory }
    });
    if (!Array.isArray(response) && !response.data) {
      throw new Error(`Unable to read OpenCode session ${sessionID}`);
    }
    const rawMessages = Array.isArray(response) ? response : response.data ?? [];
    const turns = buildCaptureTurns(rawMessages);
    snapshots.set(sessionID, turns);
    activeSessions.add(sessionID);
    return turns;
  }
  async function saveBatch(sessionID, batch, reason) {
    const captureId = getCaptureId(sessionID, batch);
    if (completedCaptureIds.has(captureId))
      return true;
    const messages = batch.turns.flatMap((turn) => turn.messages);
    if (messages.length === 0) {
      completedCaptureIds.add(captureId);
      return true;
    }
    let result;
    try {
      result = await memoryClient.ingestConversation(`${sessionID}:${batch.startTurn}-${batch.endTurn}`, messages, [tags.canonical], {
        project: tags.projectName,
        sm_project_id: tags.projectId,
        sm_scope: "personal",
        sm_capture_mode: "automatic",
        captureReason: reason,
        sessionId: sessionID,
        turnStart: batch.startTurn,
        turnEnd: batch.endTurn
      }, {
        defaultEntityContext: AGENT_ENTITY_CONTEXT,
        customId: captureId,
        timeoutMs: AUTOMATIC_CAPTURE_TIMEOUT_MS
      });
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    if (result.success) {
      completedCaptureIds.add(captureId);
      options?.onSaved?.();
      log("[capture] conversation batch saved", {
        sessionID,
        reason,
        startTurn: batch.startTurn,
        endTurn: batch.endTurn
      });
      return true;
    }
    log("[capture] failed to save conversation batch", {
      sessionID,
      reason,
      startTurn: batch.startTurn,
      endTurn: batch.endTurn,
      error: result.error
    });
    return false;
  }
  async function captureCadence(sessionID, turns) {
    let complete = true;
    for (const batch of buildCadenceBatches(turns, captureEveryNTurns)) {
      if (!await saveBatch(sessionID, batch, "cadence")) {
        complete = false;
      }
    }
    return complete;
  }
  async function captureSessionEnd(sessionID) {
    let turns = snapshots.get(sessionID);
    if (!turns) {
      try {
        turns = await refreshSnapshot(sessionID);
      } catch (error) {
        log("[capture] failed to read terminal session", {
          sessionID,
          error: String(error)
        });
        return false;
      }
    }
    const cadenceComplete = await captureCadence(sessionID, turns);
    const finalBatch = buildSessionEndBatch(turns, captureEveryNTurns);
    const finalComplete = finalBatch ? await saveBatch(sessionID, finalBatch, "session_end") : true;
    return cadenceComplete && finalComplete;
  }
  async function runExclusive(sessionID, task) {
    const previous = inFlight.get(sessionID) ?? Promise.resolve();
    const next = previous.catch(() => {
      return;
    }).then(task);
    inFlight.set(sessionID, next);
    try {
      await next;
    } finally {
      if (inFlight.get(sessionID) === next) {
        inFlight.delete(sessionID);
      }
    }
  }
  return {
    async event({ event }) {
      const props = event.properties;
      if (event.type === "message.updated") {
        const info = props?.info;
        if (info?.sessionID)
          activeSessions.add(info.sessionID);
        return;
      }
      if (event.type === "session.idle") {
        const sessionID = props?.sessionID;
        if (!sessionID)
          return;
        activeSessions.add(sessionID);
        await runExclusive(sessionID, async () => {
          try {
            const turns = await refreshSnapshot(sessionID);
            await captureCadence(sessionID, turns);
          } catch (error) {
            log("[capture] failed to process idle session", {
              sessionID,
              error: String(error)
            });
          }
        });
        return;
      }
      if (event.type === "session.deleted") {
        const sessionInfo = props?.info;
        const sessionID = sessionInfo?.id;
        if (!sessionID)
          return;
        activeSessions.add(sessionID);
        await runExclusive(sessionID, async () => {
          if (await captureSessionEnd(sessionID)) {
            snapshots.delete(sessionID);
            activeSessions.delete(sessionID);
          }
        });
        return;
      }
      if (event.type === "server.instance.disposed") {
        await Promise.all([...activeSessions].map((sessionID) => runExclusive(sessionID, async () => {
          if (await captureSessionEnd(sessionID)) {
            snapshots.delete(sessionID);
            activeSessions.delete(sessionID);
          }
        })));
      }
    }
  };
}

// src/services/compaction-prompt.ts
var COMPACTION_CONTEXT_MARKER = "[SUPERMEMORY COMPACTION CONTEXT]";
var MAX_COMPACTION_MEMORY_CHARS = 12000;
var MAX_SINGLE_MEMORY_CHARS = 2000;
function fitProjectMemories(memories) {
  const result = [];
  const seen = new Set;
  let remaining = MAX_COMPACTION_MEMORY_CHARS;
  for (const rawMemory of memories) {
    const normalized = rawMemory.trim();
    if (!normalized || seen.has(normalized) || remaining <= 0)
      continue;
    seen.add(normalized);
    const memory = normalized.slice(0, Math.min(MAX_SINGLE_MEMORY_CHARS, remaining));
    result.push(memory);
    remaining -= memory.length;
  }
  return result;
}
function createCompactionPrompt(projectMemories) {
  const memoriesSection = projectMemories.length > 0 ? `
## Project Knowledge (from Supermemory)
The following project-specific knowledge should be preserved and referenced in the summary:
${projectMemories.map((memory) => `- ${memory}`).join(`
`)}
` : "";
  return `${COMPACTION_CONTEXT_MARKER}

When summarizing this session, you MUST include the following sections in your summary:

## 1. User Requests (As-Is)
- List all original user requests exactly as they were stated
- Preserve the user's exact wording and intent

## 2. Final Goal
- What the user ultimately wanted to achieve
- The end result or deliverable expected

## 3. Work Completed
- What has been done so far
- Files created/modified
- Features implemented
- Problems solved

## 4. Remaining Tasks
- What still needs to be done
- Pending items from the original request
- Follow-up tasks identified during the work

## 5. MUST NOT Do (Critical Constraints)
- Things that were explicitly forbidden
- Approaches that failed and should not be retried
- User's explicit restrictions or preferences
- Anti-patterns identified during the session
${memoriesSection}
This context is critical for maintaining continuity after compaction.
`;
}

// src/services/context.ts
function extractFactText(fact) {
  if (typeof fact === "string")
    return fact;
  if (fact != null && typeof fact === "object") {
    const content = fact.content;
    if (typeof content === "string")
      return content;
    return JSON.stringify(fact);
  }
  return String(fact ?? "");
}
function selectInjectedProfileFacts(profile, maxItems) {
  if (!profile?.profile) {
    return { static: [], dynamic: [] };
  }
  return {
    static: profile.profile.static.slice(0, maxItems).map(extractFactText).filter(Boolean),
    dynamic: profile.profile.dynamic.slice(0, maxItems).map(extractFactText).filter(Boolean)
  };
}
function getInjectedProfileFactTexts(profile, maxItems = CONFIG.maxProfileItems) {
  const facts = selectInjectedProfileFacts(profile, maxItems);
  return [...facts.static, ...facts.dynamic];
}
function formatContextForPrompt(profile, userMemories, projectMemories) {
  const parts = [
    "[SUPERMEMORY]",
    'Every line marked ◪ comes from supermemory. When one shapes your answer, credit it naturally with the ◪ prefix; if you name the source, say "from supermemory".'
  ];
  const profileFacts = CONFIG.injectProfile ? selectInjectedProfileFacts(profile, CONFIG.maxProfileItems) : { static: [], dynamic: [] };
  if (profileFacts.static.length > 0) {
    parts.push(`
User Profile:`);
    profileFacts.static.forEach((fact) => {
      parts.push(`- ◪ ${fact}`);
    });
  }
  if (profileFacts.dynamic.length > 0) {
    parts.push(`
Recent Context:`);
    profileFacts.dynamic.forEach((fact) => {
      parts.push(`- ◪ ${fact}`);
    });
  }
  const projectResults = normalizeRecallResults(projectMemories.results || []);
  if (projectResults.length > 0) {
    parts.push(`
Project Knowledge:`);
    projectResults.forEach((hit) => {
      const score = hit.similarity === undefined ? "" : ` [${Math.round(hit.similarity * 100)}%]`;
      parts.push(`- ◪${score} ${formatRecallHit(hit)}`);
    });
  }
  const userResults = normalizeRecallResults(userMemories.results || []);
  if (userResults.length > 0) {
    parts.push(`
Relevant Memories:`);
    userResults.forEach((hit) => {
      const score = hit.similarity === undefined ? "" : ` [${Math.round(hit.similarity * 100)}%]`;
      parts.push(`- ◪${score} ${formatRecallHit(hit)}`);
    });
  }
  if (parts.length === 2) {
    return "";
  }
  return parts.join(`
`);
}

// src/services/memory-tool.ts
var SUPERMEMORY_TOOL_DESCRIPTION = "Manage and query the Supermemory persistent memory system. Use 'search' to find relevant memories, 'add' to store new knowledge, 'profile' to view user profile, 'list' to see recent memories, 'forget' to remove a memory.";
var SUPERMEMORY_RECALL_TOOL_DESCRIPTION = "Search saved Supermemory context for this repository and user. This least-privilege helper only accepts search operations.";
var MEMORY_TOOL_MODES = [
  "add",
  "search",
  "profile",
  "list",
  "forget",
  "help"
];
var MEMORY_TOOL_TYPES = [
  "project-config",
  "architecture",
  "error-solution",
  "preference",
  "learned-pattern",
  "conversation"
];
var MEMORY_TOOL_SCOPES = ["user", "project"];
async function executeSupermemoryTool(args, tags, options = {}) {
  const memoryClient = options.memoryClient ?? supermemoryClient;
  const configured = options.configured ?? isConfigured();
  if (!configured) {
    return JSON.stringify({
      success: false,
      error: "SUPERMEMORY_API_KEY not set. Set it in your environment to use Supermemory."
    });
  }
  const mode = args.mode || "help";
  try {
    switch (mode) {
      case "help": {
        return JSON.stringify({
          success: true,
          message: "Supermemory Usage Guide",
          commands: [
            {
              command: "add",
              description: "Store a new memory",
              args: ["content", "type?", "scope?"]
            },
            {
              command: "search",
              description: "Search memories",
              args: ["query", "scope?"]
            },
            {
              command: "profile",
              description: "View user profile",
              args: ["query?"]
            },
            {
              command: "list",
              description: "List recent memories",
              args: ["scope?", "limit?"]
            },
            {
              command: "forget",
              description: "Remove a memory",
              args: ["memoryId", "scope?"]
            }
          ],
          scopes: {
            user: "Personal preferences and knowledge for this project",
            project: "Project-specific knowledge (default)"
          },
          types: [...MEMORY_TOOL_TYPES]
        });
      }
      case "add": {
        if (!args.content) {
          return JSON.stringify({
            success: false,
            error: "content parameter is required for add mode"
          });
        }
        const sanitizedContent = stripPrivateContent(args.content);
        if (isFullyPrivate(args.content)) {
          return JSON.stringify({
            success: false,
            error: "Cannot store fully private content"
          });
        }
        const scope = args.scope || "project";
        const internalScope = scope === "user" ? "personal" : "project";
        const result = await memoryClient.addMemory(sanitizedContent, tags.canonical, {
          type: args.type,
          project: tags.projectName,
          sm_project_id: tags.projectId,
          sm_scope: internalScope,
          sm_capture_mode: "tool"
        }, { entityContext: AGENT_ENTITY_CONTEXT });
        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error || "Failed to add memory"
          });
        }
        options.onSaved?.();
        return JSON.stringify({
          success: true,
          message: `Memory added to ${scope} scope`,
          id: result.id,
          scope,
          type: args.type
        });
      }
      case "search": {
        if (!args.query) {
          return JSON.stringify({
            success: false,
            error: "query parameter is required for search mode"
          });
        }
        const scope = args.scope;
        if (scope === "user") {
          const result = await memoryClient.searchMemoriesScoped(args.query, tags.canonical, tags.personalReads, "personal");
          if (!result.success) {
            return JSON.stringify({
              success: false,
              error: result.error || "Failed to search memories"
            });
          }
          return formatSearchResults(args.query, scope, result, args.limit);
        }
        if (scope === "project") {
          const result = await memoryClient.searchMemoriesScoped(args.query, tags.canonical, tags.projectReads, "project");
          if (!result.success) {
            return JSON.stringify({
              success: false,
              error: result.error || "Failed to search memories"
            });
          }
          return formatSearchResults(args.query, scope, result, args.limit);
        }
        const result = await memoryClient.searchMemoriesMany(args.query, tags.allReads);
        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error || "Failed to search memories"
          });
        }
        return formatSearchResults(args.query, undefined, result, args.limit);
      }
      case "profile": {
        const result = await memoryClient.getProfileScoped(tags.canonical, tags.personalReads, "personal", args.query);
        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error || "Failed to fetch profile"
          });
        }
        return JSON.stringify({
          success: true,
          profile: {
            static: result.profile?.static || [],
            dynamic: result.profile?.dynamic || []
          }
        });
      }
      case "list": {
        const scope = args.scope || "project";
        const limit = args.limit || 20;
        const internalScope = scope === "user" ? "personal" : "project";
        const readTags = scope === "user" ? tags.personalReads : tags.projectReads;
        const result = await memoryClient.listMemoriesScoped(tags.canonical, readTags, internalScope, limit);
        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error || "Failed to list memories"
          });
        }
        const memories = result.memories || [];
        return JSON.stringify({
          success: true,
          scope,
          count: memories.length,
          memories: memories.map((memory) => ({
            id: memory.id,
            content: memory.summary,
            createdAt: memory.createdAt,
            metadata: memory.metadata
          }))
        });
      }
      case "forget": {
        if (!args.memoryId) {
          return JSON.stringify({
            success: false,
            error: "memoryId parameter is required for forget mode"
          });
        }
        const scope = args.scope || "project";
        const readTags = scope === "user" ? tags.personalReads : scope === "project" ? tags.projectReads : tags.allReads;
        const result = await memoryClient.deleteMemory(args.memoryId, [
          tags.canonical,
          ...readTags
        ]);
        if (!result.success) {
          return JSON.stringify({
            success: false,
            error: result.error || "Failed to delete memory"
          });
        }
        return JSON.stringify({
          success: true,
          message: `Memory ${args.memoryId} removed from ${scope} scope`
        });
      }
      default:
        return JSON.stringify({
          success: false,
          error: `Unknown mode: ${mode}`
        });
    }
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
function formatSearchResults(query, scope, results, limit) {
  const memoryResults = (results.results || []).map((result) => normalizeRecallResult(result)).filter((hit) => hit !== null).slice(0, limit ?? 10);
  return JSON.stringify({
    success: true,
    query,
    scope,
    count: memoryResults.length,
    results: memoryResults.map((hit) => {
      const r = hit.result;
      const result = {
        content: formatRecallHit(hit),
        ...hit.similarity === undefined ? {} : { similarity: Math.round(hit.similarity * 100) },
        ...hit.title ? { title: hit.title } : {},
        ...hit.filepath ? { filepath: hit.filepath } : {}
      };
      return r.memory === undefined ? { ...result, forgettable: false } : { id: r.id, ...result, forgettable: true };
    })
  });
}

// src/services/opencode-permissions.ts
var RECALL_PERMISSION = {
  action: "supermemory_recall",
  resource: "*",
  effect: "allow"
};

// src/services/recall.ts
import { createHash as createHash2 } from "node:crypto";
var DIRECT_RECALL_TIMEOUT_MS = 3000;
var MAX_RECALL_QUERY_CHARS = 500;
var MAX_SESSION_RECALL_HASHES = 500;
var DEFAULT_RECALL_DIRECTIVE = `<supermemory-recall>
Before responding, silently decide whether recalling saved memory (past sessions, decisions, conventions, the user's preferences) would materially improve your answer to THIS message. Reason first — don't search reflexively, and don't narrate the decision.

Recall — by calling the \`supermemory\` tool with \`mode: "search"\` — when the message:
- refers to earlier work or decisions ("the auth flow", "like we did", "continue", "the bug from before")
- touches an area where saved conventions, patterns, or preferences likely exist
- is ambiguous in a way past context would resolve

Skip recall when the message is self-contained, trivial, a greeting/meta, fully answerable from the current conversation, or you already recalled the relevant context this session and the topic hasn't shifted.

Cadence is per-message: it's fine to recall on several turns in a row, and fine to never recall in a session. When you do recall, run it before answering and fold the results into your response.
</supermemory-recall>`;
var RECALL_DEBUG_SUFFIX = `<recall-debug>
DEBUG MODE: Begin your reply with exactly one line, then continue normally:
[recall-decision] yes|no — <short reason>
"yes" means you are recalling saved Supermemory memory (via the \`supermemory\` tool with \`mode: "search"\`) for THIS message; "no" means you are skipping it.
</recall-debug>`;
function buildRecallDirective() {
  const { directive } = getRecallConfig();
  let text = directive || DEFAULT_RECALL_DIRECTIVE;
  if (process.env.SUPERMEMORY_DEBUG) {
    text += `

${RECALL_DEBUG_SUFFIX}`;
  }
  return text;
}
function prepareRecallQuery(prompt) {
  const trimmed = prompt.trim();
  if (trimmed.length < 12 || /^[\/#\!]/.test(trimmed))
    return null;
  return trimmed.slice(0, MAX_RECALL_QUERY_CHARS);
}
function recallTextHash(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash2("sha256").update(normalized).digest("hex");
}
function recallHash(hit) {
  return recallTextHash(getRecallResultText(hit.result));
}

class RecallSessionCache {
  maxHashes;
  sessions = new Map;
  constructor(maxHashes = MAX_SESSION_RECALL_HASHES) {
    this.maxHashes = maxHashes;
  }
  getState(sessionID) {
    let state = this.sessions.get(sessionID);
    if (!state) {
      state = { seen: new Set, order: [] };
      this.sessions.set(sessionID, state);
    }
    return state;
  }
  rememberHash(state, hash) {
    if (state.seen.has(hash))
      return false;
    state.seen.add(hash);
    state.order.push(hash);
    while (state.order.length > Math.max(1, this.maxHashes)) {
      const oldest = state.order.shift();
      if (oldest)
        state.seen.delete(oldest);
    }
    return true;
  }
  rememberTexts(sessionID, texts) {
    const state = this.getState(sessionID);
    for (const text of texts) {
      const trimmed = text.trim();
      if (trimmed)
        this.rememberHash(state, recallTextHash(trimmed));
    }
  }
  takeFresh(sessionID, hits) {
    const state = this.getState(sessionID);
    return hits.filter((hit) => this.rememberHash(state, recallHash(hit)));
  }
  delete(sessionID) {
    this.sessions.delete(sessionID);
  }
  clear() {
    this.sessions.clear();
  }
}
function formatDirectRecallContext(hits) {
  return [
    "<supermemory-context>",
    "Relevant memories automatically recalled for this prompt. Every line marked ◪ comes from supermemory:",
    ...hits.map((hit) => `- ◪ ${formatRecallHit(hit)}`),
    'When one shapes your answer, credit it naturally with the ◪ prefix; if you name the source, say "from supermemory".',
    "Use these memories only when relevant. Search Supermemory for deeper context if needed.",
    "</supermemory-context>"
  ].join(`
`);
}
async function buildDirectRecallResult(options) {
  try {
    const query = prepareRecallQuery(options.prompt);
    const searchPromise = query ? Promise.resolve().then(() => options.search(query)).catch(() => null) : null;
    if (options.suppressTexts) {
      options.cache.rememberTexts(options.sessionID, await options.suppressTexts);
    }
    if (!query) {
      return { context: "", status: "skipped", count: 0, tokens: 0 };
    }
    const response = await searchPromise;
    if (!response?.success) {
      return { context: "", status: "unavailable", count: 0, tokens: 0 };
    }
    const hits = normalizeRecallResults(response.results ?? []);
    const freshHits = options.cache.takeFresh(options.sessionID, hits);
    if (freshHits.length === 0) {
      return { context: "", status: "empty", count: 0, tokens: 0 };
    }
    const context = formatDirectRecallContext(freshHits);
    return {
      context,
      status: "recalled",
      count: freshHits.length,
      tokens: Math.round(context.length / 4)
    };
  } catch {
    return { context: "", status: "unavailable", count: 0, tokens: 0 };
  }
}

// src/services/tags.ts
import { createHash as createHash3 } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync as existsSync3, readFileSync as readFileSync3, realpathSync } from "node:fs";
import { hostname as hostname2, homedir as homedir4, userInfo } from "node:os";
import { basename, dirname, join as join4, resolve, sep } from "node:path";
function sha256(input) {
  return createHash3("sha256").update(input).digest("hex").slice(0, 16);
}
var repoInfoCache = new Map;
function getGitRoot(directory) {
  const isolateWorktrees = process.env.SUPERMEMORY_ISOLATE_WORKTREES === "true";
  try {
    if (isolateWorktrees) {
      const gitRoot = execSync("git rev-parse --show-toplevel", {
        cwd: directory,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      return gitRoot || null;
    }
    const gitCommonDir = execSync("git rev-parse --git-common-dir", {
      cwd: directory,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    if (gitCommonDir === ".git") {
      const gitRoot = execSync("git rev-parse --show-toplevel", {
        cwd: directory,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      return gitRoot || null;
    }
    const resolved = resolve(directory, gitCommonDir);
    if (basename(resolved) === ".git" && !resolved.includes(`${sep}.git${sep}`)) {
      return dirname(resolved);
    }
    const gitRoot = execSync("git rev-parse --show-toplevel", {
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
  return getGitRoot(directory) || resolve(directory);
}
function getGitEmail(directory) {
  try {
    const email = execSync("git config user.email", {
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
  if (!raw)
    return null;
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
    normalized = scpStyle?.[1] && scpStyle[2] ? `${scpStyle[1].toLowerCase()}/${scpStyle[2]}` : `file:${resolve(raw)}`;
  }
  return normalized.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/{2,}/g, "/").toLowerCase();
}
function getGitRepoInfo(directory) {
  const cached = repoInfoCache.get(directory);
  if (cached)
    return cached;
  try {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd: directory,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    const normalizedRemote = normalizeGitRemote(remoteUrl);
    const displayRemote = remoteUrl.replace(/\/+$/, "").replace(/\.git$/i, "");
    const separator = Math.max(displayRemote.lastIndexOf("/"), displayRemote.lastIndexOf(":"));
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
    const configPath = join4(getProjectBasePath(directory), ".claude", ".supermemory-claude", "config.json");
    if (!existsSync3(configPath))
      return null;
    return JSON.parse(readFileSync3(configPath, "utf-8"));
  } catch {
    return null;
  }
}
function loadCodexConfig() {
  try {
    const configPath = join4(homedir4(), ".codex", "supermemory.json");
    if (!existsSync3(configPath))
      return null;
    return JSON.parse(readFileSync3(configPath, "utf-8"));
  } catch {
    return null;
  }
}
function loadLegacyCursorConfig(directory) {
  let globalConfig = null;
  try {
    const configPath = join4(homedir4(), ".config", "cursor", "supermemory.json");
    if (existsSync3(configPath)) {
      globalConfig = JSON.parse(readFileSync3(configPath, "utf-8"));
    }
  } catch {}
  let projectConfig = null;
  let current = resolve(directory);
  while (true) {
    try {
      const configPath = join4(current, ".cursor", ".supermemory", "config.json");
      if (existsSync3(configPath)) {
        projectConfig = JSON.parse(readFileSync3(configPath, "utf-8"));
        break;
      }
    } catch {}
    const parent = dirname(current);
    if (parent === current)
      break;
    current = parent;
  }
  return { ...globalConfig ?? {}, ...projectConfig ?? {} };
}
function sanitizeRepoName(name) {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return sanitized.slice(0, 95).replace(/_+$/g, "") || "unknown";
}
function getProjectIdentity(directory) {
  const basePath = getProjectBasePath(directory);
  const { normalizedRemote } = getGitRepoInfo(basePath);
  const isolateWorktrees = process.env.SUPERMEMORY_ISOLATE_WORKTREES === "true";
  let localIdentity = basePath;
  try {
    localIdentity = realpathSync.native(basePath);
  } catch {}
  return sha256(!isolateWorktrees && normalizedRemote ? normalizedRemote : `path:${localIdentity}`);
}
function getGeneratedProjectTag(directory) {
  const basePath = getProjectBasePath(directory);
  const repoName = getGitRepoName(basePath) || basename(basePath) || "unknown";
  const shortName = sanitizeRepoName(repoName).slice(0, 72).replace(/_+$/g, "");
  return `repo_${shortName || "unknown"}__${getProjectIdentity(directory)}`;
}
function getLegacyGeneratedProjectTag(directory) {
  const basePath = getProjectBasePath(directory);
  const repoName = getGitRepoName(basePath) || basename(basePath) || "unknown";
  return `repo_${sanitizeRepoName(repoName)}`;
}
function getProjectTag(directory) {
  return loadClaudeProjectConfig(directory)?.repoContainerTag || process.env.SUPERMEMORY_REPO_TAG || loadLegacyCursorConfig(directory).repoContainerTag || CONFIG.projectContainerTag || loadCodexConfig()?.projectContainerTag || getGeneratedProjectTag(directory);
}
function getProjectName(directory) {
  const basePath = getProjectBasePath(directory);
  return getGitRepoName(basePath) || basename(basePath) || "unknown";
}
function getLegacyClaudePersonalTags(directory) {
  const projectHash = sha256(getProjectBasePath(directory));
  const claudeConfig = loadClaudeProjectConfig(directory);
  return uniqueTags([
    claudeConfig?.personalContainerTag,
    `user_project_${projectHash}`,
    `claudecode_project_${projectHash}`
  ]);
}
function getLegacyCodexUserTags(directory) {
  const config = loadCodexConfig();
  const identity = getGitEmail(directory) || process.env.USER || process.env.USERNAME || hostname2();
  const hash = sha256(identity);
  return uniqueTags([
    config?.userContainerTag,
    `${config?.containerTagPrefix || "codex"}_user_${hash}`,
    `codex_user_${hash}`
  ]);
}
function getLegacyCodexProjectTags(directory) {
  const config = loadCodexConfig();
  const projectHash = sha256(getProjectBasePath(directory));
  return uniqueTags([
    config?.projectContainerTag,
    `${config?.containerTagPrefix || "codex"}_project_${projectHash}`,
    `codex_project_${projectHash}`
  ]);
}
function getLegacyOpenCodeUserTags(directory) {
  const identity = getGitEmail(directory) || process.env.USER || process.env.USERNAME || "anonymous";
  const hash = sha256(identity);
  return uniqueTags([
    CONFIG.userContainerTag,
    `${CONFIG.containerTagPrefix}_user_${hash}`,
    `opencode_user_${hash}`
  ]);
}
function getLegacyOpenCodeProjectTags(directory) {
  const directoryHashes = uniqueTags([
    sha256(directory),
    sha256(resolve(directory)),
    sha256(getProjectBasePath(directory))
  ]);
  return uniqueTags([
    CONFIG.projectContainerTag,
    ...directoryHashes.flatMap((hash) => [
      `${CONFIG.containerTagPrefix}_project_${hash}`,
      `opencode_project_${hash}`
    ])
  ]);
}
function getLegacyCursorUserTags(directory) {
  const config = loadLegacyCursorConfig(directory);
  const identity = config.userContainerTag || process.env.SUPERMEMORY_USER_TAG || process.env.CURSOR_USER_EMAIL || getGitEmail(directory) || `${hostname2()}_${userInfo().username}`;
  return [`cursor_user_${sha256(identity)}`];
}
function getLegacyCursorProjectTags(directory) {
  const config = loadLegacyCursorConfig(directory);
  const identity = config.projectContainerTag || process.env.SUPERMEMORY_PROJECT_TAG || getProjectBasePath(directory);
  return [`cursor_project_${sha256(identity)}`];
}
function uniqueTags(tags) {
  return [
    ...new Set(tags.filter((tag) => typeof tag === "string" && tag.trim().length > 0))
  ];
}
function getPersonalReadTags(directory) {
  return uniqueTags([
    getProjectTag(directory),
    getGeneratedProjectTag(directory),
    ...getLegacyClaudePersonalTags(directory),
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

// src/services/version-check.ts
var NPM_REGISTRY_URL = "https://registry.npmjs.org";
var CHECK_TIMEOUT_MS = 3000;
function parseVersion(version) {
  const normalized = version.trim().replace(/^v/i, "");
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match)
    return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null
  };
}
function isVersionNewer(latestVersion, currentVersion) {
  const latest = parseVersion(latestVersion);
  const current = parseVersion(currentVersion);
  if (!latest || !current)
    return latestVersion !== currentVersion;
  for (let i = 0;i < 3; i++) {
    const latestPart = latest.parts[i] ?? 0;
    const currentPart = current.parts[i] ?? 0;
    if (latestPart > currentPart)
      return true;
    if (latestPart < currentPart)
      return false;
  }
  if (!latest.prerelease && current.prerelease)
    return true;
  if (latest.prerelease && !current.prerelease)
    return false;
  return latest.prerelease !== current.prerelease && latest.prerelease !== null;
}
async function checkNpmUpdate(packageName, currentVersion, updateCommand) {
  const controller = new AbortController;
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const encodedPackage = packageName.startsWith("@") ? packageName.replace("/", "%2F") : encodeURIComponent(packageName);
    const response = await fetch(`${NPM_REGISTRY_URL}/${encodedPackage}/latest`, {
      signal: controller.signal
    });
    if (!response.ok)
      return null;
    const data = await response.json();
    const latestVersion = typeof data.version === "string" ? data.version : null;
    if (!latestVersion || !isVersionNewer(latestVersion, currentVersion))
      return null;
    return { currentVersion, latestVersion, updateCommand };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// src/rpc.ts
var SUPERMEMORY_RPC_ID = "supermemory";
var SUPERMEMORY_ACTIVITY_EVENT = `rpc.${SUPERMEMORY_RPC_ID}.activity`;
var SUPERMEMORY_RPC = {
  id: SUPERMEMORY_RPC_ID,
  methods: {},
  events: {
    activity: {
      schema: {
        type: "object",
        properties: {
          kind: { type: "string" },
          title: { type: "string" },
          message: { type: "string" },
          variant: {
            type: "string",
            enum: ["info", "success", "warning", "error"]
          },
          duration: { type: "number" }
        },
        required: ["kind", "title", "message", "variant", "duration"],
        additionalProperties: false
      }
    }
  }
};
function isSupermemoryActivityEvent(value) {
  if (!value || typeof value !== "object")
    return false;
  const data = value;
  return typeof data.message === "string" && typeof data.title === "string" && typeof data.variant === "string" && typeof data.duration === "number";
}

// src/v2/runtime.ts
var CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
var INLINE_CODE_PATTERN = /`[^`]+`/g;
var SYNTHETIC_METADATA_KEY = "supermemory";
var UPDATE_COMMAND = "bunx opencode-supermemory@latest install";
var MAX_DISPATCHES_PER_SESSION = 8;
var MIN_SUMMARY_CHARS = 100;
var SUPERMEMORY_TOOL_NAME = "supermemory";
var SUPERMEMORY_RECALL_TOOL_NAME = "supermemory_recall";
var MEMORY_NUDGE_MESSAGE = `[MEMORY TRIGGER DETECTED]
The user wants you to remember something. You MUST use the \`supermemory\` tool with \`mode: "add"\` to save this information.

Extract the key information the user wants remembered and save it as a concise, searchable memory.
- Use \`scope: "project"\` for project-specific preferences (e.g., "run lint with tests")
- Use \`scope: "user"\` for personal preferences in this project (e.g., "prefers concise responses")
- Choose an appropriate \`type\`: "preference", "project-config", "learned-pattern", etc.

DO NOT skip this step. The user explicitly asked you to remember.`;
var SUPERMEMORY_TOOL_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: [...MEMORY_TOOL_MODES] },
    content: { type: "string" },
    query: { type: "string" },
    type: { type: "string", enum: [...MEMORY_TOOL_TYPES] },
    scope: { type: "string", enum: [...MEMORY_TOOL_SCOPES] },
    memoryId: { type: "string" },
    limit: { type: "number" }
  }
};
var SUPERMEMORY_RECALL_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["search"] },
    query: { type: "string" },
    scope: { type: "string", enum: [...MEMORY_TOOL_SCOPES] },
    limit: { type: "number" }
  },
  required: ["query"]
};
var DEFAULT_DEPENDENCIES = {
  configured: isConfigured(),
  config: CONFIG,
  memoryClient: supermemoryClient,
  executeTool: executeSupermemoryTool,
  resolveTags: getTags,
  logger: log,
  checkUpdate: () => checkNpmUpdate("opencode-supermemory", PLUGIN_VERSION, UPDATE_COMMAND)
};
function mergeDependencies(overrides) {
  return {
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
    config: { ...DEFAULT_DEPENDENCIES.config, ...overrides?.config }
  };
}
function sha2562(value) {
  return createHash4("sha256").update(value).digest("hex");
}
function removeCodeBlocks(text) {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}
function detectMemoryKeyword(text, patterns = CONFIG.keywordPatterns) {
  if (patterns.length === 0)
    return false;
  return new RegExp(`\\b(${patterns.join("|")})\\b`, "i").test(removeCodeBlocks(text));
}
function buildV2RecallDirective(directive = buildRecallDirective()) {
  return directive.replaceAll(`\`${SUPERMEMORY_TOOL_NAME}\` tool with \`mode: "search"\``, `\`${SUPERMEMORY_RECALL_TOOL_NAME}\` tool`);
}
function isSyntheticPart(part) {
  if (!part || typeof part !== "object")
    return false;
  const metadata = part.metadata;
  return Boolean(metadata?.[SYNTHETIC_METADATA_KEY]);
}
function extractMessageText(message) {
  return message.content.filter((part) => Boolean(part) && typeof part === "object" && part.type === "text" && typeof part.text === "string" && !isSyntheticPart(part)).map((part) => part.text).join(`
`).trim();
}
function makeSyntheticPart(text, kind) {
  return {
    type: "text",
    text,
    metadata: { [SYNTHETIC_METADATA_KEY]: kind }
  };
}
function applyInjection(messages, message, injection) {
  if (injection.start.length === 0 && injection.end.length === 0)
    return;
  if (message.content.some(isSyntheticPart))
    return;
  const start = injection.start.map((text) => makeSyntheticPart(text, "context"));
  const end = injection.end.map((text) => makeSyntheticPart(text, "recall"));
  try {
    const content = message.content;
    content.unshift(...start);
    content.push(...end);
  } catch {
    const index = messages.indexOf(message);
    if (index < 0)
      return;
    const copy = Object.assign(Object.create(Object.getPrototypeOf(message)), message, { content: [...start, ...message.content, ...end] });
    messages[index] = copy;
  }
}
function sanitizeCaptureText(text) {
  if (!text || isFullyPrivate(text))
    return "";
  return stripPrivateContent(text).trim();
}
function isFinalAssistant(message) {
  return typeof message.finish === "string" && message.finish.length > 0 && message.finish !== "tool-calls";
}
function assistantText(message) {
  return (message.content ?? []).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join(`
`).trim();
}
function buildTranscriptTurns(messages) {
  const turns = [];
  let current;
  const finish = () => {
    if (current?.complete) {
      turns.push({
        id: current.id,
        messages: current.fullyPrivate ? [] : current.messages
      });
    }
    current = undefined;
  };
  for (const message of messages) {
    if (message.type === "user") {
      finish();
      const rawText = (message.text ?? "").trim();
      const text = sanitizeCaptureText(rawText);
      current = {
        id: message.id,
        messages: text ? [{ role: "user", content: text }] : [],
        fullyPrivate: rawText.length > 0 && isFullyPrivate(rawText),
        complete: false
      };
      continue;
    }
    if (!current || message.type !== "assistant")
      continue;
    const text = sanitizeCaptureText(assistantText(message));
    if (text && !current.fullyPrivate) {
      current.messages.push({ role: "assistant", content: text });
    }
    if (isFinalAssistant(message))
      current.complete = true;
  }
  finish();
  return turns;
}
function mergeTurns(existing, index, incoming) {
  for (const turn of incoming) {
    const position = index.get(turn.id);
    if (position === undefined) {
      index.set(turn.id, existing.length);
      existing.push(turn);
    } else {
      existing[position] = turn;
    }
  }
  return existing;
}

class EventDeduper {
  #limit;
  #seen = new Set;
  #order = [];
  constructor(limit = 4096) {
    this.#limit = Math.max(1, limit);
  }
  hasSeen(id) {
    if (!id)
      return false;
    if (this.#seen.has(id))
      return true;
    this.#seen.add(id);
    this.#order.push(id);
    if (this.#order.length > this.#limit) {
      const oldest = this.#order.shift();
      if (oldest)
        this.#seen.delete(oldest);
    }
    return false;
  }
}
function toolResultText(content) {
  if (typeof content === "string")
    return content;
  if (Array.isArray(content)) {
    return content.filter((part) => Boolean(part) && typeof part === "object" && part.type === "text" && typeof part.text === "string").map((part) => part.text).join(`
`);
  }
  return "";
}

class V2Runtime {
  #ctx;
  #deps;
  #isOwner;
  #states = new Map;
  #recall = new RecallSessionCache;
  #captureInFlight = new Map;
  #pendingSummaries = new Map;
  #summaryInFlight = new Set;
  #deduper = new EventDeduper;
  #registrations = [];
  #abortController = new AbortController;
  #emitActivity;
  #activity;
  #active = true;
  constructor(ctx, options, isOwner = () => true) {
    this.#ctx = ctx;
    this.#deps = mergeDependencies(options);
    this.#isOwner = isOwner;
    this.#activity = createMemoryActivityReporterFromSink((notice) => {
      this.#deps.logger("[activity]", { kind: notice.kind, message: notice.message });
      this.#emitActivity?.(notice);
    });
  }
  get active() {
    return this.#active && this.#isOwner();
  }
  get trackedSessionCount() {
    return this.#states.size;
  }
  async register() {
    const { logger } = this.#deps;
    await this.#track(this.#ctx.tool.transform((editor) => {
      editor.add({
        name: SUPERMEMORY_TOOL_NAME,
        description: SUPERMEMORY_TOOL_DESCRIPTION,
        input: SUPERMEMORY_TOOL_INPUT,
        options: { codemode: false, permission: SUPERMEMORY_TOOL_NAME },
        execute: async (input, context) => {
          if (!this.active)
            return { content: this.#inactiveToolResult() };
          return {
            content: await this.executeTool(input, context.sessionID)
          };
        }
      });
      editor.add({
        name: SUPERMEMORY_RECALL_TOOL_NAME,
        description: SUPERMEMORY_RECALL_TOOL_DESCRIPTION,
        input: SUPERMEMORY_RECALL_INPUT,
        options: { codemode: false, permission: RECALL_PERMISSION.action },
        execute: async (input, context) => {
          if (!this.active)
            return { content: this.#inactiveToolResult() };
          return {
            content: await this.executeRecallTool(input, context.sessionID)
          };
        }
      });
    }));
    if (!this.active)
      return;
    if (!this.#deps.configured) {
      logger("v2 plugin disabled - SUPERMEMORY_API_KEY not set (tools registered, hooks skipped)");
      return;
    }
    await this.#track(this.#ctx.session.hook("context", async (event) => {
      if (!this.active)
        return;
      await this.handleContext(event);
    }));
    if (!this.active)
      return;
    await this.#track(this.#ctx.session.hook("compaction", async (event) => {
      if (!this.active)
        return;
      await this.handleCompaction(event);
    }));
    if (!this.active)
      return;
    await this.#track(this.#ctx.permission.hook("evaluate", (event) => {
      if (!this.active)
        return;
      if (event.action === RECALL_PERMISSION.action && event.effect === "ask") {
        event.effect = "allow";
      }
    }));
    if (!this.active)
      return;
    await this.#track(this.#ctx.tool.hook("execute.before", (event) => {
      if (!this.active)
        return;
      this.handleToolBefore(event.tool, event.input);
    }));
    await this.#track(this.#ctx.tool.hook("execute.after", (event) => {
      if (!this.active)
        return;
      if (event.status !== "completed")
        return;
      this.handleToolAfter(event.tool, toolResultText(event.result.content));
    }));
    if (!this.active)
      return;
    try {
      const rpc = await this.#ctx.rpc.register(SUPERMEMORY_RPC, {});
      this.#registrations.push(rpc);
      this.#emitActivity = (notice) => {
        rpc.events.emit("activity", {
          kind: notice.kind,
          title: notice.title,
          message: notice.message,
          variant: notice.variant,
          duration: notice.duration
        }).catch((error) => {
          logger("[activity] unable to emit notice", { error: String(error) });
        });
      };
    } catch (error) {
      logger("[activity] RPC unavailable; notices are log-only", {
        error: String(error)
      });
    }
    if (this.active)
      this.#startEventSubscription();
    logger("v2 plugin registered", {
      tools: [SUPERMEMORY_TOOL_NAME, SUPERMEMORY_RECALL_TOOL_NAME],
      hooks: ["session.context", "session.compaction", "permission.evaluate", "tool.execute"],
      activity: this.#emitActivity ? "rpc" : "log-only",
      recallMode: this.#deps.config.recallMode,
      captureEveryNTurns: this.#deps.config.captureEveryNTurns,
      compactionEnabled: this.#deps.config.compactionEnabled
    });
  }
  async executeTool(args, sessionID) {
    try {
      const tags = await this.#resolveSession(sessionID);
      return await this.#deps.executeTool(args, tags, {
        memoryClient: this.#deps.memoryClient,
        configured: this.#deps.configured,
        onSaved: () => this.#activity.saved()
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  async executeRecallTool(args, sessionID) {
    if (args.mode && args.mode !== "search") {
      return JSON.stringify({
        success: false,
        error: `${SUPERMEMORY_RECALL_TOOL_NAME} only supports search mode`
      });
    }
    return this.executeTool({ ...args, mode: "search" }, sessionID);
  }
  handleToolBefore(tool, input) {
    const args = input ?? {};
    const isRecall = tool === SUPERMEMORY_RECALL_TOOL_NAME || tool === SUPERMEMORY_TOOL_NAME && args.mode === "search";
    if (!isRecall)
      return;
    this.#activity.recalling(typeof args.query === "string" ? args.query : undefined);
  }
  handleToolAfter(tool, output) {
    if (tool !== SUPERMEMORY_TOOL_NAME && tool !== SUPERMEMORY_RECALL_TOOL_NAME) {
      return;
    }
    try {
      const result = JSON.parse(output);
      if (!result.success || result.query === undefined)
        return;
      const count = result.count ?? result.results?.length;
      if (typeof count === "number" && count > 0) {
        this.#activity.recalled(count, Math.round(output.length / 4));
      }
    } catch {}
  }
  async handleContext(event) {
    if (!this.#deps.configured)
      return;
    const latestUser = event.messages.findLast((message) => message.role === "user");
    if (!latestUser)
      return;
    const userText = extractMessageText(latestUser);
    if (!userText)
      return;
    const state = this.#state(event.sessionID);
    const key = this.#dispatchKey(event.messages, latestUser, userText);
    let pending = state.dispatches.get(key);
    if (!pending) {
      pending = this.#buildInjection(event.sessionID, state, userText).catch((error) => {
        this.#deps.logger("v2 context injection failed", {
          sessionID: event.sessionID,
          error: String(error)
        });
        return { start: [], end: [] };
      });
      state.dispatches.set(key, pending);
      state.dispatchOrder.push(key);
      while (state.dispatchOrder.length > MAX_DISPATCHES_PER_SESSION) {
        const oldest = state.dispatchOrder.shift();
        if (oldest)
          state.dispatches.delete(oldest);
      }
    }
    applyInjection(event.messages, latestUser, await pending);
  }
  async handleCompaction(event) {
    if (!this.#deps.configured || !this.#deps.config.compactionEnabled)
      return;
    const memories = await this.#projectMemories(event.sessionID);
    event.system.push({ type: "text", text: createCompactionPrompt(memories) });
    this.#deps.logger("v2 compaction context injected", {
      sessionID: event.sessionID,
      memoriesCount: memories.length
    });
  }
  async handleEvent(event) {
    if (!this.active || this.#deduper.hasSeen(event.id))
      return;
    const sessionID = this.#eventSessionID(event);
    if (sessionID && event.type !== "session.compaction.ended") {
      this.#retryPendingSummaries(sessionID);
    }
    switch (event.type) {
      case "session.execution.succeeded": {
        if (!sessionID)
          return;
        this.#runCaptureExclusive(sessionID, () => this.#captureCadence(sessionID));
        return;
      }
      case "session.execution.interrupted": {
        if (!sessionID || event.data?.reason !== "shutdown")
          return;
        if (!this.#states.has(sessionID))
          return;
        this.#runCaptureExclusive(sessionID, () => this.#captureSessionEnd(sessionID));
        return;
      }
      case "session.deleted": {
        if (!sessionID)
          return;
        const state = this.#states.get(sessionID);
        this.#recall.delete(sessionID);
        if (!state)
          return;
        await this.#runCaptureExclusive(sessionID, () => this.#captureSessionEnd(sessionID));
        this.#states.delete(sessionID);
        return;
      }
      case "session.compaction.ended": {
        if (!sessionID || !this.#deps.config.compactionEnabled)
          return;
        const text = String(event.data?.text ?? "").trim();
        if (!text)
          return;
        if (text.length < MIN_SUMMARY_CHARS) {
          this.#deps.logger("v2 compaction summary too short to save", {
            sessionID,
            length: text.length
          });
          return;
        }
        const eventId = event.id ?? sha2562(`${sessionID}:${text}`);
        const customId = `opencode:compaction:${sha2562(`${sessionID}:${eventId}`)}`;
        this.#pendingSummaries.set(customId, { customId, sessionID, text });
        await this.#retryPendingSummaries(sessionID);
        return;
      }
      case "global.disposed": {
        await this.#flushAll();
        this.#states.clear();
        this.#recall.clear();
        return;
      }
    }
  }
  async idle() {
    while (this.#captureInFlight.size > 0 || this.#summaryInFlight.size > 0) {
      await Promise.allSettled([...this.#captureInFlight.values()]);
      if (this.#summaryInFlight.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  }
  cleanup() {
    if (!this.#active)
      return;
    this.#active = false;
    this.#abortController.abort();
    this.#flushAll(true).catch((error) => {
      this.#deps.logger("v2 cleanup capture failed", { error: String(error) });
    });
    this.#states.clear();
    this.#recall.clear();
    for (const registration of this.#registrations.splice(0)) {
      this.#disposeRegistration(registration);
    }
  }
  async#track(pending) {
    const registration = await pending;
    if (!this.active) {
      this.#disposeRegistration(registration);
      return;
    }
    this.#registrations.push(registration);
  }
  #state(sessionID) {
    const existing = this.#states.get(sessionID);
    if (existing)
      return existing;
    const state = {
      injectedInitialContext: false,
      dispatches: new Map,
      dispatchOrder: [],
      turns: [],
      turnIndex: new Map,
      completedCaptureIds: new Set
    };
    this.#states.set(sessionID, state);
    return state;
  }
  #inactiveToolResult() {
    return JSON.stringify({
      success: false,
      error: "This Supermemory plugin instance has been replaced; retry the call."
    });
  }
  #disposeRegistration(registration) {
    try {
      registration.dispose().catch((error) => {
        this.#deps.logger("v2 registration cleanup failed", {
          error: String(error)
        });
      });
    } catch (error) {
      this.#deps.logger("v2 registration cleanup failed", {
        error: String(error)
      });
    }
  }
  #dispatchKey(messages, latestUser, text) {
    const id = latestUser.id;
    if (id)
      return id;
    const userCount = messages.filter((message) => message.role === "user").length;
    return `dispatch:${userCount}:${sha2562(text)}`;
  }
  async#resolveSession(sessionID) {
    const state = this.#state(sessionID);
    if (state.tags)
      return state.tags;
    if (state.resolving)
      return state.resolving;
    state.resolving = (async () => {
      let directory;
      try {
        const session = await this.#ctx.session.get({ sessionID });
        directory = session.location?.directory;
      } catch (error) {
        this.#deps.logger("v2 session lookup failed; using plugin location", {
          sessionID,
          error: String(error)
        });
      }
      directory ??= this.#ctx.location?.directory;
      if (!directory) {
        throw new Error(`Unable to resolve directory for OpenCode session ${sessionID}`);
      }
      state.directory = directory;
      state.tags = this.#deps.resolveTags(directory);
      return state.tags;
    })();
    try {
      return await state.resolving;
    } finally {
      state.resolving = undefined;
    }
  }
  async#buildInjection(sessionID, state, userText) {
    const { config, memoryClient } = this.#deps;
    const start = [];
    const end = [];
    const isFirstMessage = !state.injectedInitialContext;
    state.injectedInitialContext = true;
    if (detectMemoryKeyword(userText, config.keywordPatterns)) {
      end.push(MEMORY_NUDGE_MESSAGE);
    }
    if (config.recallMode === "advisory")
      end.push(buildV2RecallDirective());
    let tags;
    try {
      tags = await this.#resolveSession(sessionID);
    } catch (error) {
      this.#deps.logger("v2 context skipped; no session directory", {
        sessionID,
        error: String(error)
      });
      return { start, end };
    }
    const profileRequest = isFirstMessage && config.recallMode !== "off" && config.injectProfile ? memoryClient.getProfileScoped(tags.canonical, tags.personalReads, "personal", undefined, {
      timeoutMs: DIRECT_RECALL_TIMEOUT_MS
    }).catch(() => null) : Promise.resolve(null);
    const skipped = {
      context: "",
      status: "skipped",
      count: 0,
      tokens: 0
    };
    const directRecall = config.recallMode === "direct" ? buildDirectRecallResult({
      prompt: userText,
      sessionID,
      cache: this.#recall,
      search: (query) => memoryClient.searchMemoriesForRecall(query, tags.canonical, tags.personalReads, tags.projectReads, { timeoutMs: DIRECT_RECALL_TIMEOUT_MS }),
      suppressTexts: isFirstMessage ? profileRequest.then((result) => result?.success && result.profile ? getInjectedProfileFactTexts(result) : []) : undefined
    }) : Promise.resolve(skipped);
    const firstMessage = isFirstMessage ? profileRequest.then((result) => result?.success ? formatContextForPrompt(result, { results: [] }, { results: [] }) : "") : Promise.resolve("");
    const updateCheck = isFirstMessage ? this.#deps.checkUpdate().catch(() => null) : Promise.resolve(null);
    const [recall, firstMessageContext, updateInfo] = await Promise.all([
      directRecall,
      firstMessage,
      updateCheck
    ]);
    if (recall.status === "recalled") {
      this.#activity.recalled(recall.count, recall.tokens);
    } else if (recall.status === "unavailable") {
      this.#activity.recallUnavailable();
    }
    if (updateInfo)
      this.#activity.updateAvailable(updateInfo);
    if (firstMessageContext)
      start.push(firstMessageContext);
    if (recall.context)
      end.push(recall.context);
    this.#deps.logger("v2 context prepared", {
      sessionID,
      firstMessage: isFirstMessage,
      firstMessageContextLength: firstMessageContext.length,
      directRecallContextLength: recall.context.length
    });
    return { start, end };
  }
  async#projectMemories(sessionID) {
    try {
      const tags = await this.#resolveSession(sessionID);
      const result = await this.#deps.memoryClient.listMemoriesScoped(tags.canonical, tags.projectReads, "project", this.#deps.config.maxProjectMemories);
      return fitProjectMemories((result.memories ?? []).map((memory) => memory.summary || memory.content || "").filter((memory) => Boolean(memory)));
    } catch (error) {
      this.#deps.logger("v2 compaction project-memory lookup failed", {
        sessionID,
        error: String(error)
      });
      return [];
    }
  }
  async#refreshTurns(sessionID, state) {
    try {
      const messages = await this.#ctx.session.context({ sessionID });
      if (Array.isArray(messages)) {
        mergeTurns(state.turns, state.turnIndex, buildTranscriptTurns(messages));
      }
    } catch (error) {
      this.#deps.logger("v2 capture transcript read failed; using cached turns", {
        sessionID,
        error: String(error)
      });
    }
    return state.turns;
  }
  async#saveBatch(sessionID, state, batch, reason) {
    const captureId = getCaptureId(sessionID, batch);
    if (state.completedCaptureIds.has(captureId))
      return true;
    const messages = batch.turns.flatMap((turn) => turn.messages);
    if (messages.length === 0) {
      state.completedCaptureIds.add(captureId);
      return true;
    }
    let result;
    try {
      const tags = await this.#resolveSession(sessionID);
      result = await this.#deps.memoryClient.ingestConversation(`${sessionID}:${batch.startTurn}-${batch.endTurn}`, messages, [tags.canonical], {
        project: tags.projectName,
        sm_project_id: tags.projectId,
        sm_scope: "personal",
        sm_capture_mode: "automatic",
        captureReason: reason,
        sessionId: sessionID,
        turnStart: batch.startTurn,
        turnEnd: batch.endTurn
      }, {
        defaultEntityContext: AGENT_ENTITY_CONTEXT,
        customId: captureId,
        timeoutMs: AUTOMATIC_CAPTURE_TIMEOUT_MS
      });
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    if (result.success) {
      state.completedCaptureIds.add(captureId);
      this.#activity.saved();
      this.#deps.logger("[capture] conversation batch saved", {
        sessionID,
        reason,
        startTurn: batch.startTurn,
        endTurn: batch.endTurn
      });
      return true;
    }
    this.#deps.logger("[capture] failed to save conversation batch", {
      sessionID,
      reason,
      startTurn: batch.startTurn,
      endTurn: batch.endTurn,
      error: result.error
    });
    return false;
  }
  async#captureCadence(sessionID) {
    const state = this.#state(sessionID);
    const turns = await this.#refreshTurns(sessionID, state);
    for (const batch of buildCadenceBatches(turns, this.#deps.config.captureEveryNTurns)) {
      await this.#saveBatch(sessionID, state, batch, "cadence");
    }
  }
  async#captureSessionEnd(sessionID) {
    const state = this.#state(sessionID);
    const turns = await this.#refreshTurns(sessionID, state);
    for (const batch of buildCadenceBatches(turns, this.#deps.config.captureEveryNTurns)) {
      await this.#saveBatch(sessionID, state, batch, "cadence");
    }
    const finalBatch = buildSessionEndBatch(turns, this.#deps.config.captureEveryNTurns);
    if (finalBatch) {
      await this.#saveBatch(sessionID, state, finalBatch, "session_end");
    }
  }
  async#flushAll(allowInactive = false) {
    const sessions = [...this.#states.keys()];
    const pending = new Set([...this.#pendingSummaries.values()].map((item) => item.sessionID));
    await Promise.all([
      ...sessions.map((sessionID) => this.#runCaptureExclusive(sessionID, () => this.#captureSessionEnd(sessionID))),
      ...[...pending].map((sessionID) => this.#retryPendingSummaries(sessionID, allowInactive))
    ]);
  }
  async#runCaptureExclusive(sessionID, task) {
    const previous = this.#captureInFlight.get(sessionID) ?? Promise.resolve();
    const next = previous.catch(() => {
      return;
    }).then(task);
    this.#captureInFlight.set(sessionID, next);
    try {
      await next;
    } catch (error) {
      this.#deps.logger("[capture] background capture failed", {
        sessionID,
        error: String(error)
      });
    } finally {
      if (this.#captureInFlight.get(sessionID) === next) {
        this.#captureInFlight.delete(sessionID);
      }
    }
  }
  async#retryPendingSummaries(sessionID, allowInactive = false) {
    if (!allowInactive && !this.active)
      return;
    const pending = [...this.#pendingSummaries.values()].filter((item) => item.sessionID === sessionID);
    if (pending.length === 0)
      return;
    let tags;
    try {
      tags = await this.#resolveSession(sessionID);
    } catch (error) {
      this.#deps.logger("v2 compaction summary retry deferred", {
        sessionID,
        error: String(error)
      });
      return;
    }
    for (const summary of pending) {
      if (this.#summaryInFlight.has(summary.customId))
        continue;
      this.#summaryInFlight.add(summary.customId);
      try {
        const result = await this.#deps.memoryClient.addMemory(`[Session Summary]
${summary.text}`, tags.canonical, {
          type: "conversation",
          project: tags.projectName,
          sm_project_id: tags.projectId,
          sm_scope: "personal",
          sm_capture_mode: "compaction",
          sessionId: sessionID
        }, {
          customId: summary.customId,
          entityContext: AGENT_ENTITY_CONTEXT,
          timeoutMs: AUTOMATIC_CAPTURE_TIMEOUT_MS
        });
        if (result.success) {
          this.#pendingSummaries.delete(summary.customId);
          this.#activity.saved();
          this.#deps.logger("[compaction] summary saved as memory", {
            sessionID,
            memoryId: result.id
          });
        } else {
          this.#deps.logger("[compaction] failed to save summary", {
            sessionID,
            error: result.error
          });
        }
      } catch (error) {
        this.#deps.logger("[compaction] failed to save summary", {
          sessionID,
          error: String(error)
        });
      } finally {
        this.#summaryInFlight.delete(summary.customId);
      }
    }
  }
  #eventSessionID(event) {
    const sessionID = event.data?.sessionID;
    return typeof sessionID === "string" && sessionID ? sessionID : undefined;
  }
  #startEventSubscription() {
    const events = this.#ctx.event.subscribe({
      signal: this.#abortController.signal
    });
    (async () => {
      try {
        for await (const event of events) {
          if (!this.active)
            return;
          try {
            await this.handleEvent(event);
          } catch (error) {
            this.#deps.logger("v2 event handling failed", {
              type: event.type,
              error: String(error)
            });
          }
        }
      } catch (error) {
        if (this.active) {
          this.#deps.logger("v2 event subscription failed", {
            error: String(error)
          });
        }
      }
    })();
  }
}
var OWNER_KEY = Symbol.for("opencode-supermemory.v2.owner");
function ownerRegistry() {
  return globalThis;
}
async function setupV2(ctx, options) {
  const registry = ownerRegistry();
  const previous = registry[OWNER_KEY];
  previous?.cleanup();
  const owner = {
    generation: (previous?.generation ?? 0) + 1,
    cleanup: () => {
      return;
    }
  };
  registry[OWNER_KEY] = owner;
  const runtime = new V2Runtime(ctx, options, () => registry[OWNER_KEY] === owner);
  const cleanup = () => {
    runtime.cleanup();
    if (registry[OWNER_KEY] === owner)
      delete registry[OWNER_KEY];
  };
  owner.cleanup = cleanup;
  log("v2 plugin init", {
    generation: owner.generation,
    directory: ctx.location?.directory,
    configured: runtime["active"] && (options?.configured ?? isConfigured())
  });
  try {
    await runtime.register();
  } catch (error) {
    cleanup();
    throw error;
  }
  return cleanup;
}

// src/server.ts
var plugin = {
  id: "supermemory",
  setup: (context) => setupV2(context)
};
var server_default = plugin;
export {
  server_default as default
};
