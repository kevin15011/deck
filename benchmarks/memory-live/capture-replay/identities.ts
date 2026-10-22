import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { privateWrite } from '../security';
/** Logical case/session labels never enter native input or provider customId. */
export class OpaqueIdentities {
    readonly path: string;
    private bindings: Record<string, string>;
    constructor(root: string) { this.path = join(root, 'opaque-identities.json'); this.bindings = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')).bindings : {}; }
    get(kind: string, logical: string) { const key = `${kind}:${logical}`; if (!this.bindings[key]) {
        this.bindings[key] = randomUUID();
        privateWrite(this.path, { schema: 'deck-eval-opaque-identities-v1', bindings: this.bindings });
    } return this.bindings[key]!; }
}
