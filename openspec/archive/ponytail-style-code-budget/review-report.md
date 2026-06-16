# Review Report: Presupuesto de código estilo Ponytail para Deck

## Summary

**Overall Rating**: APPROVE
**Scope**: general
**Files Reviewed**: 2 (deck-config.ts, action-runner.ts)

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Normalización localizada en config, sin nuevas abstracciones ni acoplamiento |
| Security | ✅ Strong | Sin riesgos de seguridad — solo normalización de booleanos |
| Scalability | ✅ Strong | Sin impacto en rendimiento — operación O(1) de normalización |
| Maintainability | ✅ Strong | Código legible, comentarios explican el "por qué" (baseline, no toggle) |
| Code Quality | ✅ Strong | Sigue patrones existentes, nombres claros, duplicación mínima y justificada |
| Backend | N/A | No aplica — cambio de configuración, no API/backend |
| Frontend | ✅ Strong | TUI action-runner hardcodea correctamente con comentario explicativo |
| Integration | ✅ Strong | Consistencia entre normalización en deck-config.ts y hardcode en action-runner.ts |

## Findings

### BLOCKER
Ninguno.

### MAJOR
Ninguno.

### MINOR

- **Maintainability**: Falta cobertura automatizada de tests para normalización de valores inválidos de `code-economy`
  - **File**: `packages/core/src/config/deck-config.test.ts`
  - **Evidence**: apply-progress.md líneas 381-385 afirma "Verificación manual confirma" para casos como `"code-economy": "nope"` → true, `"code-economy": 0` → true, `"code-economy": false` → true, pero no hay tests automatizados explícitos para estos casos. Solo hay tests para el default true (líneas 103-111).
  - **Recommendation**: Añadir tests automatizados que verifiquen:
    ```typescript
    test("normalizes invalid code-economy values to true", () => {
      const config1 = validateDeckConfig({
        version: 1,
        adaptiveMemory: { activeProvider: "none" },
        packageInstructions: { pi: { "code-economy": "nope" } },
      });
      expect(config1.packageInstructions.pi["code-economy"]).toBe(true);
      
      const config2 = validateDeckConfig({
        version: 1,
        adaptiveMemory: { activeProvider: "none" },
        packageInstructions: { pi: { "code-economy": 0 } },
      });
      expect(config2.packageInstructions.pi["code-economy"]).toBe(true);
      
      const config3 = validateDeckConfig({
        version: 1,
        adaptiveMemory: { activeProvider: "none" },
        packageInstructions: { pi: { "code-economy": false } },
      });
      expect(config3.packageInstructions.pi["code-economy"]).toBe(true);
    });
    ```
  - **Impact**: Bajo — la implementación es correcta según el código, pero la verificación manual no es sostenible ni repetible.

### NIT

- **Code Quality**: Duplicación de hardcode en action-runner.ts (dos instancias de `"code-economy": true`)
  - **File**: `apps/cli/src/tui/runner-dashboard/action-runner.ts` — líneas 464 y 472
  - **Evidence**: Ambas instancias tienen el mismo comentario "Always true - baseline, not a user toggle"
  - **Recommendation**: Aceptable dado que son bloques separados (pi vs opencode) y el comentario explica el por qué. Si se refactoriza en el futuro, considerar extraer a constante `const CODE_ECONOMY_BASELINE = true;` con comentario JSDoc.
  - **Impact**: Ninguno — duplicación mínima y justificada por la estructura del código.

## Design Fidelity

**Aligned**: Yes

**Deviations**: Ninguna.

La implementación cumple con:
- REQ-CF-001: `code-economy` siempre activo en instalaciones Developer Team
- REQ-CF-002: Comportamiento por defecto incluye `code-economy` activo
- REQ-CF-003: Campo permanece en config con fines de compatibilidad/visibilidad, documentado como baseline
- Design Tradeoff: "Capability instruction bundle `code-economy` siempre activo vía normalización de config"
- Design Risk Mitigation: "defaults `true`; tests de normalización verifican que `code-economy` siempre está habilitado"

La normalización de valores inválidos a `true` (en lugar de rechazarlos) es consistente con el requisito de "no hay interruptor de usuario para desactivar". Si el usuario pone `"code-economy": false` o cualquier valor inválido, se normaliza a `true`, no se rechaza.

## Open Questions

Ninguna.

## Respuestas a Preguntas Específicas del Triage

### ¿La normalización de `code-economy` a `true` para valores inválidos preserva la seguridad y validación de config para otros paquetes?

**Sí**. El código en `deck-config.ts` líneas 599-611 implementa un branching explícito:
- Si `pkg === "code-economy"`: fuerza a `true` para CUALQUIER valor (incluyendo no-booleanos)
- Si `pkg !== "code-economy"`: preserva validación estricta, rechaza no-booleanos con `DECK_CONFIG_INVALID_SHAPE`

Esto significa que otros paquetes (codebase-memory, context-mode, rtk, adaptive-memory, serena) mantienen su validación estricta. Solo `code-economy` tiene semántica especial de normalización a `true`, lo cual es consistente con el requisito de "baseline, no toggle".

### ¿action-runner hardcodea `true` de manera mantenible?

**Sí**. El hardcode en `action-runner.ts` líneas 464 y 472 es mantenible porque:
1. Cada instancia tiene un comentario explicativo: `// Always true - baseline, not a user toggle`
2. Es consistente con la normalización en `deck-config.ts`
3. La duplicación es mínima (2 líneas) y justificada por la estructura del código (bloques separados para pi y opencode)
4. Si el requisito cambia en el futuro, ambos lugares necesitan actualización, pero eso es aceptable para un requisito baseline

### ¿Esto cumple con la intención del usuario: siempre activo, sin interruptor, sin gates hard de LOC?

**Sí**. La implementación cumple con:
- **Siempre activo**: `getDefaultDeckConfig()` devuelve `code-economy: true`, `normalizePackageInstructionConfig()` fuerza `true` incluso si el usuario pone `false`, TUI action-runner hardcodea `true`
- **Sin interruptor**: No hay forma de desactivar `code-economy` vía config — cualquier valor se normaliza a `true`
- **Sin gates hard de LOC**: apply-progress.md confirma que el bundle NO contiene frases como "MUST stay under N lines", "hard LOC cap", "block if over budget", "reject if over". Los tests negativos (Fix 4) verifican ausencia de gates.

### ¿Hay regresiones en el flujo de config del TUI?

**No**. El cambio en `action-runner.ts` es mínimo (2 líneas añadidas). El apply-progress.md indica que "Los tests de TUI action-runner que fallan son preexistentes (no relacionados con code-economy)". No hay evidencia de regresión introducida por este cambio.

## Conclusiones

La implementación del Fix #4 es correcta y cumple con los requisitos del spec y design. La normalización de valores inválidos a `true` para `code-economy` preserva la validación estricta para otros paquetes. El hardcode en action-runner.ts es mantenible y está bien documentado. No hay regresiones en el flujo de config del TUI.

El único hallazgo es MINOR: falta cobertura automatizada de tests para la normalización de valores inválidos. La verificación manual no es suficiente para garantizar que el comportamiento se mantiene en el futuro. Se recomienda añadir tests automatizados para los casos de valores inválidos.

**Recomendación**: APPROVE con la sugerencia de añadir tests automatizados para normalización de valores inválidos de `code-economy` en una futura iteración o antes de archive si el equipo lo considera necesario.
