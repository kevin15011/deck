/** Read-only working tree comparisons; never a session baseline or ownership claim. */
export type GitSection = 'staged' | 'unstaged' | 'untracked';
export type GitFile = { path: string; previousPath?: string; section: GitSection; status: string; unavailableReason?: string };
export type GitCatalog = { files: GitFile[]; warnings?: string[] };
export type GitDocument = { file: GitFile; kind: 'text' | 'binary' | 'limited' | 'unavailable' | 'conflict'; patch: string; message?: string };

export type GitContent = { file: GitFile; kind: GitDocument['kind']; content: string; version?: 'index' | 'working' | 'HEAD'; message?: string };
