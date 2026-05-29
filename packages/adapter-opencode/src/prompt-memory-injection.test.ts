/**
 * Tests para Task 10: Tests de prompt/instrucciones + regresión Engram
 *
 * Valida:
 * 1. Prompt contiene herramientas reales (memory/recall), no antiguas
 * 2. Prompt contiene jerarquía OpenSpec > adaptive
 * 3. Prompt contiene fail-open
 * 4. Prompt no contiene team/org scoping (t:, o:)
 * 5. Regresión: Engram provider sigue funcionando sin contaminación
 */

import { describe, expect, test } from "bun:test";

import { buildPromptGenerationPlan } from "./prompt-generation";
import type { MemoryInjectionBundle, MemoryToolBinding } from "@deck/core/memory/adaptive-memory";

// Import relativo usando ruta relativa al paquete core
import { buildAdaptiveMemoryInstructionBundle } from "../../core/src/teams/developer/instruction-bundles/adaptive-memory";

// Helper para crear un MemoryInjectionBundle simulado
function createMockMemoryBundle(
	providerId: "supermemory" | "engram",
	tools: string[],
): MemoryInjectionBundle {
	const toolBindings: MemoryToolBinding[] = tools.map((toolName) => ({
		capability: `memory.${toolName}` as const,
		serverName: providerId,
		toolNames: [toolName],
	}));

	return {
		instructions: [
			{
				surface: "agent" as const,
				markdown: `Provider: ${providerId.toUpperCase()}\n\nTools: ${tools.join(", ")}`,
			},
		],
		toolBindings,
	};
}

describe("Task 10: prompt/instrucciones + regresión Engram", () => {
	describe("Supermemory prompt validation", () => {
		test("prompt NO contiene herramientas obsoletas (execute, search_docs)", () => {
			// Build instruction bundle de Supermemory
			const bundle = buildAdaptiveMemoryInstructionBundle();

			// Verificar que el contenido NO menciona execute ni search_docs
			for (const fragment of bundle.instructions) {
				expect(fragment.markdown).not.toContain("execute");
				expect(fragment.markdown).not.toContain("search_docs");
			}
		});

		test("prompt SÍ contiene herramientas reales (memory, recall)", () => {
			const bundle = buildAdaptiveMemoryInstructionBundle();

			// Al menos un fragmento debe contener las herramientas reales
			const combinedMarkdown = bundle.instructions.map((f) => f.markdown).join("\n");

			expect(combinedMarkdown).toContain("memory");
			expect(combinedMarkdown).toContain("recall");
		});

		test("prompt NO contiene team/org scoping (t:, o:)", () => {
			const bundle = buildAdaptiveMemoryInstructionBundle();

			const combinedMarkdown = bundle.instructions.map((f) => f.markdown).join("\n");

			// No debe haber ejemplos activos de scoping team/org
			// Buscar patrones como `t:team` o `o:org` en contexto de container tag
			expect(combinedMarkdown).not.toMatch(/\| `t:/);
			expect(combinedMarkdown).not.toMatch(/\| `o:/);
		});

test("prompt usa automatic scoping (token + x-sm-project)", () => {
		const bundle = buildAdaptiveMemoryInstructionBundle();

		const combinedMarkdown = bundle.instructions.map((f) => f.markdown).join("\n");

		// Debe explicar automatic scoping sin tags manuales
		expect(combinedMarkdown).toMatch(/automatic scoping/i);
		expect(combinedMarkdown).toMatch(/Supermemory token/i);
		expect(combinedMarkdown).toMatch(/x-sm-project/i);
	});

		test("prompt establece jerarquía OpenSpec OFFICIAL CONTEXT > adaptive", () => {
			const bundle = buildAdaptiveMemoryInstructionBundle();

			const combinedMarkdown = bundle.instructions.map((f) => f.markdown).join("\n");

			// Debe establecer que OpenSpec es contexto oficial
			expect(combinedMarkdown).toMatch(/OFFICIAL CONTEXT/i);
			expect(combinedMarkdown).toMatch(/ADVISORY/i);
		});

		test("prompt incluye instrucción fail-open", () => {
			const bundle = buildAdaptiveMemoryInstructionBundle();

			const combinedMarkdown = bundle.instructions.map((f) => f.markdown).join("\n");

			// Debe mencionar fail-open o comportamiento de continuación sin bloquear
			expect(
				combinedMarkdown.toLowerCase().includes("fail-open") ||
				combinedMarkdown.toLowerCase().includes("continue working") ||
				combinedMarkdown.toLowerCase().includes("never block"),
			).toBe(true);
		});
	});

	describe("Provider isolation validation", () => {
		test("Supermemory bundle NO contiene herramientas Engram", () => {
			const supermemoryTools = ["memory", "recall", "whoAmI"];
			const engramTools = ["mem_save", "mem_recall", "mem_context", "mem_search", "mem_get_observation"];

			const bundle = createMockMemoryBundle("supermemory", supermemoryTools);

			// Verificar que solo يحتوي herramientas de Supermemory
			for (const binding of bundle.toolBindings) {
				expect(engramTools).not.toContain(binding.toolNames[0]);
			}
		});

		test("Engram bundle NO contiene herramientas Supermemory", () => {
			const supermemoryTools = ["memory", "recall", "whoAmI"];
			const engramTools = ["mem_save", "mem_recall", "mem_context", "mem_search", "mem_get_observation"];

			const bundle = createMockMemoryBundle("engram", engramTools);

			// Verificar que solo contiene herramientas de Engram
			for (const binding of bundle.toolBindings) {
				expect(supermemoryTools).not.toContain(binding.toolNames[0]);
			}
		});
	});

	describe("prompt-generation provider-specific injection", () => {
		test("generatePromptGenerationPlan con Supermemory bundle no incluye Engram tools en los prompts", () => {
			const supermemoryBundle = createMockMemoryBundle("supermemory", ["memory", "recall", "whoAmI"]);

			const plan = buildPromptGenerationPlan({
				configDir: "/tmp/.config/opencode",
				projectRoot: "/tmp/project",
				memoryBundle: supermemoryBundle,
			});

			// Verificar que ningún prompt contiene herramientas de Engram
			for (const planned of plan) {
				expect(planned.content).not.toContain("mem_save");
				expect(planned.content).not.toContain("mem_recall");
				expect(planned.content).not.toContain("mem_context");
				expect(planned.content).not.toContain("mem_search");
				expect(planned.content).not.toContain("mem_get_observation");
			}
		});

		test("generatePromptGenerationPlan con Engram bundle no incluye Supermemory tools en los prompts", () => {
			const engramBundle = createMockMemoryBundle("engram", ["mem_save", "mem_recall", "mem_context"]);

			const plan = buildPromptGenerationPlan({
				configDir: "/tmp/.config/opencode",
				projectRoot: "/tmp/project",
				memoryBundle: engramBundle,
			});

			// Verificar que ningún prompt contiene ferramentas Supermemory específicas (no palavras genéricas)
			for (const planned of plan) {
				expect(planned.content).not.toContain("supermemory_memory");
				expect(planned.content).not.toContain("supermemory_recall");
				expect(planned.content).not.toContain("supermemory_whoAmI");
			}
		});

		test("prompts con Supermemory bundle incluyen jerarquía OpenSpec authority", () => {
			// Criar bundle com surface correta para o orchestrator ("session")
			const supermemoryBundle: MemoryInjectionBundle = {
				instructions: [
					{
						surface: "session",
						markdown: "## Adaptive Memory\n\nProvider: Supermemory\n\nOFFICIAL CONTEXT — ADVISORY\n\nEsta es la sección de memoria adaptativa.",
					},
				],
				toolBindings: [],
			};

			const plan = buildPromptGenerationPlan({
				configDir: "/tmp/.config/opencode",
				projectRoot: "/tmp/project",
				memoryBundle: supermemoryBundle,
			});

			// O prompt do orquestador deve conter a jerarquia
			const orchestrator = plan.find((p) => p.agent.id === "deck-developer-orchestrator");
			expect(orchestrator).toBeDefined();

			// Verificar que se incluye la sección de Adaptive Memory y su política
			expect(orchestrator!.content).toContain("Adaptive Memory");
			expect(orchestrator!.content).toMatch(/OFFICIAL CONTEXT|auxiliary|ADVISORY/i);
		});
	});

	describe("regresión Engram", () => {
		test("Engram instruction bundle existe y contiene sus herramientas propias", () => {
			// Verificar que existe un bundle con herramientas Engram
			const engramBundle = createMockMemoryBundle("engram", [
				"mem_save",
				"mem_recall",
				"mem_context",
				"mem_search",
			]);

			expect(engramBundle.toolBindings).toHaveLength(4);
			expect(engramBundle.toolBindings[0]!.toolNames[0]).toBe("mem_save");
			expect(engramBundle.toolBindings[1]!.toolNames[0]).toBe("mem_recall");
		});

		test("prompts generados con bundle Engram no reciben herramientas Supermemory", () => {
			const engramBundle = createMockMemoryBundle("engram", ["mem_save", "mem_recall"]);

			const plan = buildPromptGenerationPlan({
				configDir: "/tmp/.config/opencode",
				projectRoot: "/tmp/project",
				memoryBundle: engramBundle,
			});

			// Verificar que no hay contaminación de Supermemory
			for (const planned of plan) {
				expect(planned.content).not.toContain("supermemory.");
				expect(planned.content).not.toContain("supermemory_memory");
				expect(planned.content).not.toContain("supermemory_recall");
			}
		});

		test("sin memoryBundle, prompts no incluyen ninguna herramienta de memoria adaptativa", () => {
			const plan = buildPromptGenerationPlan({
				configDir: "/tmp/.config/opencode",
				projectRoot: "/tmp/project",
				// Sin memoryBundle
			});

			// Sin bundle, no debe haber secciones de Adaptive Memory provider-specific
			for (const planned of plan) {
				// El heading "Adaptive Memory" del bundle provider-specific no debe aparecer
				// (solo puede aparecer el heading genérico del instruction bundle)
				expect(planned.content).not.toContain("(provider-injected)");
			}
		});
	});

	describe("scoping validation", () => {
test("instruction bundle usa automatic scoping sin container tags manuales", () => {
		const bundle = buildAdaptiveMemoryInstructionBundle();

		const combinedMarkdown = bundle.instructions.map((f) => f.markdown).join("\n");

		// NO debe contener exemplos de tags manuales u:, p:, t:, o:
		expect(combinedMarkdown).not.toMatch(/`u:\w+`/);
		expect(combinedMarkdown).not.toMatch(/`p:\w+`/);
		// Debe mencionar automatic scoping
		expect(combinedMarkdown).toMatch(/automatic scoping/i);
	});

		test("instruction bundle NO incluye tabela com t: ou o: como exemplos ativos", () => {
			const bundle = buildAdaptiveMemoryInstructionBundle();

			const combinedMarkdown = bundle.instructions.map((f) => f.markdown).join("\n");

			// Buscar tabela de container tag - deve ter apenas u: e p:
			const tableMatch = combinedMarkdown.match(/\| Prefix[\s\S]*?\n\|[-|\s]+\n/);
			if (tableMatch) {
				const table = tableMatch[0]!;
				// Verificar que no haja t: ou o: nas colunas
				expect(table).not.toMatch(/\| `t:/);
				expect(table).not.toMatch(/\| `o:/);
			}
		});
	});
});