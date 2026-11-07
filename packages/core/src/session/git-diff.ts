/** Read-only working tree comparisons; never a session baseline or ownership claim. */
export type GitSection = 'staged' | 'unstaged' | 'untracked' | 'branch';
export type GitFile = { path: string; previousPath?: string; section: GitSection; status: string; additions?: number; deletions?: number; binary?: boolean; unavailableReason?: string };
export type GitCatalog = { files: GitFile[]; totalFiles?: number; nextCursor?: string; warnings?: string[]; currentBranch?: string; comparison?: { baseRef: string; headRef: string; base: string; head: string; revision: string } };
export type GitDocument = { file: GitFile; kind: 'text' | 'binary' | 'limited' | 'unavailable' | 'conflict'; patch: string; message?: string };

export type GitContent = { file: GitFile; kind: GitDocument['kind']; content: string; version?: 'index' | 'working' | 'HEAD' | 'base'; message?: string };
