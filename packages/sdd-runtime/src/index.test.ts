import { expect, test } from "bun:test"; import * as runtime from "./index";
test("V1 contract exports are additive", () => {
  for (const name of [
    "buildApplyBatchContractV1",
    "buildFailureManifestV1",
    "computeFailureDeltaV1",
    "createExecutionDossierV1",
    "parseRepairIncidentYAML",
    "aggregateDeckPreparationHandoffV1",
    "buildSessionPreparationDelegationDigestV1",
    "consumeSessionPreparationAuthorizationV1",
    "createSessionPreparationAuthorizationServiceV1",
    "createSessionPreparationStateV1",
    "parseDeckPreparationHandoffV1",
    "parseSessionPreparationRequestV1",
    "executeVerificationStageV1",
    "createQaRunnerHostAuthorityV1",
  ]) expect(typeof runtime[name as keyof typeof runtime]).toBe("function");
});
