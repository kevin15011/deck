import { isWebSearchProviderDescriptor, type CapabilityCatalogEntry, type CapabilityInventory } from "@deck/core";

export type DashboardInventoryNormalization =
  | { ok: true; inventory: CapabilityInventory }
  | { ok: false; diagnostic: { code: "dashboard-inventory-invalid"; message: string } };

const REQUIREMENT_LEVELS = new Set<CapabilityCatalogEntry["requirementLevel"]>([
  "required",
  "optional",
  "configurable",
]);
const INSTALL_KINDS = new Set<CapabilityCatalogEntry["installKind"]>([
  "pi-package",
  "external",
  "opencode-plugin",
  "runner-native",
]);
const SUPPORT_STATUSES = new Set([
  "supported",
  "runner-specific",
  "shared",
  "manual-verified",
  "gap",
  "blocked",
  "not-applicable",
]);

const INVALID_INVENTORY = {
  code: "dashboard-inventory-invalid" as const,
  message: "Runner capability inventory is invalid. Return to Dashboard and retry.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isCapabilityCatalogEntry(value: unknown): value is CapabilityCatalogEntry {
  if (!isRecord(value)) return false;
  if (!isString(value.capabilityId) || !isString(value.label) || !isString(value.description) || !isString(value.section)) return false;
  if (!REQUIREMENT_LEVELS.has(value.requirementLevel as CapabilityCatalogEntry["requirementLevel"])) return false;
  if (!INSTALL_KINDS.has(value.installKind as CapabilityCatalogEntry["installKind"])) return false;
  if (typeof value.isInstalled !== "boolean" || typeof value.isBlocked !== "boolean") return false;
  if (value.toolId !== undefined && !isString(value.toolId)) return false;
  if (value.source !== undefined && !isString(value.source)) return false;
  if (value.diagnostics !== undefined && !isStringArray(value.diagnostics)) return false;
  if (value.capabilityId === "web-search" && value.webSearchProvider !== undefined && !isWebSearchProviderDescriptor(value.webSearchProvider)) return false;
  return value.supportStatus === undefined || SUPPORT_STATUSES.has(value.supportStatus as string);
}

/**
 * The single runtime boundary between adapter data and the dashboard plan path.
 * It preserves the core inventory object so adapters receive their documented
 * `CapabilityInventory` contract rather than a UI-specific projection.
 */
export function normalizeDashboardCapabilityInventory(
  value: unknown,
  expectedRunnerId: string,
  expectedEnvironmentId: string,
): DashboardInventoryNormalization {
  if (!isRecord(value) || !isString(value.runnerId) || !isString(value.environmentId) || !Array.isArray(value.capabilities)) {
    return { ok: false, diagnostic: INVALID_INVENTORY };
  }
  if (value.runnerId !== expectedRunnerId || value.environmentId !== expectedEnvironmentId) {
    return { ok: false, diagnostic: INVALID_INVENTORY };
  }
  if (!value.capabilities.every(isCapabilityCatalogEntry)) {
    return { ok: false, diagnostic: INVALID_INVENTORY };
  }
  return { ok: true, inventory: value as CapabilityInventory };
}
