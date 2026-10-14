import React, { useEffect, useRef, useState } from "react";
import { useApp, useInput } from "ink";
import type { AdapterRegistry, RunnerModelEntry, RunnerModelInventory } from "@deck/core";
import type { DeckConfigStore } from "../deck-config-store";
import { CROSS_MEMBERS, buildCrossReview, createCrossDraft, inspectCrossRunner, inventoryModels, pickerRunner, saveCrossConfiguration, type CrossRunnerReadiness, type ModelPickerTarget } from "./cross-config";
import { CrossConfigurationScreen, type CrossStage } from "./screens/cross-configuration-screen";

export function CrossConfigurationFlow({ registry, store, projectRoot, onBack, onSaved }: {
  registry: AdapterRegistry; store: DeckConfigStore; projectRoot: string; onBack(): void; onSaved(): void;
}) {
  const { exit } = useApp();
  const [draft, setDraft] = useState(() => createCrossDraft(store.read()));
  const [stage, setStage] = useState<CrossStage>("loading");
  const [cursor, setCursor] = useState(0);
  const [memberId, setMemberId] = useState<string>("lead");
  const [target, setTarget] = useState<ModelPickerTarget | null>(null);
  const [runners, setRunners] = useState<CrossRunnerReadiness[]>([]);
  const [inventory, setInventory] = useState<RunnerModelInventory | null>(null);
  const [providerId, setProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState<RunnerModelEntry | null>(null);
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const changedMembers = useRef(new Set<string>());
  const adapters = registry.list();
  const adapter = target ? registry.tryGet(pickerRunner(target)) : undefined;
  const models = inventory && target ? inventoryModels(inventory, providerId, target) : [];
  const levels = selectedModel && adapter?.supportsThinking(selectedModel.id) ? adapter.getThinkingLevels(selectedModel.id) : [];
  function navigate(next: CrossStage, at = 0) { setCursor(at); setStage(next); setError(undefined); }
  useEffect(() => {
    let active = true;
    void Promise.all(adapters.map(value => inspectCrossRunner(value, projectRoot))).then(rows => {
      if (active) { setRunners(rows.sort((a, b) => Number(b.ready) - Number(a.ready))); navigate("members"); }
    });
    return () => { active = false; generation.current++; abort.current?.abort(); };
  }, [registry, projectRoot]);
  function assign(model: RunnerModelEntry, thinking?: string) {
    if (!target || target.kind !== "cross-member") return;
    changedMembers.current.add(target.memberId);
    setDraft(current => ({ ...current, members: { ...current.members, [target.memberId]: { runnerId: pickerRunner(target), modelId: model.id, ...(thinking ? { thinking } : {}) } } }));
    setSelectedModel(null);
    navigate("members", CROSS_MEMBERS.indexOf(memberId as typeof CROSS_MEMBERS[number]));
  }
  async function discover(runnerId: string) {
    const row = runners.find(value => value.runnerId === runnerId);
    if (!row?.ready) { setError(row?.reason ?? "Runner unavailable"); return; }
    const selectedAdapter = registry.get(runnerId);
    if (!selectedAdapter.getModelInventory) { setError("Model inventory is unavailable for this runner."); return; }
    setTarget({ kind: "cross-member", memberId, runnerId });
    setInventory(null);
    navigate("loading");
    abort.current?.abort();
    const controller = new AbortController(); abort.current = controller;
    const request = ++generation.current;
    try {
      const result = await selectedAdapter.getModelInventory({ projectRoot, mode: "prefer-cache", signal: controller.signal });
      if (request !== generation.current || controller.signal.aborted) return;
      if (result.state !== "ready") { navigate("runners"); setError("Model discovery is unavailable or stale. Retry after checking the runner."); return; }
      setInventory(result.inventory);
      navigate("providers");
      if (!result.inventory.providers.length) setError("No models available. Check the runner's signed-in providers.");
    } catch { if (request === generation.current && !controller.signal.aborted) { navigate("runners"); setError("Model discovery failed. Retry after checking the runner."); } }
  }
  const review = buildCrossReview(draft, runners);
  const items = stage === "providers" ? (inventory?.providers ?? []).map(value => ({ label: value.displayName }))
    : stage === "models" ? models.map(value => ({ label: value.displayName, hint: value.id }))
    : stage === "thinking" ? levels.map(value => ({ label: value })) : [];
  const count = stage === "members" ? CROSS_MEMBERS.length + 1 : stage === "runners" ? runners.length : stage === "review" ? 2 : items.length;
  function back() {
    abort.current?.abort(); generation.current++;
    if (stage === "members") { onBack(); return; }
    navigate(stage === "models" ? "providers" : stage === "thinking" ? "models" : "members");
  }
  async function confirm() {
    if (stage === "members") {
      if (cursor === CROSS_MEMBERS.length) { navigate("review"); return; }
      setMemberId(CROSS_MEMBERS[cursor]!); navigate("runners");
    } else if (stage === "runners") { const row = runners[cursor]; if (row) await discover(row.runnerId); }
    else if (stage === "providers") { const row = inventory?.providers[cursor]; if (row) { setProviderId(row.id); navigate("models"); } }
    else if (stage === "models") {
      const model = models[cursor]; if (!model) return;
      const thinking = adapter?.supportsThinking(model.id) ? adapter.getThinkingLevels(model.id) : [];
      if (!thinking.length) { assign(model); return; }
      setSelectedModel(model);
      const defaultThinking = adapter!.getDefaultThinking(model.id);
      navigate("thinking", Math.max(0, thinking.indexOf(defaultThinking)));
    } else if (stage === "thinking" && selectedModel) assign(selectedModel, levels[cursor]);
    else if (stage === "review") {
      if (cursor === 1) { navigate("members"); return; }
      if (review.blockers.length) { setError(review.blockers.join(" ")); return; }
      if (saving.current) return; saving.current = true;
      try {
        // Recheck installation at save so stale UI evidence cannot publish a blocked plan.
        const checked = await Promise.all(adapters.map(value => inspectCrossRunner(value, projectRoot)));
        setRunners(checked);
        for (const runner of adapters) {
          const ids = [...changedMembers.current].filter(id => draft.members[id]?.runnerId === runner.runnerId);
          if (!ids.length || !runner.validateModelAssignments) continue;
          const validation = await runner.validateModelAssignments({
            projectRoot,
            modelAssignments: Object.fromEntries(ids.map(id => [id, draft.members[id]!.modelId])),
            thinkingAssignments: Object.fromEntries(ids.filter(id => draft.members[id]!.thinking).map(id => [id, draft.members[id]!.thinking!])),
            changedAgentIds: ids,
          });
          if (!validation.valid) { setError("Model assignments are no longer available. Select the runner and model again."); return; }
        }
        saveCrossConfiguration(store, draft, checked); onSaved();
      } catch { setError("Could not save cross configuration. Check prerequisites and retry; selections are preserved."); }
      finally { saving.current = false; }
    }
  }
  useInput((input, key) => {
    if (saving.current) return;
    if (input === "q") { exit(); return; }
    if (key.escape) { back(); return; }
    if (key.delete && stage === "members" && cursor < CROSS_MEMBERS.length) {
      setDraft(current => { const members = { ...current.members }; delete members[CROSS_MEMBERS[cursor]!]; return { ...current, members }; }); return;
    }
    if (input === "j" || key.downArrow) setCursor(value => Math.min(Math.max(0, count - 1), value + 1));
    else if (input === "k" || key.upArrow) setCursor(value => Math.max(0, value - 1));
    else if (key.return) void confirm();
  });
  return <CrossConfigurationScreen stage={stage} cursor={cursor} draft={draft} runners={runners} items={items} error={error} />;
}
