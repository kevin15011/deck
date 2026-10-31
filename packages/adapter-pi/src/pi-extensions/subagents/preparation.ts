import { NativePreparationCoordinator } from "../../../../sdd-runtime/src/execution/native-preparation";
import { createPiSkillDiscoveryProvider } from "../../skill-discovery-provider";

export class PiNativePreparation extends NativePreparationCoordinator {
  constructor(environment: Readonly<Record<string, string | undefined>>) { super(environment, "pi", createPiSkillDiscoveryProvider({ env: environment, homeDirectory: environment.HOME })); }
}
