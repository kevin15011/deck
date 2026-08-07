import {
  assertDigest,
  assertExactKeys,
  codeValue,
  deepFreeze,
  enumValue,
  sha256Digest,
  type Sha256Digest,
} from "../contracts/canonical";

export interface TargetedRepairCapabilityDescriptorV1 {
  readonly kind: "targeted-repair-capability-v1";
  readonly runnerId: "opencode" | "pi" | "codex";
  readonly invocationId: string;
  readonly batchId: string;
  readonly batchDigest: Sha256Digest;
  readonly dossierDigest: Sha256Digest;
  readonly decisionDigest: Sha256Digest;
  readonly action: "targeted_repair";
  readonly target: string;
  readonly gitEffect:
    | { kind: "non-destructive" }
    | { kind: "destructive"; commandDigest: Sha256Digest };
  readonly capabilityDigest: Sha256Digest;
}

export function capabilityDescriptorDigestV1(
  descriptor: Omit<TargetedRepairCapabilityDescriptorV1, "capabilityDigest">,
): Sha256Digest {
  return sha256Digest(descriptor);
}

export function parseTargetedRepairCapabilityDescriptorV1(
  value: unknown,
): TargetedRepairCapabilityDescriptorV1 {
  assertExactKeys(
    value,
    [
      "kind",
      "runnerId",
      "invocationId",
      "batchId",
      "batchDigest",
      "dossierDigest",
      "decisionDigest",
      "action",
      "target",
      "gitEffect",
      "capabilityDigest",
    ],
    "capability descriptor",
  );
  const raw = value as Record<string, unknown>;
  assertExactKeys(
    raw.gitEffect,
    ["kind", "commandDigest"],
    "capability descriptor.gitEffect",
  );
  const gitRaw = raw.gitEffect as Record<string, unknown>;
  const gitKind = enumValue(
    gitRaw.kind,
    ["non-destructive", "destructive"] as const,
    "capability descriptor.gitEffect.kind",
  );
  if (
    (gitKind === "non-destructive" && gitRaw.commandDigest !== undefined) ||
    (gitKind === "destructive" && gitRaw.commandDigest === undefined)
  ) {
    throw new Error("invalid-evidence: capability descriptor.gitEffect");
  }
  if (gitKind === "destructive") {
    assertDigest(
      gitRaw.commandDigest,
      "capability descriptor.gitEffect.commandDigest",
    );
  }
  assertDigest(raw.batchDigest, "capability descriptor.batchDigest");
  assertDigest(raw.dossierDigest, "capability descriptor.dossierDigest");
  assertDigest(raw.decisionDigest, "capability descriptor.decisionDigest");
  assertDigest(raw.capabilityDigest, "capability descriptor.capabilityDigest");
  const descriptor = deepFreeze({
    kind: enumValue(
      raw.kind,
      ["targeted-repair-capability-v1"] as const,
      "capability descriptor.kind",
    ),
    runnerId: enumValue(
      raw.runnerId,
      ["opencode", "pi", "codex"] as const,
      "capability descriptor.runnerId",
    ),
    invocationId: codeValue(
      raw.invocationId,
      "capability descriptor.invocationId",
    ),
    batchId: codeValue(raw.batchId, "capability descriptor.batchId"),
    batchDigest: raw.batchDigest,
    dossierDigest: raw.dossierDigest,
    decisionDigest: raw.decisionDigest,
    action: enumValue(
      raw.action,
      ["targeted_repair"] as const,
      "capability descriptor.action",
    ),
    target: codeValue(raw.target, "capability descriptor.target"),
    gitEffect:
      gitKind === "destructive"
        ? { kind: gitKind, commandDigest: gitRaw.commandDigest as Sha256Digest }
        : { kind: gitKind },
    capabilityDigest: raw.capabilityDigest as Sha256Digest,
  });
  const { capabilityDigest, ...digestPayload } = descriptor;
  if (capabilityDigest !== capabilityDescriptorDigestV1(digestPayload)) {
    throw new Error("invalid-evidence: capability descriptor digest");
  }
  return descriptor;
}
