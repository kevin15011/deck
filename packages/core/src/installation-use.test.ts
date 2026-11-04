import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstallationBusyError, withInstallationMutation } from './installation-use';

function gate() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}
// A scheduler checkpoint drains runnable jobs without waiting for elapsed time.
const checkpoint = () => new Promise<void>(resolve => setImmediate(resolve));

// Protects: admitted descendants retain exclusivity even after the parent callback settles.
// Oracle: RIR-03 requires every admitted effect to finish before release; the parent's error wins.
// Fails if: a competing writer enters early, a descendant deadlocks, or cleanup/error identity is lost.
for (const rejects of [false, true]) test(`mutation drains detached descendants after parent ${rejects ? 'rejection' : 'success'}`, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-mutation-scope-')));
  const childEntered = gate(), childGate = gate(), grandchildEntered = gate(), grandchildGate = gate(), late = gate();
  let inherited!: Promise<unknown>;
  const failure = new Error('parent failure');
  let settled = false, childFinished = false, grandchildFinished = false;
  const running = withInstallationMutation(root, async () => {
    inherited = late.promise.then(() => withInstallationMutation(root, async () => 'late write')).catch(error => error);
    const child = withInstallationMutation(root, async () => {
      childEntered.open();
      await childGate.promise;
      void withInstallationMutation(root, async () => {
        grandchildEntered.open();
        await grandchildGate.promise;
        grandchildFinished = true;
      });
      childFinished = true;
    });
    if (rejects) await Promise.all([child, Promise.reject(failure)]);
    return 'result';
  });
  const outcome = running.then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  try {
    await childEntered.promise;
    await checkpoint();
    expect(settled).toBe(false);
    expect(childFinished).toBe(false);
    late.open();
    expect(await inherited).toBeInstanceOf(InstallationBusyError);
    await expect(withInstallationMutation(root, async () => {})).rejects.toBeInstanceOf(InstallationBusyError);
    childGate.open();
    await grandchildEntered.promise;
    await checkpoint();
    expect(settled).toBe(false);
    expect(childFinished).toBe(true);
    expect(grandchildFinished).toBe(false);
    await expect(withInstallationMutation(root, async () => {})).rejects.toBeInstanceOf(InstallationBusyError);
    grandchildGate.open();
    expect(await outcome).toEqual(rejects ? { error: failure } : { value: 'result' });
    expect(grandchildFinished).toBe(true);
    await withInstallationMutation(root, async () => 'next writer');
    expect(readdirSync(join(root, 'deck/installation-use'))).toEqual([]);
  } finally { late.open(); childGate.open(); grandchildGate.open(); await outcome; rmSync(root, { recursive: true, force: true }); }
});

// Protects: closed inherited scopes never authorize new writes; ordinary awaited nesting still completes.
// Oracle: late work must acquire a fresh lease and respect an unrelated current writer.
// Fails if: inherited context bypasses the lease or a rejected effect leaks its reservation.
test('late inherited work reacquires a lease after normal nesting and rejection cleanup', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-mutation-late-')));
  const late = gate(), held = gate(), entered = gate();
  let inherited!: Promise<unknown>;
  try {
    expect(await withInstallationMutation(root, async () => {
      inherited = late.promise.then(() => withInstallationMutation(root, async () => 'late write')).catch(error => error);
      return withInstallationMutation(root, async () => withInstallationMutation(root, async () => 'nested'));
    })).toBe('nested');
    const competing = withInstallationMutation(root, async () => { entered.open(); await held.promise; });
    await entered.promise;
    late.open();
    expect(await inherited).toBeInstanceOf(InstallationBusyError);
    held.open(); await competing;
    const failure = new Error('effect failed');
    await expect(withInstallationMutation(root, async () => { throw failure; })).rejects.toBe(failure);
    await withInstallationMutation(root, async () => {});
    expect(readdirSync(join(root, 'deck/installation-use'))).toEqual([]);
  } finally { late.open(); held.open(); rmSync(root, { recursive: true, force: true }); }
});

// Protects: detached failures cannot produce install success or unhandled child rejections.
// Oracle: failed admitted effects fail their enclosing mutation, preserving an existing parent error.
// Fails if: child rejection is ignored, wins over the original parent error, or leaks a lease.
for (const rejects of [false, true]) test(`detached child failure preserves ${rejects ? 'parent failure' : 'failure outcome'}`, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-mutation-failure-')));
  const entered = gate(), release = gate();
  const parentFailure = new Error('parent failed'), childFailure = new Error('detached child failed');
  const running = withInstallationMutation(root, async () => {
    void withInstallationMutation(root, async () => { entered.open(); await release.promise; throw childFailure; });
    if (rejects) throw parentFailure;
    return 'must not succeed';
  });
  const outcome = running.catch(error => error);
  try {
    await entered.promise;
    release.open();
    expect(await outcome).toBe(rejects ? parentFailure : childFailure);
    await withInstallationMutation(root, async () => {});
    expect(readdirSync(join(root, 'deck/installation-use'))).toEqual([]);
  } finally { release.open(); await outcome; rmSync(root, { recursive: true, force: true }); }
});
