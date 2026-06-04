# Auditoría de deuda técnica — Deck

Fecha: 2026-06-03  
Alcance: `/home/kevinlb/deck`  
Modo: análisis sin SDD formal, sin modificaciones de código.

## Resumen ejecutivo

El repo tiene deuda técnica prioritaria en la red de seguridad: **typecheck roto** y **tests fallando**. Además, hay metadata de release desincronizada, OpenSpec con cambios activos/desactualizados, y fronteras arquitectónicas que se erosionaron entre TUI, core y adapters.

La prioridad recomendada es recuperar confianza en el proyecto antes de refactors grandes:

1. Arreglar metadata/docs de release.
2. Llevar typecheck a cero errores.
3. Reducir los tests fallando por cluster.
4. Podar estado OpenSpec obsoleto.
5. Recién después, atacar refactors estructurales.

> Nota: memorias previas sobre `auth.shop`, `requireVerifiedEmail` y PostgreSQL `127.0.0.1:5433` no aplican a este repo; parecen venir de otro proyecto.

## Hallazgos principales

### P0 — Typecheck roto

**Evidencia**

- `bunx tsc --noEmit`: **125 errores en 20 archivos**.
- Archivos con mayor concentración:
  - `apps/cli/src/tui/app.tsx`
  - `packages/adapter-opencode/src/install-tools.ts`
  - `packages/adapter-pi/src/install-tools.ts`
  - `apps/cli/src/tui/developer-team-flow.test.tsx`
  - `apps/cli/src/pi-launch-command.direct-supermemory.test.ts`
  - `apps/cli/src/runtime/process.ts`

**Riesgo**

Alto. Los reportes históricos de verificación no reflejan el estado actual del árbol. Un release puede salir con errores conocidos de tipado.

**Primera acción recomendada**

Agrupar errores por archivo y atacar los patrones dominantes: `string | null`, arrays `readonly`, `RunnerScope`, propiedades inexistentes en config.

### P0 — Tests fallando

**Evidencia**

- `bun test`: **2541 pass / 50 fail**.
- Clusters principales:
  - `apps/cli/src/tui/runner-dashboard/action-runner.test.ts`
  - `apps/cli/src/tui/runner-dashboard/reducer.test.ts`
  - `packages/adapter-pi/src/developer-team-install.test.ts`
  - `packages/core/src/__tests__/core-purity-audit.test.ts`
  - `apps/cli/src/upgrade-command/__tests__/*`

**Riesgo**

Alto. La suite ya no es una red de seguridad confiable.

**Primera acción recomendada**

Resolver por cluster, no test por test. Cada cluster representa una decisión o regresión distinta.

### P0/P1 — Metadata de versión desincronizada

**Evidencia**

- `package.json`: `0.1.4`
- `README.md`: `0.0.4`
- `CHANGELOG.md`: link `[Unreleased]` apunta a `gentleman-programming/deck` en vez de `kevin15011/deck`.

**Riesgo**

Medio. Confunde a usuarios, integradores y tooling de release.

**Primera acción recomendada**

Sincronizar versión canónica y corregir el link del changelog.

### P1 — OpenSpec desactualizado/sucio

**Evidencia**

- Aproximadamente 30 cambios activos o históricos en `openspec/changes`.
- Hay cambios abandonados, incompletos o con reports `PASS WITH WARNINGS` que ya no representan el estado real.

**Riesgo**

Medio. Los artifacts oficiales generan falsa confianza si no reflejan el árbol actual.

**Primera acción recomendada**

Podar cambios abandonados y re-verificar cambios cuyo estado contradice typecheck/tests actuales.

### P1 — Fronteras arquitectónicas erosionadas

**Evidencia**

- Archivos grandes:
  - `packages/adapter-opencode/src/developer-team-install.ts` — ~923 líneas
  - `apps/cli/src/tui/runner-dashboard/action-runner.ts` — ~888 líneas
  - `packages/adapter-opencode/src/runner-adapter.ts` — ~854 líneas
  - `packages/core/src/config/deck-config.ts` — ~847 líneas
  - `packages/adapter-pi/src/developer-team-install.ts` — ~811 líneas
- TODOs y duplicaciones entre core/adapters.
- `core-purity-audit.test.ts` detecta literales concretos de providers como `supermemory`, `engram` u `opencode` en core.

**Riesgo**

Medio-alto. La arquitectura hexagonal pierde valor si las excepciones quedan permanentes.

**Primera acción recomendada**

Resolver primero TODOs/imports obvios; después planear extracción de helpers en archivos >800 líneas.

### P1 — Falta linter/formatter declarado

**Evidencia**

- `openspec/config.yaml` declara linter/formatter no disponibles.
- No se observó config clara de ESLint/Prettier/Biome en raíz.

**Riesgo**

Medio. La calidad queda demasiado dependiente del typecheck y tests, que hoy fallan.

**Primera acción recomendada**

Elegir Biome o ESLint+Prettier e integrarlo como script mínimo.

### P2 — Artefactos locales pesados

**Evidencia**

- `dist/cli/`: ~779 MB.
- `apps/cli/install/`: ~96 MB.
- Están ignorados, pero inflan el árbol local.

**Riesgo**

Bajo. Afecta DX, búsquedas y velocidad local.

**Primera acción recomendada**

Agregar script `clean:dist` o equivalente y documentarlo.

## Quick wins seguros

1. Sincronizar `README.md`, `CHANGELOG.md` y `package.json` con la versión actual.
2. Corregir link `[Unreleased]` del changelog.
3. Agregar script de limpieza para `dist/` y `apps/cli/install/`.
4. Podar OpenSpec abandonado o claramente cerrado.
5. Restaurar imports/TODOs obvios que duplican lógica entre core y adapters.

## Deudas que requieren decisión

1. **Semántica de `action-runner`**
   - Decidir si acciones sin writer/installer adapter-specific deben ser `skipped` o `failed`.

2. **Pureza de core**
   - Decidir si core puede mencionar providers concretos (`supermemory`, `engram`, `opencode`) o si debe mantenerse totalmente provider-agnostic.

3. **Política de OpenSpec histórico**
   - Decidir si reports viejos se mantienen como históricos aunque el árbol actual no pase, o si se re-verifican y se actualizan.

4. **Linter/formatter**
   - Decidir entre Biome, ESLint+Prettier o mantener ausencia explícita.

5. **Refactor de archivos grandes**
   - Decidir si se aborda como limpieza progresiva o como cambio estructural planificado.

## Qué no tocar todavía

- No modificar bundles de memoria/Serena en core sin plan de compatibilidad.
- No eliminar wrappers `@deprecated` sin auditar consumidores.
- No relajar tests de arquitectura para que pasen sin arreglar la causa.
- No refactorizar `apps/cli/src/tui/app.tsx` a ciegas; primero mapear errores por patrón.
- No limpiar contenido de `CHANGELOG.md` sin decidir qué versión absorbe cada entrada.

## Plan sugerido de ejecución

### Lote 0 — Higiene rápida

- Sincronizar metadata de versión.
- Corregir changelog.
- Agregar script/documentación de limpieza de artefactos locales.
- Podar OpenSpec abandonado o claramente obsoleto.

### Lote 1 — Recuperar red de seguridad

- Reducir typecheck de 125 errores a 0.
- Atacar tests fallando por cluster.
- Restaurar imports/TODOs obvios.
- Completar warnings de APIs deprecated si aplica.

### Lote 2 — Decisiones arquitectónicas

- Resolver semántica de `action-runner`.
- Resolver pureza de core vs providers concretos.
- Elegir e integrar linter/formatter.

### Lote 3 — Refactor estructural

- Partir archivos >800 líneas.
- Eliminar shims deprecated sin consumidores.
- Endurecer tests de frontera TUI/core/adapters.

### Lote 4 — Re-verificación

- Re-correr typecheck y test suite completa.
- Comparar contra OpenSpec histórico.
- Crear cambios nuevos solo donde haya divergencias reales que requieran trazabilidad.

## Verificaciones recomendadas

```bash
bunx tsc --noEmit
bun test
git status
```

Métricas útiles para seguimiento:

- Errores TypeScript restantes.
- Tests fallando por archivo/cluster.
- Cantidad de cambios OpenSpec activos.
- Tamaño de `dist/` y `apps/cli/install/`.
- Cantidad de archivos fuente >800 líneas.
- Cantidad de wrappers `@deprecated` activos.

## Recomendación final

Empezar por **Lote 0 + Lote 1**. Eso recupera confianza sin requerir grandes decisiones de producto o arquitectura. Después conviene decidir explícitamente la semántica de `action-runner`, la pureza de core y la política de lint/format antes de refactors grandes.
