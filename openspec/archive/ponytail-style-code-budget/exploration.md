# Exploration: Controles de economía de código estilo Ponytail para Deck

## Resumen ejecutivo

Esta exploración formaliza la idea de dotar a Deck de una **postura más crítica frente a las implementaciones**, inspirada en Ponytail, sin convertirla en una correa artificial de líneas de código. El objetivo es que los agentes de aplicación (Apply) y de revisión (Review) sean más exigentes para eliminar código innecesario, abstracciones no solicitadas, dependencias evitables y "boilerplate para más adelante", **pero siempre subordinando la economía de código a la calidad, seguridad, completitud, tests, accesibilidad, mantenibilidad y al comportamiento explícitamente pedido por el usuario**.

**Diagnóstico central**: hay dos formas de entender la economía de código, y solo una es aceptable para este cambio.

| Enfoque | Definición | Estado en Deck |
|---|---|---|
| **Economía como juicio crítico / presión de calidad** | Antes de añadir código, el agente pregunta: ¿hace falta?, ¿lo cubre la stdlib?, ¿una feature nativa?, ¿una dependencia ya instalada?, ¿puede ser más simple? La reducción de LOC es una **consecuencia**, no una meta. | **No existe** como política explícita en los prompts de Apply ni como dimensión de Review. |
| **Economía como tope artificial de LOC/archivos** | Presupuestos rígidos de líneas o archivos que, si se superan, bloquean o penalizan el avance, con riesgo de recortar requisitos, tests o manejo de errores. | **Rechazado explícitamente** por el usuario. No se implementará como objetivo primario. |

Por tanto, la propuesta no es añadir un "modo Ponytail" que castigue volumen, sino un **paquete de instrucciones de economía de código (`code-economy`)** que refuerce el juicio crítico en los agentes Apply y Review, junto con **guardarraíles anti-subimplementación** y señales de advertencia (no gates duros) de volumen.

## Estado actual

Deck ya cuenta con una arquitectura de control relativamente madura para el flujo SDD:

- **Capas de prompts centralizadas**: `packages/core/src/teams/developer/apply-*-content.ts`, `review-content.ts`, `verify-content.ts`, `task-content.ts`, `orchestrator-content.ts` definen el comportamiento de cada agente.
- **Sistema de instruction bundles**: `instruction-bundles/index.ts` permite inyectar paquetes de instrucciones opcionales (`codebase-memory`, `context-mode`, `rtk`, `adaptive-memory`, `serena`) en los prompts de agente/skill/sesión. Se activan desde `deck-config.ts` mediante `packageInstructions.{runner}.{package}`.
- **Registry de contenido**: `content-registry.ts` compone el contenido base con context-authority guidance y capability instructions.
- **Controles de runtime en `packages/sdd-runtime/src/orchestrator/`**: `budget-watchdog.ts` vigila tokens/turnos/tiempo/toolCalls; `risk-scorer.ts`, `quality-router.ts` y `enforcement-mode.ts` soportan modos `report-only` → `conditional-routing` → `full-enforcement`.
- **Task ya tiene previsión de carga**: `task-content.ts` incluye `Review Workload Forecast` con rangos de líneas cambiadas (`<100`, `100-400`, `400-800`, `800+`) y riesgo asociado al presupuesto de 400 líneas, pero es una señal de revisión, no un gate de implementación.

Sin embargo, **no existe una política explícita de minimalismo crítico** que los Apply agents deban seguir, ni una dimensión de revisión que evalúe si el código añadido era realmente necesario. Los prompts de Apply dicen "Make minimal changes" y "Do not refactor unrelated code", pero no dan una escalera de decisión ni una lista de no-negociables.

## Archivos relevantes

- `packages/core/src/teams/developer/apply-general-content.ts` — cuerpo del agente/skill General Apply; destino natural del bundle `code-economy`.
- `packages/core/src/teams/developer/apply-backend-content.ts` — cuerpo del agente/skill Backend Apply; debe recibir las reglas de economía para lógica de servidor.
- `packages/core/src/teams/developer/apply-frontend-content.ts` — cuerpo del agente/skill Frontend Apply; debe recibir las reglas de economía para UI/estado/accesibilidad.
- `packages/core/src/teams/developer/review-content.ts` — cuerpo del agente/skill Review; debe añadir la dimensión `Economy / Critical Judgment`.
- `packages/core/src/teams/developer/task-content.ts` — plantilla de tareas y `Review Workload Forecast`; se mantiene como señal de advertencia, no como cap.
- `packages/core/src/teams/developer/instruction-bundles/index.ts` — builders, orden y composición de capability bundles.
- `packages/core/src/config/deck-config.ts` — `PACKAGE_INSTRUCTION_PACKAGE_IDS` y defaults de `packageInstructions`; aquí se registraría `code-economy`.
- `packages/sdd-runtime/src/orchestrator/budget-watchdog.ts` — vigila presupuestos de tiempo/tokens/turnos; referencia para no duplicar ni confundir con presupuestos de código.
- `packages/sdd-runtime/src/orchestrator/risk-scorer.ts` — podría incorporar una señal de advertencia `over-engineering` o `code-volume` con peso bajo.
- `packages/sdd-runtime/src/orchestrator/enforcement-mode.ts` — define modos `report-only`, `conditional-routing`, `full-enforcement`; el modo por defecto para economía de código debe ser `report-only`.

## Restricciones

1. **No tope artificial de LOC**: los presupuestos de líneas/archivos son señales de advertencia y disparadores de justificación, nunca objetivos primarios ni gates duros.
2. **Calidad primero**: requisitos, tests, seguridad, accesibilidad, validación de fronteras de confianza, seguridad de datos, manejo de errores y mantenibilidad tienen prioridad absoluta sobre la reducción de código.
3. **Reutilizar infraestructura existente**: el bundle debe integrarse con `instruction-bundles/index.ts` y `deck-config.ts`, no crear un sistema paralelo.
4. **Modo report-only por defecto**: cualquier gate de volumen debe comenzar en modo informativo; el paso a `conditional-routing` o `full-enforcement` requiere decisión explícita posterior.
5. **Runner-agnostic**: las instrucciones deben ser texto markdown neutral, sin suponer OpenCode, Pi u otro runner.
6. **No modificar comportamiento por defecto de SDD**: salvo que el usuario active `packageInstructions.{runner}.code-economy`, el flujo actual debe seguir igual.

## Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Sub-implementación**: el agente omite requisitos, tests o manejo de errores para reducir líneas. | Alto | Lista explícita de no-negociables en el bundle; Review evalúa `Economy / Critical Judgment` solo después de verificar completitud; Verify mantiene su matriz de cumplimiento. |
| **Regresión de calidad**: el agente elige soluciones de "una línea" incorrectas o inseguras. | Alto | Las reglas deben exigir que validación, seguridad y accesibilidad nunca se simplifiquen; Review puede rechazar cambios con hallazgo `BLOCKER` en seguridad o calidad. |
| **Gaming de métricas**: dividir cambios en muchos archivos pequeños o reformatear para reducir LOC. | Medio | Las señales de volumen deben incluir archivos afectados y justificación cualitativa, no solo LOC; Review detecta fragmentación artificial. |
| **Falsos positivos en cambios legítimamente grandes**: migraciones, refactorizaciones o features complejas requieren mucho código. | Medio | El `Review Workload Forecast` y cualquier señal de volumen son **advisory**; el usuario o el Spec/Design pueden justificar volúmenes grandes. |
| **Fricción del desarrollador**: prompts más críticos pueden ralentizar la implementación o generar más idas y vueltas. | Medio | El bundle debe ser conciso y actionable; no exigir comentarios especiales ni ledgers adicionales en la primera fase. |
| **Inconsistencia entre runners**: diferentes adapters pueden componer el bundle de forma distinta. | Bajo | Usar `composeCapabilityInstructions` existente y tests de contenido para cada runner que active el paquete. |

## Opciones y tradeoffs

### Opción A — Bundle de instrucciones `code-economy` (recomendada)

Crear un capability instruction bundle `code-economy` que inyecte en Apply agents y Review una política de juicio crítico: escalera de decisión, reglas de no-sobre-ingeniería, lista de no-negociables y una dimensión de revisión `Economy / Critical Judgment`.

- **Pros**: reutiliza toda la infraestructura existente; es reversible; no toca schemas ni runtime; se activa por config; no impone gates duros.
- **Contras**: depende de que el LLM siga las instrucciones; no hay enforcement automático.
- **Esfuerzo**: Bajo-Medio.

### Opción B — Añadir justificación de volumen en Task y Apply-progress

Extender la plantilla de Task para que incluya, opcionalmente, una sección `Code Economy Note` (justificación si se prevé volumen alto) y que Apply-progress incluya un self-check de economía de código.

- **Pros**: trazable en OpenSpec; refuerza la responsabilidad del agente; no bloquea.
- **Contras**: añade campos adicionales a los artifacts; puede sentirse burocrático si no se mantiene opcional.
- **Esfuerzo**: Medio.

### Opción C — Gate duro de diff-budget en runtime (descartada por ahora)

Calcular estadísticas reales del diff tras Apply y bloquear el avance si se supera un presupuesto sin justificación/override.

- **Pros**: enforcement real.
- **Contras**: contradice el mandato del usuario de no usar un tope artificial; riesgo alto de sub-implementación y falsos positivos; requiere UI/CLI para overrides.
- **Esfuerzo**: Medio-Alto.
- **Decisión**: **No recomendada** salvo que futuros datos justifiquen una fase posterior con guardarraíles muy fuertes.

### Opción D — Copiar el ecosistema completo de Ponytail (descartada)

Crear comandos `/deck-economy`, marcadores `deck:`, skills de auditoría y deuda, etc.

- **Pros**: experiencia de usuario clara.
- **Contras**: duplica Ponytail; aumenta superficie de mantenimiento; Deck ya tiene SDD y OpenSpec.
- **Esfuerzo**: Medio-Alto.
- **Decisión**: **No recomendada**.

## Recomendación

Implementar una **fase inicial combinada A + B**:

1. **Crear el bundle `code-economy`** (`packages/core/src/teams/developer/instruction-bundles/code-economy.ts`) con fragmentos para `surface: agent` y `surface: skill` dirigidos a `deck-developer-apply-general`, `apply-backend`, `apply-frontend` y `deck-developer-review`.
2. **Contenido del bundle**:
   - Escalera de decisión adaptada a Deck (stdlib/feature nativa/dependencia existente/una línea/lo mínimo que funciona).
   - Reglas: sin abstracciones no solicitadas, sin dependencias nuevas si se puede evitar, sin boilerplate futurista, deleción por encima de adición.
   - **Guardarraíles anti-subimplementación**: lista explícita de lo que NUNCA se simplifica.
   - Dimensión de Review `Economy / Critical Judgment` con ratings Strong/Adequate/Weak.
3. **Registrar el bundle** en `deck-config.ts` (`PACKAGE_INSTRUCTION_PACKAGE_IDS`) y en `instruction-bundles/index.ts` (`PACKAGE_BUILDERS`, `PACKAGE_ORDER`).
4. **Mantener `Review Workload Forecast` como señal advisory**; no convertirlo en gate.
5. **No añadir gates duros de LOC** en esta fase.
6. **Evaluar** en 3-5 cambios reales antes de considerar cualquier enforcement adicional.

## Guardarraíles anti-subimplementación y regresión

Estos guardarraíles deben formar parte del bundle y de la dimensión de Review:

1. **Nunca sacrificar**: requisitos, tests, seguridad, accesibilidad, validación de fronteras de confianza, seguridad de datos, manejo de errores, mantenibilidad ni comportamiento explícitamente pedido por el usuario.
2. **Los presupuestos de LOC/archivos son señales advisory y disparadores de justificación, no objetivos primarios ni gates duros**.
3. **Review y Verify deben verificar primero la completitud y luego la economía**.
4. **Una solución más corta no es mejor si es menos segura, menos testeable, menos accesible o más difícil de mantener**.
5. **Las abstracciones están prohibidas solo cuando son no solicitadas**; si el Spec/Design las requieren, se implementan.
6. **Las dependencias nuevas deben justificarse**, pero usar una dependencia ya instalada o la stdlib es preferible a reinventar.
7. **El modo por defecto es report-only**: el agente informa sobre economía, pero no puede omitir funcionalidad para cumplir una métrica.

## Diagnóstico accionable

Sí. La exploración identifica una brecha clara: Deck no tiene una política explícita de juicio crítico sobre economía de código en sus prompts de Apply y Review. La solución recomendada es un capability instruction bundle `code-economy` integrado en la infraestructura existente, con guardarraíles fuertes contra sub-implementación y sin gates duros de LOC.

## Resultado de lifecycle sugerido

`propose` — continuar a la fase Proposal para definir alcance, riesgos, plan de rollback y criterios de aceptación.

## Preguntas abiertas

1. ¿El usuario quiere que `code-economy` esté activado por defecto en algún runner (por ejemplo, OpenCode) o que sea estrictamente opt-in?
2. ¿Se desea que el bundle afecte también al agente Task (por ejemplo, sugiriendo descomposición cuando la previsión de carga sea alta) o solo a Apply y Review?
3. ¿Hay un umbral de "código innecesario" que el usuario haya observado con frecuencia en Deck y que deba mencionarse explícitamente en el bundle?

## Preparado para Proposal

Sí. La exploración ha identificado el problema, las superficies de cambio, las opciones, los riesgos y los guardarraíles. La recomendación es implementar un capability bundle `code-economy` como instrucción de juicio crítico, no como tope de LOC, integrado en la infraestructura existente de instruction bundles y manteniendo el modo report-only por defecto.

---

**Nota metodológica**: Esta exploración reemplaza y formaliza cualquier exploración previa informal del mismo cambio. El registro de estado y eventos conserva el historial anterior.
