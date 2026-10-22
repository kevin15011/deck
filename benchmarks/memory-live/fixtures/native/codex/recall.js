#!/usr/bin/env node
"use strict";

// src/hooks/recall.ts
var import_node_fs6 = require("node:fs");

// src/config.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var import_node_os2 = require("node:os");

// src/services/auth.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_os = require("node:os");
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

// src/services/tags.ts
var import_node_crypto = require("node:crypto");
var import_node_child_process = require("node:child_process");
var import_node_fs3 = require("node:fs");
var import_node_os3 = require("node:os");
var import_node_path3 = require("node:path");
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
    const resolved = (0, import_node_path3.resolve)(directory, gitCommonDir);
    if ((0, import_node_path3.basename)(resolved) === ".git" && !resolved.includes(`${import_node_path3.sep}.git${import_node_path3.sep}`)) {
      return (0, import_node_path3.dirname)(resolved);
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
  return getGitRoot(directory) || (0, import_node_path3.resolve)(directory);
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
    normalized = scpStyle ? `${scpStyle[1].toLowerCase()}/${scpStyle[2]}` : `file:${(0, import_node_path3.resolve)(raw)}`;
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
    const configPath = (0, import_node_path3.join)(
      getProjectBasePath(directory),
      ".claude",
      ".supermemory-claude",
      "config.json"
    );
    if (!(0, import_node_fs3.existsSync)(configPath)) return null;
    return JSON.parse((0, import_node_fs3.readFileSync)(configPath, "utf-8"));
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
  const configDir = (0, import_node_path3.join)((0, import_node_os3.homedir)(), ".config", "opencode");
  for (const filename of ["supermemory.jsonc", "supermemory.json"]) {
    try {
      const configPath = (0, import_node_path3.join)(configDir, filename);
      if (!(0, import_node_fs3.existsSync)(configPath)) continue;
      return JSON.parse(
        stripJsoncComments((0, import_node_fs3.readFileSync)(configPath, "utf-8"))
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
    const configPath = (0, import_node_path3.join)(
      (0, import_node_os3.homedir)(),
      ".config",
      "cursor",
      "supermemory.json"
    );
    if ((0, import_node_fs3.existsSync)(configPath)) {
      globalConfig = JSON.parse((0, import_node_fs3.readFileSync)(configPath, "utf-8"));
    }
  } catch {
  }
  let projectConfig = null;
  let current = (0, import_node_path3.resolve)(directory);
  while (true) {
    try {
      const configPath = (0, import_node_path3.join)(
        current,
        ".cursor",
        ".supermemory",
        "config.json"
      );
      if ((0, import_node_fs3.existsSync)(configPath)) {
        projectConfig = JSON.parse((0, import_node_fs3.readFileSync)(configPath, "utf-8"));
        break;
      }
    } catch {
    }
    const parent = (0, import_node_path3.dirname)(current);
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
  const repoName = getGitRepoName(basePath) || (0, import_node_path3.basename)(basePath) || "unknown";
  const shortName = sanitizeRepoName(repoName).slice(0, 72).replace(/_+$/g, "");
  return `repo_${shortName || "unknown"}__${getProjectIdentity(directory)}`;
}
function getLegacyGeneratedProjectTag(directory) {
  const basePath = getProjectBasePath(directory);
  const repoName = getGitRepoName(basePath) || (0, import_node_path3.basename)(basePath) || "unknown";
  return `repo_${sanitizeRepoName(repoName)}`;
}
function getProjectIdentity(directory) {
  const basePath = getProjectBasePath(directory);
  const { normalizedRemote } = getGitRepoInfo(basePath);
  const isolateWorktrees = process.env.SUPERMEMORY_ISOLATE_WORKTREES === "true";
  let localIdentity = basePath;
  try {
    localIdentity = import_node_fs3.realpathSync.native(basePath);
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
  return getGitRepoName(basePath) || (0, import_node_path3.basename)(basePath) || "unknown";
}
function getLegacyCodexUserTags(directory) {
  const identity = getGitEmail(directory) || process.env.USER || process.env.USERNAME || (0, import_node_os3.hostname)();
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
      [directory, (0, import_node_path3.resolve)(directory), getProjectBasePath(directory)].map(
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
  const identity = config.userContainerTag || process.env.SUPERMEMORY_USER_TAG || process.env.CURSOR_USER_EMAIL || getGitEmail(directory) || `${(0, import_node_os3.hostname)()}_${(0, import_node_os3.userInfo)().username}`;
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

// src/services/logger.ts
var import_node_fs4 = require("node:fs");
var import_node_os4 = require("node:os");
var import_node_path4 = require("node:path");
var LOG_FILE = (0, import_node_path4.join)((0, import_node_os4.homedir)(), ".codex-supermemory.log");
var sessionStarted = false;
function ensureSessionStarted() {
  if (!sessionStarted) {
    sessionStarted = true;
    try {
      (0, import_node_fs4.appendFileSync)(
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
    (0, import_node_fs4.appendFileSync)(LOG_FILE, line);
  } catch {
  }
}

// src/services/factCache.ts
var import_node_fs5 = require("node:fs");
var import_node_path5 = require("node:path");
var import_node_os5 = require("node:os");
var import_node_crypto2 = require("node:crypto");
var CACHE_DIR = (0, import_node_path5.join)((0, import_node_os5.homedir)(), ".codex-supermemory", "trackers");
var MAX_SEEN_FACTS = 500;
var HASH_PREFIX = "sha256:";
function ensureDir() {
  if (!(0, import_node_fs5.existsSync)(CACHE_DIR)) (0, import_node_fs5.mkdirSync)(CACHE_DIR, { recursive: true });
}
function cacheFile(sessionId) {
  return (0, import_node_path5.join)(CACHE_DIR, `${sessionId}.facts.json`);
}
function normalizeFact(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
function factKey(s) {
  return `${HASH_PREFIX}${(0, import_node_crypto2.createHash)("sha256").update(normalizeFact(s)).digest("hex")}`;
}
function getSeenFacts(sessionId) {
  const file = cacheFile(sessionId);
  if (!(0, import_node_fs5.existsSync)(file)) return /* @__PURE__ */ new Set();
  try {
    const parsed = JSON.parse((0, import_node_fs5.readFileSync)(file, "utf-8"));
    const facts = (parsed.facts ?? []).filter((fact) => typeof fact === "string" && fact.length > 0).map((fact) => fact.startsWith(HASH_PREFIX) ? fact : factKey(fact));
    return new Set(facts.slice(-MAX_SEEN_FACTS));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function addSeenFacts(sessionId, facts) {
  if (facts.length === 0) return;
  ensureDir();
  const seen = getSeenFacts(sessionId);
  for (const f of facts) seen.add(factKey(f));
  const bounded = [...seen].slice(-MAX_SEEN_FACTS);
  (0, import_node_fs5.writeFileSync)(cacheFile(sessionId), JSON.stringify({ facts: bounded }));
}

// src/services/session.ts
var import_node_crypto3 = require("node:crypto");
var FOUR_HOURS_MS = 4 * 60 * 60 * 1e3;
function sha2562(input) {
  return (0, import_node_crypto3.createHash)("sha256").update(input).digest("hex").slice(0, 16);
}
function getFourHourBucket(date = /* @__PURE__ */ new Date()) {
  return Math.floor(date.getTime() / FOUR_HOURS_MS);
}
function getSessionId(providedSessionId, scope, date = /* @__PURE__ */ new Date()) {
  if (providedSessionId?.trim()) return providedSessionId;
  return `codex_${sha2562(`${scope}:${getFourHourBucket(date)}`)}`;
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

// src/services/hookRecallClient.ts
var HOOK_RECALL_TIMEOUT_MS = 3e3;
var SELF_HOSTED_HOOK_RECALL_TIMEOUT_MS = 6e4;
var HOSTED_API_HOSTNAME = "api.supermemory.ai";
function hookRecallTimeoutMs(baseUrl = getBaseUrl()) {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === HOSTED_API_HOSTNAME ? HOOK_RECALL_TIMEOUT_MS : SELF_HOSTED_HOOK_RECALL_TIMEOUT_MS;
  } catch {
    return HOOK_RECALL_TIMEOUT_MS;
  }
}
function stringFacts(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (fact) => typeof fact === "string" && fact.trim().length > 0
  );
}
function normalizeProfileResponse(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const profile = value.profile && typeof value.profile === "object" ? value.profile : {};
  const searchResults = value.searchResults && typeof value.searchResults === "object" ? value.searchResults : null;
  const rawResults = Array.isArray(searchResults?.results) ? searchResults.results : [];
  const results = rawResults.map((result) => {
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
  }).filter((result) => result.memory.length > 0);
  return {
    success: true,
    profile: {
      static: stringFacts(profile.static),
      dynamic: stringFacts(profile.dynamic)
    },
    searchResults: searchResults ? {
      results,
      total: typeof searchResults.total === "number" ? searchResults.total : results.length,
      timing: typeof searchResults.timing === "number" ? searchResults.timing : void 0
    } : void 0
  };
}
async function fetchProfile(containerTag, query, options) {
  const apiKey = getApiKeyValue();
  if (!apiKey) return { success: false, error: "Missing API key", profile: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(`${getBaseUrl().replace(/\/+$/, "")}/v4/profile`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "x-sm-source": "codex"
      },
      body: JSON.stringify({ containerTag, q: query }),
      signal: controller.signal
    });
    if (!response.ok) {
      return { success: false, error: `Profile request failed (${response.status})`, profile: null };
    }
    return normalizeProfileResponse(await response.json());
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      profile: null
    };
  } finally {
    clearTimeout(timeout);
  }
}
async function getHookProfileWithSearchMany(containerTags, query, options = {}) {
  const resolved = {
    timeoutMs: options.timeoutMs ?? hookRecallTimeoutMs(),
    fetchImpl: options.fetchImpl ?? fetch
  };
  const uniqueTags2 = [...new Set(containerTags.filter(Boolean))];
  const results = await Promise.all(
    uniqueTags2.map((containerTag) => fetchProfile(containerTag, query, resolved))
  );
  return mergeProfileResults(results, CONFIG.maxMemories);
}

// src/services/recallPolicy.ts
var MIN_RECALL_QUERY_CHARS = 12;
var MAX_RECALL_QUERY_CHARS = 500;
function shouldRecallPrompt(prompt) {
  const query = prompt.trim();
  if (query.length < MIN_RECALL_QUERY_CHARS) return false;
  return !["/", "!", "#"].some((prefix) => query.startsWith(prefix));
}
function prepareRecallQuery(prompt) {
  return prompt.trim().slice(0, MAX_RECALL_QUERY_CHARS);
}

// src/hooks/recall.ts
var MAX_RESULT_CHARS = 300;
function exitWithContext(additionalContext, systemMessage) {
  if (additionalContext || systemMessage) {
    process.stdout.write(
      JSON.stringify({
        ...systemMessage ? { systemMessage } : {},
        ...additionalContext ? {
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext
          }
        } : {}
      })
    );
  }
  process.exit(0);
}
function formatRecall(items, containerTag) {
  const lines = items.map((item) => {
    const text = item.memory.replace(/\s+/g, " ").slice(0, MAX_RESULT_CHARS);
    const title = item.title?.trim();
    const prefix = title && !text.startsWith(title) ? `${title} \u2014 ` : "";
    const filepath = item.filepath ? ` (${item.filepath})` : "";
    return `- \u25EA ${prefix}${text}${filepath}`;
  });
  return `<supermemory-recall>
\u25EA Recalled from supermemory for this prompt (relevance-ranked):
${lines.join("\n")}

When one of these shapes your answer, credit it naturally with the \u25EA prefix (e.g. "\u25EA earlier you decided X"); if you name the source, say "from supermemory" \u2014 never "from memory". For deeper history, call the supermemory search_memory tool (containerTag: "${containerTag}").
</supermemory-recall>`;
}
async function main() {
  let rawInput = "";
  try {
    rawInput = (0, import_node_fs6.readFileSync)(0, "utf-8");
  } catch {
    process.exit(0);
  }
  if (!isConfigured()) {
    exitWithContext(
      "[SUPERMEMORY] Memory is installed but NOT active \u2014 missing API key.\nStart a new Codex task to authenticate, or set SUPERMEMORY_CODEX_API_KEY in your shell profile."
    );
  }
  let payload = {};
  try {
    payload = JSON.parse(rawInput);
  } catch {
    exitWithContext("");
  }
  const query = payload.prompt || payload.input || "";
  if (!query.trim()) {
    exitWithContext("");
  }
  const cwd = payload.cwd || process.cwd();
  const tags = getTags(cwd);
  const sessionId = getSessionId(payload.session_id, tags.project);
  log("recall: start", {
    query: query.slice(0, 100),
    tags,
    sessionId,
    recallMode: CONFIG.recallMode
  });
  if (CONFIG.recallMode === "off") {
    exitWithContext("");
  }
  if (CONFIG.recallMode === "advisory") {
    exitWithContext(CONFIG.recallDirective);
  }
  if (!shouldRecallPrompt(query)) exitWithContext("");
  try {
    const profileResult = await getHookProfileWithSearchMany(
      tags.allReads,
      prepareRecallQuery(query)
    );
    if (!profileResult.success) {
      exitWithContext("", "\u25EA supermemory \xB7 recall unavailable; continuing without recalled context");
    }
    const seen = getSeenFacts(sessionId);
    const matches = profileResult.searchResults?.results ?? [];
    const fresh = matches.filter((item) => !seen.has(factKey(item.memory))).slice(0, Math.min(CONFIG.maxMemories, 5));
    const repeats = matches.length - fresh.length;
    log("recall: done", {
      matchCount: matches.length,
      freshCount: fresh.length,
      seenCount: seen.size
    });
    if (fresh.length > 0) {
      addSeenFacts(sessionId, fresh.map((item) => item.memory));
      const additionalContext = formatRecall(fresh, tags.canonical);
      const tokens = Math.round(additionalContext.length / 4);
      const label = repeats > 0 ? `recalled ${fresh.length} new (${tokens} tok) \xB7 ${repeats} already in context` : `recalled ${fresh.length} ${fresh.length === 1 ? "memory" : "memories"} (${tokens} tok)`;
      log("recall: emit context", {
        additionalContextLength: additionalContext.length
      });
      exitWithContext(additionalContext, `\u25EA supermemory \xB7 ${label}`);
    }
    exitWithContext("");
  } catch (error) {
    log("recall: error", { error: String(error) });
    exitWithContext("", "\u25EA supermemory \xB7 recall unavailable; continuing without recalled context");
  }
}
main().catch(() => {
  exitWithContext("");
});
