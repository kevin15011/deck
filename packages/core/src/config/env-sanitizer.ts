export const RUNNER_ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "SHELL",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "XDG_DATA_HOME",
  "PI_SESSION_DIR",
  "DECK_RUNNER_MEMORY_ENDPOINT",
  "DECK_RUNNER_MEMORY_TOKEN",
  "DECK_CODEX_BRIDGE_ENDPOINT",
  "DECK_CODEX_BRIDGE_TOKEN",
]);

const SECRET_KEY = /(?:^|_)(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASS(?:PHRASE)?|PRIVATE[_-]?KEY|CREDENTIAL|AUTH(?:ORIZATION)?|COOKIE|SESSION|DSN|URI|DATABASE[_-]?(?:URL|URI)|REDIS[_-]?(?:URL|URI)|MONGO(?:DB)?[_-]?(?:URL|URI)|SUPERMEMORY_API_KEY)(?:_|$)/i;
const SECRET_VALUE = /(?:^Bearer\s+\S+|Cookie:\s*\S+|Set-Cookie:\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp|sentry|https?):\/\/[^\s/@:]+:[^\s/@]+@|\b(?:sqlite|file|libsql):\/\/(?:\/)?[^\s]*(?:\.db|\.sqlite|\.sqlite3)\b|^\/(?:Users|home|var|private|tmp)\/[^\s]*(?:\.db|\.sqlite|\.sqlite3)\b)/i;

export function isSensitiveRunnerEnv(key: string, value: string | undefined): boolean {
  if (value === undefined) return false;
  if (SECRET_KEY.test(key)) return true;
  if (SECRET_VALUE.test(value)) return true;
  return false;
}

export function sanitizeRunnerEnv(input: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (!RUNNER_ENV_ALLOWLIST.has(key) && isSensitiveRunnerEnv(key, value)) continue;
    env[key] = value;
  }
  return env;
}
