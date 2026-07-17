import { expect, test } from "bun:test"; import * as runtime from "./index";
test("V1 contract exports are additive", () => { for (const name of ["buildApplyBatchContractV1","buildFailureManifestV1","computeFailureDeltaV1","createExecutionDossierV1","parseRepairIncidentYAML"]) expect(typeof runtime[name as keyof typeof runtime]).toBe("function"); });
