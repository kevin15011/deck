# Exploración: Visibilidad y configuración del nivel de esfuerzo de razonamiento (reasoning effort) por modelo

## Meta

- **Solicitante**: Usuario (Kevin)
- **Fecha**: 2026-06-04
- **Idioma**: Bilingüe (español primero, términos técnicos en inglés)

---

## 1. Objetivo

Determinar por qué el nivel de esfuerzo de razonamiento (`reasoningEffort`) aparece para todos los modelos en la TUI de instalación/configuración, cuando no todos los modelos realmente soportan razonamiento. Identificar los puntos de modificación necesarios para que solo se muestre/configura para modelos que lo soportan.

---

## 2. Estado Actual (Current State)

### 2.1 Catálogo canónico de modelos (`packages/core/src/model-catalog.ts`)

- `ModelEntry` tiene campo `capabilities: ModelCapability[]` con valores como `"tool-use"`, `"reasoning"`, `"vision"`, `"local"`
- `ModelEntry` también tiene campo `supportsReasoning?: boolean` — pero solo **1 de 25 modelos** lo usa explícitamente (`opencode-go/deepseek-v4-flash` con `false`)
- **14 modelos** tienen `"reasoning"` en `capabilities`
- **11 modelos** NO tienen `"reasoning"` en `capabilities` pero no explicitan `supportsReasoning: false`
- El campo `supportsReasoning` está subutilizado: 24/25 modelos no lo definen

### 2.2 Adaptador OpenCode (`packages/adapter-opencode/src/model-config.ts`)

`supportsThinkingForOpenCodeModel(model)`:
```typescript
if (model.endsWith("/deepseek-v4-flash")) return false;
return true;
```
**Problema**: Check extremadamente simple. Devuelve `true` para modelos que NO soportan reasoning, como:
- `openai/gpt-4o`, `openai/gpt-4o-mini`, `openai/gpt-4-turbo`
- `google/gemini-2.5-flash`
- `groq/llama-3.3-70b`, `groq/mixtral-8x7b`
- `ollama/llama3.3`, `ollama/qwen2.5-coder`, `ollama/deepseek-coder-v2`
- `mistral/mistral-medium`

### 2.3 Adaptador Pi (`packages/adapter-pi/src/model-config.ts`)

`supportsThinkingForModel(model)`:
```typescript
if (model.thinking === false) return false;
if (providerId === "opencode-go") return false;  // COMPAT histórico
if (modelId.endsWith("/kimi-k2.6")) return false; // COMPAT histórico
return true;
```
**Problema**: Es demasiado conservador — deshabilita thinking para TODOS los modelos `opencode-go` y `kimi-k2.6`, incluso los que SÍ soportan reasoning (`opencode-go/deepseek-v4-pro`, `opencode-go/qwen3.6-plus`). Esto es un workaround por un bug histórico de Pi con mensajes `assistant` que contienen `reasoning`.

**Ninguno de los dos adaptadores consulta el catálogo canónico (`ModelCatalog`) para determinar capacidad real.**

### 2.4 Flujo TUI (`apps/cli/src/tui/app.tsx`)

**Pantalla `agent-model-config-list`** (línea 278-284):
```tsx
hint: assigned
  ? `${assigned} · thinking ${thinking ?? "default"}`
  : "not configured"
```
Muestra "thinking [nivel]" para **todos** los agentes que tengan modelo asignado, incluso si el modelo no soporta razonamiento. El hint no condiciona por capacidad del modelo.

**Pantalla `agent-model-assignment`** (línea 219-268):
- Renderiza SIEMPRE "Select reasoning for [agent]" aunque `supportsThinking=false`
- Cuando `supportsThinking=false`, muestra aviso amarillo en vez de selector
- Pero el screen ya no se visita para modelos sin thinking (ver abajo)

**Lógica de navegación** (línea 1529-1562):
- El flujo YA evita la pantalla `agent-model-assignment` cuando `supportsThinking=false`
- Asigna modelo directamente y vuelve a `agent-model-config-list`
- **Pero**: el listado de agentes sí muestra el thinking level anterior/previo sin verificar si el modelo asignado lo soporta

**Pantalla `model-selection`** (línea 197-217):
- Muestra hint por modelo: `"Thinking not supported; using off"` vs solo el model ID
- Esta distinción funciona, pero depende de `supportsThinkingForOpenCodeModel` que es incorrecta para muchos modelos

### 2.5 Tests afectados

| Archivo | Relevancia |
|---|---|
| `packages/core/src/model-catalog.test.ts` | Pruebas de catálogo — no validan `supportsReasoning` por modelo |
| `packages/adapter-opencode/src/model-config.test.ts` | Pruebas de `supportsThinkingForOpenCodeModel` — solo cubren el modelo flash, no modelos sin reasoning |
| `packages/adapter-opencode/src/developer-team-install.test.ts` | Pruebas de flujo de instalación con reasoningEffort |
| `packages/adapter-pi/src/model-config.test.ts` | Pruebas de `supportsThinkingForModel` |
| `apps/cli/src/tui/developer-team-flow.test.tsx` | Pruebas de pantallas TUI — `AgentModelAssignmentScreen` con `supportsThinking=false` |
| `apps/cli/src/tui/screens/developer-team-screens.test.tsx` | Pruebas de renderizado de screens |

---

## 3. Modelos relevantes

### Con razonamiento (`capabilities` incluye `"reasoning"`)
`opencode-go/kimi-k2.6`, `opencode-go/qwen3.6-plus`, `opencode-go/deepseek-v4-pro`, `openai-codex/gpt-5.5`, `openai-codex/gpt-5.4`, `openai-codex/gpt-5.1-codex-mini`, `anthropic/claude-sonnet-4`, `anthropic/claude-opus-4`, `anthropic/claude-haiku-4`, `openai/gpt-5.5`, `google/gemini-2.5-pro`, `mistral/mistral-large`, `zai-coding-plan/glm-5.1`, `minimax-coding-plan/MiniMax-M2.7`

### Sin razonamiento (deben NO mostrar effort)
`opencode-go/deepseek-v4-flash`, `openai/gpt-4o`, `openai/gpt-4o-mini`, `openai/gpt-4-turbo`, `google/gemini-2.5-flash`, `groq/llama-3.3-70b`, `groq/mixtral-8x7b`, `ollama/llama3.3`, `ollama/qwen2.5-coder`, `ollama/deepseek-coder-v2`, `mistral/mistral-medium`

---

## 4. Riesgos y restricciones

- **Compatibilidad con configs existentes**: Si un usuario ya tiene `reasoningEffort` configurado para un modelo que no lo soporta, el cambio podría eliminar esa entrada. Se debe decidir si preservar o limpiar.
- **Regresión Pi**: El workaround `opencode-go` / `kimi-k2.6` existe por una razón histórica real. Eliminarlo sin verificar que Pi ya no tiene el bug rompería la compatibilidad con asistentes.
- **Consistencia entre adaptadores**: Actualmente OpenCode y Pi toman decisiones independientes. Si unificamos en el catálogo, ambos deben coincidir, pero Pi tiene restricciones adicionales.
- **Detección en TUI**: La TUI para OpenCode detecta modelos vía `opencode models` — estos vienen SIN metadatos de capacidad del catálogo. Hay que enriquecer los modelos detectados con datos del catálogo.
- **`supportsReasoning` vs `capabilities: ["reasoning"]`**: Hay dos mecanismos para lo mismo. Se debe elegir uno como fuente de verdad.

---

## 5. Opciones y tradeoffs

### Opción A: Usar `capabilities: ["reasoning"]` como fuente canónica
- **Qué**: El catálogo ya tiene `capabilities`. Hacer que los adaptadores consulten `getModelCatalog()` → `findModel(id)` → `capabilities.includes("reasoning")` en vez de sus checks ad-hoc.
- **Pros**: Single source of truth, sin duplicación, el catálogo ya tiene los datos correctos
- **Contras**: Requiere que TODOS los modelos sin reasoning estén correctamente marcados en el catálogo; Pi necesita mantener su excepción `opencode-go` por compatibilidad
- **Effort**: Medio — modificar `supportsThinking` en ambos adaptadores, actualizar catálogo con `supportsReasoning` explícito, ajustar TUI

### Opción B: Poblar `supportsReasoning` explícitamente en el catálogo + eliminarlo de adaptadores
- **Qué**: Añadir `supportsReasoning: true/false` a cada `ModelEntry`. Eliminar lógica ad-hoc de adaptadores y delegar al catálogo.
- **Pros**: Más explícito, más fácil de auditar, elimina lógica duplicada
- **Contras**: 24 entradas nuevas en el catálogo, mismo problema de compatibilidad Pi
- **Effort**: Bajo-Medio — cambios concentrados en catálogo + delegación

### Opción C: Mantener adaptadores independientes, solo arreglar TUI
- **Qué**: No tocar catálogo ni adaptadores. Solo condicionar la TUI para que `AgentModelConfigListScreen` oculte "thinking" cuando `supportsThinking(modelId) === false`.
- **Pros**: Mínimo cambio, menor riesgo de regresión
- **Contras**: No resuelve la inconsistencia de fondo entre adaptadores; OpenCode sigue marcando modelos incorrectos como thinking-capable
- **Effort**: Bajo

---

## 6. Recomendación

**Opción A como base, con mitigación para Pi.**

1. **Catálogo core**: Añadir `supportsReasoning: true/false` explícitamente a todos los `ModelEntry` (25 entradas). Derivar de `capabilities.includes("reasoning")` como default, permitir override.
2. **Adaptador OpenCode**: Reemplazar `supportsThinkingForOpenCodeModel` para consultar `getModelCatalog()` → `findModel(id)?.supportsReasoning ?? false`.
3. **Adaptador Pi**: Similar pero manteniendo el override `opencode-go` como excepción documentada con comentario de por qué.
4. **TUI `AgentModelConfigListScreen`**: Condicionar el hint para solo mostrar "thinking [level]" cuando el modelo asignado realmente soporta reasoning.
5. **TUI `AgentModelAssignmentScreen`**: Cuando `supportsThinking=false`, en vez de mostrar el screen con aviso amarillo, skipearlo completamente o mostrar un mensaje conciso.
6. **Tests**: Añadir tests para `supportsReasoning` en el catálogo, tests de integración para cada adaptador verificando modelos con/sin reasoning, tests TUI para hints condicionales.

---

## 7. Preguntas abiertas

- ¿Debemos preservar `reasoningEffort` en config existente para modelos sin soporte, o limpiarlo?
- ¿El workaround `opencode-go` de Pi sigue siendo necesario? (requiere verificar con versión actual de Pi)
- ¿Debe la TUI mostrar un aviso cuando un modelo no soporta reasoning, o simplemente omitir la información?
- ¿Afecta esto a la instalación automática (non-TUI) del Developer Team?

---

## 8. Listo para Proposal

**Sí** — el problema está claramente identificado, los archivos y adaptadores están mapeados, y hay una dirección recomendada.
