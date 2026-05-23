import path from "node:path";

/**
 * Extracts the project/repository name from a git remote URL.
 *
 * Supports SSH, HTTPS, and local file path formats.
 * Returns undefined for empty or malformed URLs.
 */
export function extractProjectNameFromGitRemote(remoteUrl: string): string | undefined {
  if (!remoteUrl) return undefined;

  let url = remoteUrl.trim();
  if (!url) return undefined;

  // Remove query params and fragments
  const queryIndex = url.indexOf("?");
  if (queryIndex !== -1) {
    url = url.slice(0, queryIndex);
  }
  const hashIndex = url.indexOf("#");
  if (hashIndex !== -1) {
    url = url.slice(0, hashIndex);
  }

  // Remove .git suffix
  if (url.endsWith(".git")) {
    url = url.slice(0, -4);
  }

  // Handle SSH format: git@github.com:user/repo
  if (url.includes("@") && url.includes(":")) {
    const colonIndex = url.lastIndexOf(":");
    const atIndex = url.indexOf("@");
    // Only treat as SSH if colon comes after the at sign (typical SSH format)
    if (colonIndex > atIndex) {
      const segment = url.slice(colonIndex + 1);
      const lastSlash = segment.lastIndexOf("/");
      return lastSlash === -1 ? segment || undefined : segment.slice(lastSlash + 1) || undefined;
    }
  }

  // Handle file:// URLs
  if (url.startsWith("file://")) {
    url = url.slice(7); // remove file://
  }

  // Remove trailing slashes
  url = url.replace(/\/+$/, "");

  // Handle other URLs (http://, https://, ssh://, or local paths)
  // Extract last path segment
  const lastSlash = url.lastIndexOf("/");
  const segment = lastSlash === -1 ? url : url.slice(lastSlash + 1);

  // Return undefined if empty
  return segment || undefined;
}

/**
 * Returns a fallback project name from the directory basename.
 */
export function getProjectFallbackName(projectRoot: string): string {
  return path.basename(projectRoot);
}