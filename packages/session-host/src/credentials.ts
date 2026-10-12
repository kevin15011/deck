/**
 * Task-scoped bridge credentials (D-11). The token lives only in a 0600 file named by env;
 * the daemon keeps just a hash -> grant map, so a leaked registry dump cannot authenticate.
 */
import { createHash, randomBytes } from "node:crypto";
import { unlinkSync } from "node:fs";
import { writePrivateFile } from "./paths";

export type CredentialGrant = {
  sessionId: string; taskId: string; memberId: string; runnerId?: string; allowedTools: readonly string[];
};
type Entry = { grant: CredentialGrant; file: string };

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export class CredentialRegistry {
  private readonly grants = new Map<string, Entry>();

  constructor(private readonly options: { socketPath: string }) {}

  /** Mint a token, write `{v, token, socketPath}` to `file` (0600) and remember only its hash. */
  issue(grant: CredentialGrant, file: string): { token: string; file: string } {
    const token = randomBytes(32).toString("base64url");
    writePrivateFile(file, JSON.stringify({ v: 1, token, socketPath: this.options.socketPath }));
    this.grants.set(hash(token), { grant, file });
    return { token, file };
  }

  lookup(token: string): CredentialGrant | undefined {
    if (typeof token !== "string" || token.length === 0) return undefined;
    return this.grants.get(hash(token))?.grant;
  }

  revoke(token: string): boolean {
    const key = hash(token);
    const entry = this.grants.get(key);
    if (!entry) return false;
    this.grants.delete(key);
    try { unlinkSync(entry.file); } catch { /* already removed */ }
    return true;
  }

  /** Daemon shutdown: delete every credential file. */
  revokeAll(): number {
    const count = this.grants.size;
    for (const [key, entry] of [...this.grants]) {
      this.grants.delete(key);
      try { unlinkSync(entry.file); } catch { /* already removed */ }
    }
    return count;
  }

  /** Revoke every credential issued for a task (terminal state). Returns how many were revoked. */
  revokeTask(taskId: string): number {
    let count = 0;
    for (const [key, entry] of [...this.grants]) {
      if (entry.grant.taskId !== taskId) continue;
      this.grants.delete(key);
      try { unlinkSync(entry.file); } catch { /* already removed */ }
      count++;
    }
    return count;
  }
}
