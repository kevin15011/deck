import { createOwnedNpmTools } from '../../core/src/owned-tools/npm-artifact';
import { pinnedNpmArtifact as context7 } from '../../provider-context7/src/npm-artifact';
import { pinnedNpmArtifact as search } from '../../provider-tavily/src/npm-artifact';
export const { ownedNpmRoot, ownedNpmCommand, installOwnedNpmTool } = createOwnedNpmTools({ context7, 'web-search': search });
