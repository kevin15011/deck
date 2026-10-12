/** Setup authenticates the account, not a project. Never fetch profiles/search to validate a key.
 * Provider contract: https://supermemory.ai/docs/api-reference/settings/get-settings
 */
export async function validateSupermemoryAccountCredential(options: { apiKey: string; fetch?: (url: string, init: RequestInit) => Promise<Response> }): Promise<{ ok: boolean; diagnostics?: string[] }> {
  if (!options.apiKey.trim()) return { ok: false, diagnostics: ["Supermemory API key is required."] };
  try {
    const response = await (options.fetch ?? fetch)("https://api.supermemory.ai/v3/settings", {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(3000),
      headers: { Authorization: `Bearer ${options.apiKey.trim()}` },
    });
    // Settings may include sensitive account values. Authentication needs status only.
    await response.body?.cancel();
    return response.ok ? { ok: true } : { ok: false, diagnostics: [`Supermemory account validation returned HTTP ${response.status}.`] };
  } catch {
    return { ok: false, diagnostics: ["Supermemory account validation failed or timed out; credential was not stored."] };
  }
}
