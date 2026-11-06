import lock from './npm-lock.json';
import type { OwnedNpmSpec } from '../../core/src/owned-tools/npm-artifact';
export const pinnedNpmArtifact = { lock, command: 'tavily-mcp', package: 'tavily-mcp' } satisfies OwnedNpmSpec;
