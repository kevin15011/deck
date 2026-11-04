import { compareReleaseVersions, sameBuild, type BuildIdentity } from '@deck/core';
export type DaemonBuildAction = 'use' | 'restart' | 'daemon-update-pending' | 'daemon-other-build' | 'daemon-incompatible' | 'daemon-incompatible-busy';
/** Unknown legacy identities remain usable when the protocol matches. Busy work is never interrupted. */
export function decideDaemonAction(client: BuildIdentity, daemon: { protocol: number; build?: BuildIdentity; version: string; busy: boolean }, installedTarget: boolean, protocol = 1): DaemonBuildAction {
 if (daemon.protocol !== protocol) return daemon.busy ? 'daemon-incompatible-busy' : installedTarget ? 'restart' : 'daemon-incompatible';
 if (!daemon.build) return 'use';
 if (sameBuild(client,daemon.build)) return 'use';
 if (client.channel !== daemon.build.channel || compareReleaseVersions(client.semver,daemon.version) < 0) return 'daemon-other-build';
 if (!installedTarget) return 'daemon-other-build';
 return daemon.busy ? 'daemon-update-pending' : 'restart';
}
