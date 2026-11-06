import lock from './npm-lock.json';
import type { OwnedNpmSpec } from '../../core/src/owned-tools/npm-artifact';
export const pinnedNpmArtifact = { lock, command: 'context7-mcp', package: '@upstash/context7-mcp' } satisfies OwnedNpmSpec;
