// A command is summarized as executable, subcommand and a few plain operands
// of known tools. Flags, inline scripts, heredocs, queries and URIs never pass.
export const plainWord = /^[A-Za-z0-9_][\w./+-]{0,79}$/;
const operandTools = new Set(['git', 'cargo', 'bun', 'npm', 'pnpm', 'yarn', 'make', 'ls', 'cat', 'head', 'tail', 'wc', 'cd', 'pwd', 'tsc', 'diff', 'stat']);
const sensitiveSub = new Set(['config', 'credential', 'remote', 'login', 'logout', 'auth', 'secret', 'token', 'exec', 'run', 'dlx', 'x']);
export const looksSecret = (v: string): boolean => v.length > 32 && !/[./]/.test(v) || /^[0-9a-f]{20,}$/i.test(v);
export function summarizeCommand(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const first = (raw.split(/\n|;|&|\||<<|`|\$\(/, 1)[0] ?? '');
  const more = first.length < raw.trim().length;
  const words = first.trim().split(/\s+/).filter(Boolean);
  while (words.length && /^[A-Za-z_]\w*=/.test(words[0]!)) words.shift();
  if (words[0] === 'env' || words[0] === 'sudo' || words[0] === 'rtk') words.shift();
  const exe = (words.shift() ?? '').split('/').pop() ?? '';
  if (!/^[A-Za-z0-9_][\w.+-]{0,39}$/.test(exe)) return more ? 'command …' : 'command';
  const out = [exe];
  if (operandTools.has(exe)) {
    const sub = words[0];
    if (sub && /^[a-z][a-z0-9-]{0,23}$/.test(sub)) {
      out.push(sub);
      words.shift();
    }
    if (!sensitiveSub.has(sub ?? '')) {
      for (const word of words) {
        if (out.length >= 5) break;
        // After any flag, a bare word may be that flag's value.
        if (word.startsWith('-')) break;
        if (!plainWord.test(word) || looksSecret(word)) continue;
        out.push(word);
      }
    }
  }
  return out.join(' ') + (more || words.length > out.length ? ' …' : '');
}

export const plainPath = /^[\w./+-]{1,160}$/;
