import type { NormalizedDeckConfig } from "@deck/core";
import type { DeckConfigStore } from "./deck-config-store";
import {
  writeTavilyCredentialToActiveShellProfileTransaction,
  type ShellProfileDiagnosticCode,
  type ShellProfileWriteTransaction,
  type ShellProfileWriteResult,
} from "./web-search-shell-profile";

export type WebSearchSetupDiagnosticCode = ShellProfileDiagnosticCode
  | "deck-config-write-failed"
  | "profile-rollback-conflict"
  | "profile-rollback-failed";

const CONFIG_ROLLBACK_UNRESOLVED_MESSAGE = "Credential may remain because Deck configuration persistence failed and safe profile rollback could not be confirmed.";
const CONFIG_ROLLBACK_UNRESOLVED_GUIDANCE = "Inspect the reported profile path and, if necessary, remove only the exact Deck-owned Web Search block before retrying.";

export type WebSearchSetupResult = Readonly<{
  ok: boolean;
  profileStatus?: ShellProfileWriteResult["status"];
  /** Conservative profile result; true means a credential may still be present. */
  credentialPresent?: boolean;
  /** Safe profile location only; no profile content is returned. */
  profilePath?: string;
  /** Redacted status detail from the profile writer. */
  message?: string;
  /** Redacted safe recovery instruction from the profile writer. */
  guidance?: string;
  diagnosticCodes: readonly WebSearchSetupDiagnosticCode[];
}>;

export type PersistWebSearchCredentialOptions = Readonly<{
  credential: string;
  projectRoot?: string;
  configStore?: DeckConfigStore;
  environment?: Record<string, string | undefined>;
  writeProfile?: (credential: string) => ShellProfileWriteTransaction;
  readConfig?: () => NormalizedDeckConfig;
  writeConfig?: (config: NormalizedDeckConfig) => unknown;
}>;

/**
 * Performs the credential-specific part of dashboard enablement. The key is
 * held only for the direct shell-profile write and the current process env
 * handoff; Deck configuration receives provider metadata only.
 */
export function persistWebSearchCredentialAndEnable(
  options: PersistWebSearchCredentialOptions,
): WebSearchSetupResult {
  const environment = options.environment ?? process.env;
  const previousEnvironment = captureEnvironmentValue(environment, "TAVILY_API_KEY");
  const profileTransaction = (options.writeProfile ?? writeTavilyCredentialToActiveShellProfileTransaction)(options.credential);
  const profile = profileTransaction.result;
  if (!profile.ok) {
    return {
      ok: false,
      profileStatus: profile.status,
      credentialPresent: profile.credentialPresent,
      ...(profile.path ? { profilePath: profile.path } : {}),
      ...(profile.message ? { message: profile.message } : {}),
      ...(profile.guidance ? { guidance: profile.guidance } : {}),
      diagnosticCodes: profile.diagnosticCodes,
    };
  }

  try {
    environment.TAVILY_API_KEY = options.credential;
    const store = options.configStore;
    if (!store) throw new Error("Global Deck config store is required to configure Web Search.");
    const updateConfig = (current: NormalizedDeckConfig): NormalizedDeckConfig => ({
      ...current,
      webSearch: { enabled: true, provider: "tavily" },
    });
    if (options.writeConfig) {
      options.writeConfig(updateConfig((options.readConfig ?? (() => store.read()))()));
    } else {
      store.patch(updateConfig);
    }
  } catch {
    restoreEnvironmentValue(environment, "TAVILY_API_KEY", previousEnvironment);
    const rollback = profileTransaction.rollback();
    if (!rollback.ok) {
      return {
        ok: false,
        profileStatus: "manual-cleanup-required",
        credentialPresent: true,
        ...(profile.path ? { profilePath: profile.path } : {}),
        message: CONFIG_ROLLBACK_UNRESOLVED_MESSAGE,
        guidance: CONFIG_ROLLBACK_UNRESOLVED_GUIDANCE,
        diagnosticCodes: [
          "deck-config-write-failed",
          ...rollback.diagnosticCodes,
        ],
      };
    }
    return {
      ok: false,
      profileStatus: profile.status,
      credentialPresent: false,
      diagnosticCodes: [
        "deck-config-write-failed",
        ...rollback.diagnosticCodes,
      ],
    };
  }

  return { ok: true, profileStatus: profile.status, diagnosticCodes: [] };
}

type EnvironmentValue = Readonly<{ existed: boolean; value: string | undefined }>;

function captureEnvironmentValue(environment: Record<string, string | undefined>, name: string): EnvironmentValue {
  return {
    existed: Object.prototype.hasOwnProperty.call(environment, name),
    value: environment[name],
  };
}

function restoreEnvironmentValue(
  environment: Record<string, string | undefined>,
  name: string,
  previous: EnvironmentValue,
): void {
  if (previous.existed) environment[name] = previous.value;
  else delete environment[name];
}
