# Definición de trabajo: rediseño adaptativo del Developer Team

**Estado:** definición aprobada por el usuario; implementación autorizada el 2026-08-04.  
**Fecha:** 2026-08-04.  
**Propósito de este documento:** conservar decisiones, razonamiento y preguntas abiertas durante la conversación, evitando pérdida de información por compactación del chat.  
**Alcance del producto:** el Developer Team que Deck instala en los runners soportados para trabajar sobre cualquier proyecto de desarrollo. No está limitado al repositorio de Deck ni a aplicaciones TUI.

## 1. Objetivo

Rediseñar el Developer Team para que conserve las ventajas de Deck —calidad, seguridad, persistencia, selección de modelos, herramientas especializadas y continuidad entre sesiones— sin imponer una latencia o ceremonia desproporcionada.

La referencia de producto es: **una experiencia cercana a Codex limpio en velocidad y flexibilidad, con garantías explícitas y proporcionales de calidad y seguridad**.

El rediseño puede modificar agentes, skills, prompts, catálogo, rutas de ejecución, gates, OpenSpec, instaladores, adapters, invariantes, configuración de modelos y materialización en runners. Los cambios deben preservar la seguridad real y eliminar controles que solo produzcan evidencia ceremonial.

## 2. Principios inquebrantables

### P1. Flexibilidad

Deck debe adaptarse al resultado solicitado y al feedback incremental del usuario.

- Instrucciones como “sube esto”, “cambia el color”, “hazlo un poco más pequeño” o “prueba la otra opción” deben resolverse como deltas sobre el mismo candidato.
- Un delta autorizado no reinicia exploración, planeación, SDD, aprobación ni QA completa.
- Solo se vuelve a preguntar o reclasificar cuando cambia materialmente el producto, el alcance, un riesgo protegido, una operación irreversible o la autoridad de modificación.
- La cantidad de archivos no determina por sí sola el proceso.

### P2. Cero sobreingeniería

Cada agente, artifact, gate y check debe justificar su costo mediante una reducción material de incertidumbre o riesgo.

- No hay agentes ni fases obligatorias para todo cambio.
- No se crean planes exhaustivos antes de entender el recorrido real.
- No se usan allowlists cerrados de archivos como sustituto del entendimiento del sistema.
- No se repiten checks cuya evidencia siga vigente.
- La seguridad puede aumentar la profundidad de aseguramiento sin aumentar automáticamente la cantidad de documentación.
- El proceso debe tener mecanismos de stop-loss cuando la coordinación cuesta más que el trabajo.

### P3. Entendimiento bidireccional

Deck debe entender al usuario y ayudar al usuario a entender lo que Deck hará, sin exponerle burocracia interna.

- El Lead resume intención, acción prevista y únicas condiciones que requerirían una nueva decisión.
- Las preguntas se reservan para decisiones materiales, no para mecánica del workflow.
- Los resultados se comunican en términos del producto: qué funciona, qué cambió, cómo se comprobó y qué riesgo queda.
- Los artifacts internos conservan detalle; la conversación permanece clara y breve.

### P4. Resultado vertical verificable

Solo cuenta como progreso un comportamiento observable que funcione a través del recorrido real relevante.

- Artifacts, tareas, agentes y unit tests son evidencia; no sustituyen el resultado.
- Antes de congelar una arquitectura o lista de paths se identifica el execution trace real cuando el cambio cruza límites.
- Una misma instancia de Apply conserva ownership sobre una vertical completa hasta obtener un candidato funcional.
- La QA independiente se ejecuta sobre un candidato funcional, no sobre capas parciales destinadas a descartarse.

## 3. Arquitectura de agentes acordada

El Developer Team tendrá **siete roles de agente disponibles**, pero solo se activarán los necesarios para el outcome actual.

| Rol funcional | Nombre canónico | Responsabilidad |
|---|---|---|
| Dirección y orquestación | `deck-lead` | Entender, clasificar, dirigir, comunicar, mantener el estado compacto y coordinar OpenSpec. Es el responsable superior del outcome y puede ejecutar cambios instantáneos. |
| Exploración | `deck-investigate` | Encontrar puntos clave, patrones, execution traces, riesgos y desconocidos. Por defecto no modifica. |
| Planeación | `deck-architect` | Producir desde un Working Brief hasta Full SDD, según el valor real de la formalización. |
| Implementación rápida | `deck-apply-fast` | Implementación clara, rutinaria o basada en patrones existentes usando un modelo normalmente más económico. |
| Implementación profunda | `deck-apply-deep` | Algoritmos, debugging difícil, concurrencia, consistencia, protocolos, performance e implementación que requiere razonamiento técnico sustancial. |
| Calidad y seguridad | `deck-quality` | Verificación independiente de comportamiento, arquitectura, regresiones y riesgos protegidos. No modifica código. |
| Inicialización y readiness | `deck-setup` | Bootstrap y mantenimiento proporcional del environment de proyecto, OpenSpec, skill registry, herramientas e índices. |

Los nombres `Scout`, `Planner`, `Steward` y `Assurance` fueron propuestos y rechazados. No deben materializarse como IDs, nombres visibles, aliases ni términos canónicos sin una decisión posterior del usuario.

La palabra `developer` se elimina de todos los nuevos IDs de agentes y skills. El team se identifica mediante metadata/catálogo, no repitiendo el namespace en cada nombre.

### Invariante de nombres y comportamiento

Los nombres identifican los agentes y ayudan a comunicar su lugar en el equipo, pero **no redefinen el comportamiento acordado**. Renombrar un rol no modifica sus triggers, ownership, límites de escritura, autoridad, herramientas, modelo, persistencia, TDD ni relación con los demás agentes. Las descripciones funcionales de este documento son la autoridad del comportamiento.

En particular:

- `Lead` conserva exactamente el rol superior de dirección y orquestación definido en las secciones 3 y 4.1. Su autoridad sobre el outcome y sobre `Architect` no elimina su capacidad de implementar directamente cuando esa sea la ruta proporcional.
- `Investigate` conserva exactamente el rol de exploración definido en las secciones 3 y 4.2.
- `Architect` conserva exactamente el rol de planeación proporcional definido en las secciones 3 y 4.3; el nombre no autoriza sobrearquitectura.
- `Quality` conserva exactamente el rol independiente y proporcional de calidad y seguridad definido en las secciones 3 y 4.6; el nombre no lo vuelve un gate universal.
- `Setup` conserva exactamente el rol de inicialización y readiness definido en las secciones 3 y 4.7; el nombre no lo ejecuta en todas las sesiones ni autoriza mantenimiento innecesario.

## 4. Activación adaptativa de agentes

### 4.1 Lead

Siempre es el interlocutor principal.

- Conserva un contexto compacto: outcome, decisiones, estado, riesgos y referencias a artifacts.
- No debe cargar todos los artifacts ni todo el código.
- Puede realizar directamente modificaciones instantáneas, reversibles, claras y de riesgo bajo.
- No delega por conteo de archivos ni por la mera disponibilidad de otro agente.

### 4.2 Rol de exploración

Se activa cuando existe incertidumbre real sobre dónde o cómo cambiar el sistema:

- subsistema desconocido;
- causa de un bug no localizada;
- factories, adapters, DI u otros límites de composición;
- recorrido de producción desconocido;
- varias implementaciones existentes que deben compararse;
- el Lead necesitaría consumir demasiado contexto para descubrir los puntos clave.

Entrega un handoff compacto: trace, puntos de modificación, archivos o símbolos clave, riesgos, desconocidos y recomendación. No produce por defecto un diseño completo ni un inventario exhaustivo.

### 4.3 Rol de planeación

Se activa cuando la planeación produce valor superior a su costo:

- varias soluciones razonables;
- decisiones de producto o contratos;
- dependencias u orden de implementación material;
- varias verticales;
- riesgo protegido que requiere decisiones duraderas;
- trabajo que continuará en otras sesiones;
- Full SDD solicitado o recomendado/seleccionado por el Lead.

No se activa para un arreglo claro aunque toque varios archivos.

### 4.4 Apply Fast

Se usa cuando la solución, los patrones y los checks están claros.

Ejemplos: CRUD ordinario, cambios visuales no instantáneos, configuración, validaciones conocidas, bugs localizados, refactors mecánicos, extensiones de patrones existentes y tareas con diseño resuelto.

### 4.5 Apply Deep

Se usa cuando la implementación necesita razonamiento técnico sustancial.

Ejemplos: algoritmos no triviales, estructuras de datos, concurrencia, consistencia, sistemas distribuidos, parsers, protocolos, performance crítica, migraciones complejas, debugging con causa desconocida e invariantes cross-boundary.

Apply Fast puede escalar una vez a Apply Deep si descubre que la clasificación era incorrecta. No debe encadenar arreglos locales ni rebotar repetidamente entre agentes.

La selección Fast/Deep depende de complejidad cognitiva, no de riesgo, número de archivos o líneas. Un cambio de seguridad puede ser mecánicamente Fast con QA protegida; un algoritmo offline puede ser Deep sin riesgo protegido.

### 4.6 Rol de calidad y seguridad

Se activa obligatoriamente para:

- seguridad, autorización o privacidad;
- migraciones, persistencia o pérdida de datos;
- APIs y contratos públicos;
- efectos externos;
- cambios cross-boundary materiales;
- refactors arquitectónicos;
- release, merge o readiness;
- cobertura incierta o resultados contradictorios;
- petición explícita del usuario.

No se activa automáticamente por cambio visual, número de archivos, commit, artifact o delta incremental. No modifica código. Tras una reparación revalida solo evidencia invalidada; una instancia fresca se reserva para reparaciones protegidas materiales.

### 4.7 Rol de inicialización y readiness

Se activa cuando el preflight determinista de la sesión detecta estado `missing`, `stale`, `invalid` o `indeterminate` que requiere reparación.

- El preflight ocurre una vez por sesión y se cachea.
- Un proyecto listo no lanza el agente completo ni ejecuta escrituras.
- Se repara solamente el componente necesario.
- Una herramienta opcional degradada no bloquea trabajo no dependiente.
- Una primera inicialización puede preparar OpenSpec, `.atl/skill-registry.md`, Codebase Memory, Serena, Context Mode, RTK, memoria y capacidades del runner.

## 5. Rutas de ejecución de referencia

### Cambio instantáneo

```text
Lead → modificación directa → comprobación mínima → persistencia OpenSpec
```

No activa exploración, planeación, Apply ni QA independiente.

### Implementación sencilla

```text
Lead → Apply Fast → ejercicio funcional → persistencia OpenSpec
```

QA se añade únicamente por señales materiales.

### Bug con causa desconocida

```text
Lead → Exploración → Apply Fast o Apply Deep → QA si corresponde
```

### Feature con decisiones importantes

```text
Lead → Exploración opcional → Planeación proporcional
     → Apply Fast o Apply Deep → QA condicional
```

### Cambio protegido

```text
Lead → Exploración cuando aporte valor → Planeación proporcional
     → Apply Fast o Apply Deep según complejidad
     → Calidad y seguridad obligatoria
```

Riesgo protegido no implica automáticamente Apply Deep ni Full SDD.

### Delta conversacional

```text
Lead → misma instancia Apply → delta → checks invalidados
```

No relanza exploración, planeación o QA por cada ajuste.

## 6. TDD y validación

TDD pertenece a Apply.

- Bug o comportamiento nuevo: reproducción RED → implementación GREEN → refactor.
- Contrato o efecto externo: contract test con efectos falsos → implementación → prueba de composición por defecto cuando aplique.
- Refactor sin cambio de comportamiento: characterization/baseline antes de modificar; no se fabrica un RED artificial.
- Cambio visual trivial: comprobación visual/interfaz; no requiere un test artificial.
- Configuración o documentación: validación apropiada, no ceremonia TDD.

Planeación define comportamiento, aceptación y riesgos. Apply decide la prueba concreta. Calidad comprueba que la evidencia sea suficiente y corresponda al candidato real.

La QA debe ser proporcional:

- instantáneo: comprobación relevante mínima;
- normal: focused y affected una vez cuando correspondan;
- protegido: lo anterior más revisión independiente;
- broad: una vez al final cuando impacto, política o release lo justifiquen;
- factories, DI y adapters: prueba de composición por defecto, no solo tests con inyección manual.

## 7. OpenSpec como persistencia transversal

OpenSpec se conserva como memoria oficial de la sesión y del cambio. **OpenSpec y Full SDD no son sinónimos.**

### Nivel delta

Para cambios de segundos: registro mínimo posterior al cambio con outcome, targets, evidencia y estado. No bloquea la modificación.

### Nivel Working Brief

Para trabajo normal o protegido: un artifact compacto con intención, aceptación, decisiones, trace cuando aplique, riesgos, no-goals, progreso y resultado.

### Nivel Full SDD

Proposal, Spec, Design, Tasks y artifacts completos cuando el usuario lo solicita o el Lead determina que la formalización aporta un beneficio superior a su costo.

El Lead/runtime es el writer centralizado. Los agentes devuelven intents/resultados compactos y no compiten escribiendo `state.yaml` o `events.yaml`.

Los artifacts completos se referencian por path. El Lead no debe releerlos todos en cada handoff.

## 8. Selección y recomendación de SDD

El Lead puede:

1. No recomendar SDD cuando una ruta menor es suficiente.
2. Recomendar SDD sin bloquear cuando sería útil pero existe una ruta igualmente segura más pequeña.
3. Seleccionar Run SDD cuando ambigüedad, contratos, coordinación, duración o riesgo hacen que la formalización justifique claramente su costo.

SDD puede ser solicitado por el usuario o recomendado/seleccionado por el Lead. El Lead comunica una razón y el beneficio esperado. No puede imponer Full SDD cuando existe una ruta menor igualmente segura.

## 9. Capacidades y paquetes que deben preservarse

El rediseño de agentes no elimina ni debilita:

- Serena;
- Codebase Memory;
- Context Mode;
- RTK;
- Supermemory y otros providers de memoria adaptativa;
- skill registry en `.atl/skill-registry.md`;
- OpenSpec;
- TDD;
- Git safety;
- skills de seguridad, frontend, backend, APIs, base de datos, accesibilidad, performance, debugging y demás paquetes instalados.

Todos los agentes conservan acceso a las capacidades instaladas y respetan su routing. No están obligados a invocar todas las herramientas en cada tarea: seleccionan el conjunto mínimo relevante.

Uso dominante:

- Lead: registry, OpenSpec, memoria relevante y síntesis.
- Exploración: Codebase Memory, Serena y Context Mode.
- Planeación: OpenSpec, memoria de decisiones y skills de arquitectura/dominio.
- Apply Fast/Deep: navegación semántica, skills de dominio, TDD y herramientas de implementación.
- Calidad: impacto, revisión, tests y skills de seguridad.
- Inicialización/readiness: instalación, registro, activación, indexación y health.

La memoria externa es asesora y nunca sustituye OpenSpec, código, tests ni decisiones vigentes. No debe recibir secretos o contenido sensible indiscriminadamente.

## 10. Instalación, actualización y depuración en runners

El cambio debe funcionar en instalaciones nuevas y en usuarios que ya tienen Deck instalado, comenzando por OpenCode y conservando paridad con todos los runners soportados.

El catálogo canónico es el estado deseado. El instalador debe reconciliar, no solo agregar:

```text
catálogo canónico
→ proyección del runner
→ comparación con instalación existente
→ crear/actualizar/retirar contenido Deck obsoleto
→ verificar inventario exacto
```

Requisitos acordados:

- instalación limpia y actualización deben producir el mismo inventario;
- los nuevos IDs no contienen `developer`;
- se retiran agentes y agent-skills obsoletos administrados por Deck;
- se preservan skills compartidas y paquetes aprobados;
- un archivo obsoleto modificado por el usuario se conserva o mueve a backup/quarantine;
- no se elimina contenido de ownership incierto;
- la promoción del nuevo inventario ocurre antes de retirar el anterior;
- un fallo intermedio no deja una instalación parcial;
- la reinstalación es idempotente;
- adapters y verificadores comprueban el conjunto exacto, no solo presencia parcial;
- se prueban fresh install, legacy upgrade, rollback, model migration y ausencia de referencias obsoletas en cada runner.

Los artifacts OpenSpec históricos conservan IDs anteriores. Un mapa de compatibilidad permite interpretarlos sin instalar aliases físicos ni agentes duplicados.

Archive y Onboard están propuestos como skills invocables por el Lead, no como agentes. Esta decisión debe confirmarse antes de implementación.

## 11. Configuración de modelos

El usuario conserva control de modelos desde la TUI.

- Lead: modelo de dirección/razonamiento.
- Exploración: modelo rápido con buen contexto y navegación.
- Planeación: modelo potente en razonamiento.
- Apply Fast: modelo normalmente rápido/económico.
- Apply Deep: modelo potente para implementación difícil.
- Calidad: modelo independiente y fuerte para evaluación.
- Inicialización/readiness: modelo eficiente para operaciones deterministas; escala solo ante diagnóstico real.

Deck respeta las asignaciones configuradas. Puede recomendar una reclasificación o un modelo distinto, pero no cambiar silenciosamente la selección del usuario.

La migración desde modelos antiguos debe ser revisable en la TUI. No se debe inferir cuál provider/modelo es “más potente” sin evidencia explícita.

## 12. Restricciones contra regresión de proceso

El rediseño falla si introduce cualquiera de estos comportamientos:

- lanzar todos los agentes por defecto;
- exigir exploración antes de todo cambio;
- exigir planeación después de toda exploración;
- ejecutar QA independiente para cada delta;
- crear un artifact por agente;
- usar conteos de archivos como trigger decisivo;
- dividir implementación en un agente por tarea;
- congelar allowlists antes del execution trace;
- hacer que el Lead relea todos los artifacts;
- usar paquetes instalados como checklist obligatorio de llamadas;
- conservar agentes antiguos físicamente instalados solo por compatibilidad histórica;
- añadir nuevos gates para corregir latencia sin eliminar los gates anteriores.

## 13. Decisiones de implementación cerradas

1. `deck-apply-fast` y `deck-apply-deep` son los nombres finales.
2. Archive y Onboard permanecen como skills invocables, no como agentes.
3. Delta y Working Brief son artifacts ligeros bajo `openspec/changes/<change-id>/`; solo Full SDD exige Proposal, Spec, Design y Tasks.
4. `Lead` selecciona Full SDD sin una aprobación mecánica adicional cuando la política del proyecto lo exige o no existe una ruta menor igualmente segura. En los demás casos lo recomienda y reserva preguntas para decisiones materiales.
5. Las asignaciones legacy se migran solo cuando no son ambiguas: Orchestrator→Lead, Explorer→Investigate, General Apply→Apply Fast e Init→Setup; grupos fusionados se migran únicamente si sus asignaciones coinciden, y de lo contrario quedan visibles como no configurados para revisión en la TUI.
6. Los adapters promueven y verifican el inventario nuevo antes de retirar el anterior. Los archivos legacy administrados por Deck se preservan en quarantine/backup; el rollback incluye targets nuevos y legacy, y OpenCode conserva su backup atómico de configuración.

## 14. Estado de implementación

Implementación iniciada el 2026-08-04. Los artifacts oficiales de este cambio son `proposal.md`, `spec.md`, `design.md`, `tasks.md`, `state.yaml`, `events.yaml` y `apply-progress.md`; este documento conserva el razonamiento colaborativo original.
