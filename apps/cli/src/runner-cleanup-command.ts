import { withIdleRunnerMutation, RunnerMutationDeferredError } from "@deck/session-host";
import type { RunnerMutationAdmission } from "./runner-mutation-admission";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { applyPackageRetirement, inspectRunnerGenerationReferences, assertNoContributionSymlink, contributionId, planPackageRetirement, readRunnerContributions, resolveDefaultDeckDataRoot, validContributionHash, type RetirementPlan, type RetirementTarget, type RunnerContribution } from '@deck/core';
import { requirePiAgentDir } from '@deck/adapter-pi';

export type CleanupRoots = { home: string; data: string; codex: string; opencode: string; pi: string; config?: string; claudeConfig?: string; opencodeConfig?: string; opencodeInlineConfig?: boolean };
export function cleanupRoots(environment: Readonly<Record<string, string | undefined>> = process.env): CleanupRoots {
  const home = resolve(environment.HOME ?? homedir());
  const xdgConfig = environment.XDG_CONFIG_HOME?.startsWith('/') ? resolve(environment.XDG_CONFIG_HOME) : join(home, '.config');
  const claudeConfigDir = environment.CLAUDE_CONFIG_DIR;
  if (claudeConfigDir && !isAbsolute(claudeConfigDir)) throw new Error('CLAUDE_CONFIG_DIR must be an absolute directory or unset.');
  return { home, config: join(xdgConfig, 'deck/config.json'), claudeConfig: join(claudeConfigDir || home, '.claude.json'), data: resolveDefaultDeckDataRoot(environment, home),
    codex: resolve(environment.CODEX_HOME && isAbsolute(environment.CODEX_HOME) ? environment.CODEX_HOME : join(home, '.codex')),
    opencode: resolve(environment.OPENCODE_CONFIG_DIR || join(xdgConfig, 'opencode')),
    ...(environment.OPENCODE_CONFIG ? { opencodeConfig: resolve(environment.OPENCODE_CONFIG) } : {}),
    ...(environment.OPENCODE_CONFIG_CONTENT ? { opencodeInlineConfig: true } : {}),
    pi: requirePiAgentDir(environment, home) };
}
/** Does not instantiate adapters, use config stores, migrate manifests, prepare, or bootstrap. */
export function planRunnerCleanup(roots: CleanupRoots, runnerIds = ['codex', 'claude', 'opencode', 'pi']): { plans: RetirementPlan[]; preservedResources: Array<{ runnerId: string; path: string; reason: string }>; artifactGroups: Array<{ root: string; capability: string; accountedByRunner: string; sharedWith: string[]; leafCount: number; removeCount: number; entryIds: string[] }> } {
  let explicitCapabilities: any;
  let intentUnreadable = false;
  try {
    const configPath = roots.config ?? join(roots.home, ".config/deck/config.json");
    assertNoContributionSymlink(configPath);
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid configuration");
    explicitCapabilities = raw.capabilities;
    const intent = explicitCapabilities?.["codebase-memory"];
    if (intent !== undefined && (!intent || typeof intent !== "object" || Array.isArray(intent)
      || (intent.enabled !== undefined && typeof intent.enabled !== "boolean")
      || (intent.runners !== undefined && (!intent.runners || typeof intent.runners !== "object" || Array.isArray(intent.runners)
        || Object.values(intent.runners).some(value => typeof value !== "boolean"))))) throw new Error("Invalid capability intent");
  } catch (error) { intentUnreadable = (error as NodeJS.ErrnoException).code !== "ENOENT"; }
  const plans: RetirementPlan[] = []; const preservedResources: Array<{ runnerId: string; path: string; reason: string }> = [];
  for (const runnerId of runnerIds) {
    const root = runnerId === 'claude' ? join(roots.data, 'claude') : roots[runnerId as 'codex' | 'pi' | 'opencode'];
    if (!root) throw new Error(`Unsupported cleanup runner: ${runnerId}`);
    const manifestPath = join(root, 'deck', 'manifest.json');
    const actualManifest = runnerId === 'claude' ? join(root, 'manifest.json') : manifestPath;
    let contributions: RunnerContribution[] = []; const diagnostics: string[] = [];
    const survivingClaudeCodebaseBindings: string[] = [];
    if (intentUnreadable) diagnostics.push("Canonical activation intent is unreadable or invalid; Codebase Memory removals are deferred. Retired package planning continues.");
    try {
      if ((runnerId === 'pi' || runnerId === 'codex') && existsSync(actualManifest)) {
        assertNoContributionSymlink(actualManifest);
        const raw = JSON.parse(readFileSync(actualManifest, 'utf8'));
        contributions = Array.isArray(raw.contributions) ? raw.contributions : [];
        if (raw.schema === 'deck-pi-manifest-v1') {
          for (const [name, hash] of Object.entries(raw.mcp?.servers ?? {})) {
            if (!validContributionHash(hash)) continue;
            const target = { path: join(root, 'mcp.json'), selector: { kind: 'json' as const, keys: ['mcpServers', name] } };
            contributions.push({ ...target, id: contributionId(target), hash, encoding: 'canonical-json-v1', ownership: 'prior-record', scope: 'global' });
          }
        }
      } else contributions = readRunnerContributions(actualManifest)?.contributions ?? [];
    } catch { diagnostics.push(`Ownership manifest unavailable/legacy/invalid; no ownership inferred: ${actualManifest}`); }
    const codebaseIntent = explicitCapabilities?.["codebase-memory"];
    const codebaseEnabled = intentUnreadable || (typeof codebaseIntent?.runners?.[runnerId] === "boolean" ? codebaseIntent.runners[runnerId] : codebaseIntent?.enabled) === true;
    const capabilityIds = ["context-mode", "serena", ...(!codebaseEnabled ? ["codebase-memory"] : [])];
    const targets: RetirementTarget[] = [];
    for (const contribution of contributions) {
      const capability = capabilityIds.find(id => contribution.sourceItemId === `package:${id}` || contribution.sourceItemId === `capability:${id}`);
      if (!capability) continue;
      if (contribution.selector.kind === 'symlink') targets.push({ path: contribution.path, format: 'symlink', capability });
      else if (contribution.selector.kind === 'file') targets.push({ path: contribution.path, format: 'file', capability });
      else if (contribution.selector.kind === 'json') targets.push({ path: contribution.path, format: 'json', container: contribution.selector.keys.slice(0, -1) });
      else if (contribution.selector.kind === 'json-array') targets.push({ path: contribution.path, format: 'json', container: contribution.selector.keys, array: true });
      else diagnostics.push(`Recorded retired contribution needs selector-specific review: ${contribution.path}#${JSON.stringify(contribution.selector)}`);
    }
    if (!codebaseEnabled) for (const contribution of contributions.filter(entry => entry.sourceItemId === "package:codebase-memory" && entry.selector.kind === "file")) targets.push({ path: contribution.path, format: "file", capability: "codebase-memory" });
    if (runnerId === 'codex') targets.push({ path: join(root, 'config.toml'), format: 'toml' });
    if (runnerId === 'pi') {
      targets.push({ path: join(root, 'mcp.json'), format: 'json', container: ['mcpServers'] });
      targets.push({ path: join(root, 'settings.json'), format: 'json', container: ['packages'], array: true });
    }
    if (runnerId === 'opencode') {
      for (const path of new Set([join(root, 'opencode.json'), join(root, 'opencode.jsonc'), ...(roots.opencodeConfig ? [roots.opencodeConfig] : [])])) {
        targets.push({ path, format: 'json', container: ['mcp'] }); targets.push({ path, format: 'json', container: ['plugin'], array: true });
      }
      if (roots.opencodeInlineConfig) diagnostics.push('OPENCODE_CONFIG_CONTENT supplies additional process configuration; no persisted file can be edited. Review its source separately; shared artifact collection is deferred.');
    }
    if (runnerId === 'claude') {
      try {
        assertNoContributionSymlink(root);
        if (existsSync(root)) for (const name of readdirSync(root).sort()) {
          if (/^developer-team-v\d+(?:-[a-f0-9]+)?$/.test(name)) {
            const path = join(root, name, '.mcp.json');
            targets.push({ path, format: 'json', container: ['mcpServers'] });
            try {
              assertNoContributionSymlink(path);
              if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).mcpServers?.['codebase-memory'] !== undefined) survivingClaudeCodebaseBindings.push(path);
            } catch { survivingClaudeCodebaseBindings.push(path); }
          }
        }
      } catch { diagnostics.push(`Preserved unsafe plugin root: ${root}`); }
      targets.push({ path: roots.claudeConfig ?? join(roots.home, '.claude.json'), format: 'json', container: ['mcpServers'] });
    }
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) targets.push({ path: join(roots.data, runnerId, "tools", "package.json"), format: "json", container: [section] });
    if(!codebaseEnabled){
      const tools=join(roots.data,runnerId,'tools');
      try{
        assertNoContributionSymlink(tools);
        for(const version of readdirSync(tools).filter(name=>/^codebase-native-v\d+\.\d+\.\d+$/.test(name))){
          // Historical native installers published this one executable. Never
          // recursively collect a neighboring knowledge database or user file.
          for(const platform of ['linux-x64','linux-arm64','darwin-x64','darwin-arm64']){
            targets.push({path:join(tools,version,platform,'codebase-memory-mcp'),format:'file',capability:'codebase-memory'});
          }
        }
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')diagnostics.push(`Preserved unreadable or symlink-bound native tools: ${tools}`);}
    }
    const packageLock = join(roots.data, runnerId, 'tools/package-lock.json');
    try {
      assertNoContributionSymlink(packageLock);
      const lock = JSON.parse(readFileSync(packageLock, 'utf8'));
      targets.push({ path: packageLock, format: 'json', container: ['dependencies'] });
      for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) targets.push({ path: packageLock, format: 'json', container: ['packages', '', section] });
      // Only this retired package subtree; hoisted/shared dependencies and names
      // with a similar prefix remain untouched. No ownership comes from a name.
      // These exact metadata entries live in the dedicated Deck tools root.
      for (const key of Object.keys(lock.packages ?? {})) if (key === 'node_modules/context-mode' || key.startsWith('node_modules/context-mode/')) {
        targets.push({ path: packageLock, format: 'json', container: ['packages'], key, capability: 'context-mode' });
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push(`Preserved unreadable or symlink-bound package lock: ${packageLock}`); }
    const artifactRoots = [join(roots.data, runnerId, "tools", "node_modules", "context-mode"), join(roots.data, runnerId, 'tools/node_modules/.bin/context-mode'), join(root, "deck", "tools", "context-mode"), join(root, "deck", "tools", "serena"), ...(runnerId === runnerIds[0] ? [join(roots.data, "tools", "serena")] : [])];
    const walkArtifacts = (path: string, capability: string) => {
      try {
        assertNoContributionSymlink(path, true);
        let stat; try { stat = lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
        if (stat.isDirectory()) {
          for (const name of readdirSync(path).sort()) walkArtifacts(join(path, name), capability);
        } else if (stat.isSymbolicLink()) targets.push({ path, format: "symlink", capability });
        else if (stat.isFile()) targets.push({ path, format: "file", capability });
        else preservedResources.push({ runnerId, path, reason: "Non-regular installation artifact preserved" });
      } catch { preservedResources.push({ runnerId, path, reason: "Symlink boundary or unreadable installation artifact; no traversal" }); }
    };
    for (const artifactRoot of artifactRoots) walkArtifacts(artifactRoot, artifactRoot.endsWith("serena") ? "serena" : "context-mode");
    const plan = planPackageRetirement({ runnerId, targets, contributions, capabilityIds, dedicatedRoots: [roots.data, join(root, 'deck')] });
    plan.backupRoot = runnerId === "claude" ? join(root, "backups") : join(root, "deck/backups");
    // The selected/held generation must remain inspectable and functional until
    // replacement. Its own reference guard protects binding removal; collect
    // the executable only on a subsequent plan after those bindings are gone.
    if (survivingClaudeCodebaseBindings.length) for (const entry of plan.entries) {
      if (entry.capability === 'codebase-memory' && entry.selector === 'whole-file') {
        entry.action = 'preserve';
        entry.reason += '; a surviving or unreadable Claude plugin Codebase binding requires replacement/reference release and binding retirement before artifact collection';
        preservedResources.push({ runnerId, path: entry.path, reason: entry.reason });
      }
    }
    for (const entry of plan.entries) if (runnerId === 'claude' && entry.path.startsWith(`${root}/`)
      && /^developer-team-v\d+(?:-[a-f0-9]+)?$/.test(entry.path.slice(root.length + 1).split('/')[0]!)) {
      const generation = { root: join(root, entry.path.slice(root.length + 1).split('/')[0]!), selectionPath: join(root, 'model-assignments.json') };
      entry.generation = generation;
      const references = inspectRunnerGenerationReferences(generation.root, generation.selectionPath);
      if (references.length) {
        entry.action = 'preserve';
        entry.reason += `; ${references.join('; ')}`;
        preservedResources.push({ runnerId, path: entry.path, reason: entry.reason });
      }
    }
    plan.diagnostics.push(...diagnostics); plans.push(plan);
    for (const diagnostic of plan.diagnostics) preservedResources.push({ runnerId, path: root, reason: diagnostic });
    // User native extensions, knowledge data, backups and all continuing Deck state are outside retirement.
    preservedResources.push({ runnerId, path: root, reason: 'Preserve unrelated entries, independent tools, user data and unrecorded backups. No adoption from names/templates.' });
  }
  const sharedRoot = join(roots.data, 'tools', 'serena');
  const sharedBlocked = runnerIds.length < 4 || plans.some(plan => plan.diagnostics.length > 0 || plan.entries.some(entry => entry.capability === 'serena' && entry.action !== 'remove'));
  if (sharedBlocked) for (const plan of plans) for (const entry of plan.entries) if (entry.path.startsWith(`${sharedRoot}/`)) {
    entry.action = 'preserve'; entry.reason += '; shared launcher still has surviving or uninspected runner references; replace/retire those references before collection';
  }
  const artifactGroups = plans.flatMap(plan => {
    const leaves = plan.entries.filter(entry => entry.selector === 'whole-file' && entry.path.startsWith(`${sharedRoot}/`));
    return leaves.length ? [{ root: sharedRoot, capability: 'serena', accountedByRunner: plan.runnerId, sharedWith: ['codex', 'claude', 'opencode', 'pi'], leafCount: leaves.length, removeCount: leaves.filter(entry => entry.action === 'remove').length, entryIds: leaves.map(entry => entry.id) }] : [];
  });
  return { plans, preservedResources, artifactGroups };
}
export async function runRunnerCleanupCommand(args: { runner?: string; review: boolean; json: boolean; output?: string }, roots = cleanupRoots()): Promise<number> {
  const report = planRunnerCleanup(roots, args.runner ? [args.runner] : undefined);
  if (args.output) writeFileSync(resolve(args.output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else for (const plan of report.plans) {
    console.log(`${plan.runnerId}: ${plan.entries.length} retired contributions`);
    for (const group of report.artifactGroups.filter(group => group.accountedByRunner === plan.runnerId)) console.log(`${group.capability}: ${group.leafCount} installation leaves under ${group.root}; shared by ${group.sharedWith.join(', ')}. ${group.removeCount} ownership-proven removals. Exact leaves and preimages are available with --json or --output.`);
    const grouped = new Set(report.artifactGroups.flatMap(group => group.entryIds));
    for (const entry of plan.entries.filter(entry => !grouped.has(entry.id))) console.log(`${entry.ownership}: ${entry.path}#${entry.selector}\n${entry.reason}\n${entry.preview}\nPreimage ${entry.fileHash}; proposed ${entry.action}`);
    for (const diagnostic of plan.diagnostics) console.log(diagnostic);
  }
  if (!args.review) return 0;
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('Review requires a terminal; ambiguous entries preserved. Use --plan to inspect without effects.'); return 1; }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const outcomes = await runRunnerCleanupUpdate(roots, args.runner ? [args.runner] : undefined, {ask: question => rl.question(question), confirmOwned: true});
    for (const outcome of outcomes) console.log(`${outcome.runnerId}: ${outcome.status}; ${outcome.remaining} retained entries. ${outcome.diagnostic ?? ''}`);
    return outcomes.some(outcome => outcome.status === 'deferred' || outcome.status === 'recovery-required') ? 1 : 0;
  } finally { rl.close(); }
}

export type RunnerCleanupOutcome = {runnerId:string;status:'complete'|'review-required'|'deferred'|'recovery-required';remaining:number;diagnostic?:string};
/** Update/daemon entry point. Only exact per-entry replies can remove ambiguous resources. */
export async function runRunnerCleanupUpdate(roots: CleanupRoots, runnerIds = ['codex','claude','opencode','pi'], options: {
  ask?: (question:string)=>Promise<string>; admission?: RunnerMutationAdmission; confirmOwned?:boolean;
} = {}): Promise<RunnerCleanupOutcome[]> {
  const admission = options.admission ?? withIdleRunnerMutation;
  const outcomes: RunnerCleanupOutcome[] = [];
  for (const runnerId of runnerIds) {
    const inspect = () => planRunnerCleanup(roots,runnerIds).plans.find(plan=>plan.runnerId===runnerId)!;
    const manifestPath = runnerId === 'claude' ? join(roots.data,'claude/manifest.json') : join(roots[runnerId as 'codex'|'opencode'|'pi'],'deck/manifest.json');
    // Review may yield to another operation which leaves a recovery receipt.
    // Check again inside each reservation, before apply can create even a backup.
    const assertRecoveryComplete = () => {
      if (existsSync(`${manifestPath}.pending`)) throw new Error('Pending contribution recovery');
    };
    const answer = async (question:string) => {try {return await options.ask?.(question) ?? '';} catch {return '';}};
    try {
      if (existsSync(`${manifestPath}.pending`)) {outcomes.push({runnerId,status:"recovery-required",remaining:inspect().entries.length,diagnostic:`Pending contribution recovery: ${manifestPath}.pending. Inspect deck doctor and existing backups before retrying.`});continue;}
      let plan = inspect();
      const owned = plan.entries.filter(entry=>entry.action === 'remove');
      if (owned.length && (!options.confirmOwned || await answer(`Apply the displayed ${owned.length} ownership-proven removals for ${runnerId}? Type apply-owned; Enter keeps them: `) === 'apply-owned')) {
        // Approval never changes bytes or identity. Core apply revalidates every preimage/reference under admission.
        await admission(()=>{assertRecoveryComplete(); return applyPackageRetirement({...plan,entries:owned},[],{manifestPath});});
      }
      const ids = inspect().entries.filter(entry=>entry.action === 'conditional-remove').map(entry=>entry.id);
      for (const id of ids) {
        plan = inspect(); const entry = plan.entries.find(candidate=>candidate.id === id);
        if (!entry || entry.action !== 'conditional-remove' || !options.ask) continue;
        const reply = await answer(`${runnerId}: ${entry.path}#${entry.selector}\n${entry.context}\n${entry.preview}\n${entry.reason}\nPreimage ${entry.fileHash}; entry ${entry.entryHash}. Remove only this entry? Type remove; Enter keeps it: `);
        if (reply === 'remove') await admission(()=>{assertRecoveryComplete(); return applyPackageRetirement({...plan,entries:[entry]},[{id:entry.id,fileHash:entry.fileHash,entryHash:entry.entryHash}],{manifestPath});});
      }
      plan = inspect();
      const remaining = plan.entries.length;
      const pending = existsSync(`${manifestPath}.pending`);
      outcomes.push({runnerId,status:pending ? 'recovery-required' : remaining || plan.diagnostics.length ? 'review-required' : 'complete',remaining,
        ...(remaining || pending || plan.diagnostics.length ? {diagnostic:pending ? `Pending contribution recovery: ${manifestPath}.pending. Review deck doctor before retry.` : 'Preserved legacy resources remain. Run deck runner cleanup --plan, then --review for individual confirmation; active Claude generations require verified replacement and release of references.'} : {})});
    } catch(error) {
      outcomes.push({runnerId,status:error instanceof RunnerMutationDeferredError ? 'deferred' : 'recovery-required',remaining:inspect().entries.length,
        diagnostic:error instanceof RunnerMutationDeferredError ? error.message : 'Retirement did not complete. A preimage/reference changed or recovery is pending; inspect deck doctor and a fresh plan. Existing backups are retained.'});
    }
  }
  return outcomes;
}
