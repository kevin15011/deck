import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from 'node:path';
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { assertPrivateStatePath, type BuildIdentity } from '@deck/core';
import { getBuildInfo } from './build-info';
const captured = new Map<string, BuildIdentity>();
export function currentBuildIdentity(executable = process.execPath): BuildIdentity {
  const previous = captured.get(executable);
  if (previous) return previous;
  const info = getBuildInfo();
  const canaryDigest = /^\.deck-canary\.payload-([a-f0-9]{64})$/.exec(basename(executable))?.[1];
  const compiled = !/^(bun|node)(\.exe)?$/.test(basename(executable));
  let digest: string | undefined;
  try { if (compiled) digest = createHash('sha256').update(readFileSync(executable)).digest('hex'); } catch { /* Missing executable identity defers replacement; compatible work can continue. */ }
  const identity: BuildIdentity = { semver: info.version, commit: info.commit, channel: canaryDigest ? 'canary' : info.channel, ...(digest ? { payloadDigest: digest } : {}) };
  captured.set(executable,identity);
  return identity;
}
/** Validate the alias, its resolved target and every ancestor. Never trust a pin supplied by native env. */
export function validatedExecutableAlias(executable = process.execPath): string | undefined {
  try {
    const payload = realpathSync(executable);
    const canary = /^\.deck-canary\.payload-[a-f0-9]{64}$/.test(basename(payload));
    const alias = canary ? join(dirname(payload), 'deck-canary') : Bun.which('deck');
    if (!alias) return undefined;
    assertPrivateStatePath(alias, false); assertPrivateStatePath(payload);
    const link = lstatSync(alias);
    if (typeof process.getuid === "function" && link.uid !== process.getuid() && link.uid !== 0) return undefined;
    if (lstatSync(alias).isSymbolicLink()) {
      // The private-state reader deliberately forbids aliases; validate links explicitly here.
      if (!canary || readlinkSync(alias) !== basename(payload)) return undefined;
    }
    return realpathSync(alias) === payload ? alias : undefined;
  } catch { return undefined; }
}
export function isInstalledBuildTarget(): boolean {
  // Source runtimes are never eligible to replace the shared daemon.
  if (/^(?:bun|node)(?:\.exe)?$/.test(basename(process.execPath))) return false;
  return !!validatedExecutableAlias() && isInstalledIdentity(currentBuildIdentity());
}

/** Verify a request against a fixed channel alias; never execute or follow requester-provided paths. */
export function isInstalledIdentity(identity: BuildIdentity): boolean {
  try {
    const own = currentBuildIdentity();
    if (identity.channel !== own.channel || !identity.payloadDigest) return false;
    const alias = own.channel === 'canary' ? join(dirname(process.execPath), 'deck-canary') : Bun.which('deck');
    if (!alias) return false;
    assertPrivateStatePath(alias, false);
    const link = lstatSync(alias);
    if (typeof process.getuid === 'function' && link.uid !== process.getuid() && link.uid !== 0) return false;
    if (link.isSymbolicLink()) {
      const written = readlinkSync(alias);
      const destination = join(dirname(alias), written);
      // Resolve only a single trusted leaf link; unknown link chains defer automatic handoff.
      assertPrivateStatePath(written.startsWith('/') ? written : destination);
      if (own.channel === 'canary' && !/^\.deck-canary\.payload-[a-f0-9]{64}$/.test(written)) return false;
    }
    const target = realpathSync(alias);
    assertPrivateStatePath(target);
    const stat = lstatSync(target);
    return stat.isFile() && !!(stat.mode & 0o111) && createHash('sha256').update(readFileSync(target)).digest('hex') === identity.payloadDigest;
  } catch { return false; }
}
