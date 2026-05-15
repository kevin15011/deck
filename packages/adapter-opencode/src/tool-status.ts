export type ToolAvailability = "found" | "missing" | "not-applicable";
export type ToolConfiguration = "configured" | "missing" | "not-required";
export type ToolReadiness = "ready" | "available-unconfigured" | "missing";

export type EnvironmentToolStatus = {
  name: string;
  available: ToolAvailability;
  configured: ToolConfiguration;
  ready: ToolReadiness;
};

export function createToolStatus(
  name: string,
  available: ToolAvailability,
  configured: ToolConfiguration,
): EnvironmentToolStatus {
  return {
    name,
    available,
    configured,
    ready: getReadiness(available, configured),
  };
}

function getReadiness(available: ToolAvailability, configured: ToolConfiguration): ToolReadiness {
  if (available === "found" && (configured === "configured" || configured === "not-required")) return "ready";
  if (available === "found") return "available-unconfigured";
  return "missing";
}
