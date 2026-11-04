import { expect, test } from 'bun:test';
import { PREPARATION_REASON_CODES, publishablePreparationCode, evaluateRoleAdmission } from './runner-admission';
// Oracle: reviewed error codes cross transports; arbitrary messages and credentials never do.
test('preparation transport includes OpenCode and excludes unreviewed strings', () => {
  for (const code of PREPARATION_REASON_CODES) expect(publishablePreparationCode(`${code}: recovery`)).toBe(code);
  for (const text of ['other-error', 'token=secret', 'prefix opencode-session-preparation-blocked']) expect(publishablePreparationCode(text)).toBeUndefined();
});
test('admission preserves a safe failed check and never raw cause text', async () => {
  const result = await evaluateRoleAdmission(async () => { throw Object.assign(new Error('secret=abc'), { detail: 'hook-receipt-mismatch:rtk' }); });
  expect(result.verdict).toBe('blocked');
  expect(result.checks[0]?.id).toBe('hook-receipt-mismatch:rtk');
  expect(JSON.stringify(result)).not.toContain('secret');
});
