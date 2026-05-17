# Deck — Concepto inicial y definición del MVP

Fecha base: 15 de mayo de 2026

## 1. Identidad del producto

**Nombre:** Deck

**Categoría:** AI Environment Harness

**Tagline inicial:** Your AI environment, configured.

**Versión en español:** Tu entorno de IA, listo para trabajar.

Deck es la capa que prepara, organiza y mantiene entornos de trabajo con IA. Su identidad gira alrededor de la idea de un “deck”: un tablero de control desde donde el usuario configura sus herramientas, memoria, agentes, prompts y flujos para trabajar con mayor estructura.



## 2. Qué es Deck

Deck es un **AI Environment Harness**: una herramienta para crear, instalar, configurar y mantener entornos de trabajo con IA.

Su propósito es que un usuario pueda dejar listo su entorno de IA sin tener que configurar manualmente agentes, subagentes, prompts, memoria, MCPs, paquetes, permisos, workflows, perfiles de modelos y adaptadores por runtime.

Deck funciona como una capa de configuración y operación encima de herramientas como Pi, OpenCode, Codex o Claude Code. El primer soporte real será para **Pi**, porque ofrece flexibilidad para trabajar con paquetes, subagentes, MCPs y extensiones.

La idea central:

**Deck prepara un entorno de IA completo para que el usuario pueda trabajar con menos fricción y más estructura.**

## 3. Inspiración principal

Deck nace inspirado en la experiencia de usar entornos de IA completos ya configurados. El valor no está solo en tener un agente, sino en tener un entorno listo que combine instalación, agentes, workflows, memoria, skills, MCPs, perfiles de modelos, permisos, backups, presets y compatibilidad con varias herramientas.

Deck toma esa inspiración y la convierte en un concepto más general: environments configurables para distintos tipos de trabajo.

Lo que Deck quiere conservar de esa inspiración:

- instalación guiada;
- configuración reproducible;
- soporte para agentes y subagentes;
- memoria persistente;
- workflows estructurados;
- perfiles de modelos por rol o fase;
- paquetes necesarios por runtime;
- respaldo y sincronización de configuración;
- capacidad de crecer hacia múltiples herramientas.

Lo que Deck quiere aportar como dirección propia:

- environments como unidad principal;
- UI/Console para gestionar configuración visualmente;
- soporte inicial fuerte para Pi;
- arquitectura extensible por adapters;
- prompt framework para entender intención y recomendar workflows;
- configuración de dependencias necesarias por environment;
- separación más clara entre producto, runtime, memoria, agentes y workflows.

## 4. Qué tendrá Deck

Deck estará compuesto por varios módulos que trabajan juntos:

### 4.1 Deck Core

El núcleo conceptual del sistema. Define environments, workflows, agentes, subagentes, memoria, prompts, paquetes, adapters y configuración.

### 4.2 Deck CLI

La primera interfaz funcional. Permitirá instalar, inicializar, diagnosticar, sincronizar y actualizar environments.

Comandos esperados a futuro:

- `deck init`
- `deck doctor`
- `deck install`
- `deck sync`
- `deck environment add`
- `deck environment update`
- `deck runtime detect`

### 4.3 Deck Console

La interfaz visual para gestionar Deck con más comodidad. No debe bloquear el MVP, pero sí forma parte importante de la visión del producto.

La Console debería permitir:

- ver environments instalados;
- instalar paquetes faltantes;
- editar prompts;
- configurar modelos por rol;
- revisar memoria;
- activar workflows;
- diagnosticar problemas;
- gestionar adapters y runtimes.

### 4.4 Deck Adapters

Adaptadores que traducen la configuración de Deck al formato de cada herramienta soportada.

Primer adapter:

- Pi Adapter

Adapters futuros:

- OpenCode Adapter
- Codex Adapter
- Claude Code Adapter

### 4.5 Deck Environments

Presets completos para un tipo de trabajo.

Primer environment:

- Development Environment

Environments futuros:

- Office Environment
- Media Environment
- Research Environment
- Automation Environment

### 4.6 Deck Memory

Capa de memoria persistente. Engram puede ser el primer proveedor, pero Deck debe manejar la memoria mediante una interfaz propia para permitir otros providers en el futuro.

### 4.7 Deck Prompt Framework

Sistema para interpretar la intención del usuario y recomendar el mejor workflow, template, nivel de ceremonia, agentes necesarios y dependencias requeridas.

## 5. Primer soporte: Pi

El primer runtime soportado será **Pi**.

La razón es práctica: Pi permite trabajar con paquetes, subagentes, MCPs y configuraciones flexibles. Además, el flujo actual del usuario ya identifica necesidades concretas en ese entorno.

Deck para Pi debería encargarse de:

- detectar si Pi está instalado;
- detectar paquetes requeridos;
- instalar o guiar instalación de paquetes faltantes;
- configurar agentes y subagentes;
- configurar memoria;
- instalar MCPs necesarios;
- preparar workflows iniciales;
- generar o actualizar archivos de configuración;
- validar que el entorno quedó listo.

Paquetes o capacidades a evaluar para el primer soporte:

- sub-agents;
- MCP packages;
- context-mode;
- codebase-memory;
- RTK cuando aplique;
- memoria persistente tipo Engram;
- herramientas de documentación/contexto;
- paquetes necesarios para workflows de desarrollo.

## 6. Principios de diseño del producto

### 6.1 Environment-first

Deck organiza el trabajo alrededor de environments. Un environment reúne la configuración necesaria para un tipo de trabajo: runtime, agentes, subagentes, workflows, prompts, memoria, paquetes, perfiles de modelos y herramientas.

Ejemplo de uso:

**“Quiero preparar mi entorno de desarrollo con IA.”**

Deck responde con un flujo de setup que detecta runtime, revisa dependencias, instala paquetes, configura memoria, prepara prompts y deja el entorno listo para trabajar.

### 6.2 Local-first

Deck inicia como herramienta local-first. La configuración, los environments, los prompts y la memoria deben poder vivir en el entorno del usuario o del proyecto.

Esto permite trabajar sin depender de un backend central desde el primer día y facilita la integración con herramientas como Pi, OpenCode, Codex o Claude Code.

### 6.3 Configuración declarativa

Los environments se definen mediante configuración declarativa. Esto permite versionar, revisar, compartir y reinstalar un entorno de forma reproducible.

Ejemplo conceptual:

```yaml
name: development
type: environment
runtime: pi
memory: engram
workflows:
  - quick-fix
  - feature-sdd
  - refactor
packages:
  - pi-subagents
  - pi-mcp-adapter
  - codebase-memory
  - context-mode
```

### 6.4 Adapter-based architecture

Deck soporta diferentes runtimes mediante adapters. El core define el modelo común y cada adapter traduce ese modelo al formato de la herramienta correspondiente.

Primer adapter:

- Pi Adapter

Adapters futuros:

- OpenCode Adapter
- Codex Adapter
- Claude Code Adapter

### 6.5 Provider-based memory

Deck maneja la memoria a través de una interfaz `MemoryProvider`.

Primer provider a evaluar:

- EngramProvider

Providers futuros posibles:

- LocalFileProvider
- SQLiteProvider
- RemoteMemoryProvider

### 6.6 Product language

El lenguaje principal de Deck se centra en conceptos entendibles para el usuario:

- environments;
- workspace;
- setup;
- tools;
- memory;
- workflows;
- presets;
- packages;
- profiles.

Los conceptos internos como orchestrators, sub-agents, adapters, providers y manifests existen como parte de la arquitectura, pero la experiencia principal se organiza alrededor de environments y setup.

## 7. Identity packs y naming packs

Deck tendrá capacidad de adaptar la identidad visible de agents, workflows y roles mediante packs.

Un pack puede cambiar nombres, estilo de instrucciones, tono visual y convenciones de presentación sin alterar la arquitectura interna.

Primer pack conceptual:

**Cyberdeck Pack**

Ejemplos de nombres con Cyberdeck Pack:

- Verify Agent → Netrunner Verify
- Memory Agent → Memory Ghost
- Design Agent → Protocol Architect
- Frontend Apply → Interface Runner
- Backend Apply → Systems Runner
- Review Agent → Judgment Daemon

Esta capacidad permite que Deck sea flexible: un mismo environment puede presentarse con lenguaje técnico, corporativo, minimalista o cyberpunk según el perfil del usuario.



## 9. Primer environment: Development

El primer environment debe ser Development porque es donde ya existe experiencia real, necesidad clara y validación directa con el primer runtime soportado.

### Objetivo del Development Environment

Preparar un entorno de desarrollo con IA capaz de asistir en features, fixes, refactors, revisión, documentación y flujos SDD/TDD sin que el usuario configure manualmente cada agente, prompt, paquete o memoria.

### Workflows iniciales

- Quick Fix
- Feature SDD
- Refactor
- Code Review
- Architecture Discovery
- Documentation Update
- Test Generation

### Roles internos posibles

Aunque el usuario vea “Development Environment”, internamente pueden existir agentes especializados:

- development-orchestrator
- discovery
- proposal
- spec
- design
- tasker
- apply-general
- apply-backend
- apply-frontend
- verify
- review
- archive

## 10. Apply backend y apply frontend

Deck incluirá una estrategia de implementación especializada para backend y frontend dentro del Development Environment.

Modos de implementación:

- `apply-general`: tareas pequeñas o cambios acotados.
- `apply-backend`: APIs, servicios, base de datos, contratos, seguridad, validaciones y tests backend.
- `apply-frontend`: UI, estado, componentes, formularios, accesibilidad, performance y pruebas visuales.
- `apply-fullstack`: coordinación de `apply-backend` y `apply-frontend` a partir de un contrato definido en design.

Esta separación permite asignar modelos, prompts e instrucciones específicas por área técnica. También reduce la mezcla de responsabilidades y mejora la calidad de revisión cuando una tarea afecta varias capas del sistema.



## 11. Spec y design

Deck mantendrá spec y design como fases separadas dentro del Development Environment.

Spec define:

**Qué debe pasar y cómo se valida.**

Design define:

**Cómo se va a construir técnicamente.**

Deck también soportará un modo compacto para tareas pequeñas:

**compact-spec-design**

Y un modo completo para tareas medianas o grandes:

**full-sdd**

El environment orchestrator seleccionará el modo adecuado según intención, complejidad, riesgo y alcance del cambio.



## 12. Prompt Framework / Intention Router

Deck debe tener una capa capaz de entender la intención del usuario y sugerir el environment, workflow y template más apropiado.

Ejemplos de intención:

- Bugfix rápido
- Feature nueva
- Refactor
- Investigación técnica
- Crear documento
- Analizar spreadsheet
- Crear asset multimedia
- Preparar presentación
- Automatizar tarea repetitiva

El router debe sugerir:

- environment recomendado;
- workflow recomendado;
- prompt template recomendado;
- nivel de ceremonia;
- herramientas necesarias;
- memoria/contexto a consultar;
- dependencias requeridas.

## 13. CLI y Console

Deck tendrá dos superficies principales: una CLI para instalación, diagnóstico y automatización, y una Console para gestión visual del entorno.

### CLI

La CLI será la primera superficie funcional del producto. Permitirá:

- inicializar Deck en un proyecto;
- detectar runtimes disponibles;
- instalar environments;
- verificar dependencias;
- diagnosticar problemas;
- sincronizar configuración;
- actualizar paquetes y presets;
- ejecutar comandos repetibles desde scripts.

### Console

Deck Console será la interfaz visual para operar Deck con más comodidad. Permitirá:

- ver environments instalados;
- instalar paquetes faltantes;
- editar prompts;
- configurar modelos por rol;
- revisar memoria;
- activar workflows;
- diagnosticar problemas;
- gestionar adapters y runtimes;
- consultar historial de cambios y configuración.

El MVP inicia con CLI y configuración declarativa. La Console forma parte de la visión del producto y se integrará como capa visual sobre el mismo core.



## 14. Arquitectura sugerida

Estructura monorepo con pnpm:

```txt
apps/
  cli
  console

packages/
  core
  adapter-pi
  adapter-opencode
  adapter-codex
  adapter-claude
  memory
  environment-development
  environment-office
  environment-media
  prompt-framework
  installer
  shared
```

### Componentes principales

- Deck Core: modelo conceptual común.
- Deck CLI: comandos de instalación y gestión.
- Deck Console: UI de administración.
- Deck Environments: presets laborales configurables.
- Deck Adapters: traducción hacia runtimes específicos.
- Deck Memory: abstracción de memoria.
- Deck Installer: detección e instalación de dependencias.
- Deck Prompt Framework: intención, templates y sugerencias.

## 15. MVP recomendado

El MVP debe validar una sola cosa:

**Deck puede preparar y mantener un Development Environment funcional sobre Pi mejor que configurar todo manualmente.**

### Incluye

1. Deck Core mínimo.
2. Deck CLI mínima.
3. Adapter Pi.
4. Development Environment.
5. Manifiesto declarativo del environment.
6. Detección de paquetes requeridos.
7. Instalación o guía de instalación de paquetes faltantes.
8. MemoryProvider abstracto.
9. EngramProvider opcional como primera implementación.
10. Prompt Framework básico para clasificar intención y sugerir workflow.
11. Workflows: Quick Fix, Feature SDD, Refactor, Review.
12. apply-general, apply-backend y apply-frontend como agentes internos.
13. Modo compact-spec-design y full-sdd.
14. Documentación mínima de instalación y uso.

### No incluye inicialmente

- Marketplace.
- Cloud sync propio.
- Soporte real para múltiples runtimes.
- Office Environment.
- Media Environment.
- Console completa.
- Sistema avanzado de permisos.
- Registry público.
- Múltiples MemoryProviders reales.

## 16. Preguntas abiertas

- ¿Deck será open source desde el inicio?
- ¿Deck será local-first únicamente o tendrá una versión cloud después?
- ¿Los environments serán paquetes npm?
- ¿Los prompts serán versionados como código?
- ¿Cómo se versiona un environment?
- ¿Cómo se actualizan environments sin romper configuraciones locales?
- ¿Qué tan automática debe ser la instalación de dependencias?
- ¿Deck debe ejecutar acciones o solo configurar el runtime donde se ejecutan?
- ¿Qué hace Deck si el runtime no soporta una capacidad requerida?
- ¿Cómo se audita lo que Deck cambió en el entorno del usuario?

## 17. Decisiones base

- Nombre del producto: Deck.
- Categoría: AI Environment Harness.
- Unidad principal del producto: Environment.
- Primer environment: Development Environment.
- Primer runtime soportado: Pi.
- Gestor del monorepo: pnpm.
- Primer proveedor de memoria a evaluar: EngramProvider.
- Interfaz base del MVP: CLI.
- Interfaz visual de producto: Deck Console.
- Arquitectura de expansión: adapters, environments, memory providers, prompt templates y packs.
- Identidad adaptable: packs de identidad y naming packs, incluyendo Cyberdeck Pack.



## 18. Próximo paso sugerido

Antes de escribir un PRD, definir con precisión el MVP del Development Environment:

- alcance exacto;
- comandos CLI;
- manifest schema v0;
- paquetes Pi requeridos;
- workflows iniciales;
- roles internos;
- comportamiento del installer;
- comportamiento del prompt router;
- qué significa “environment listo”.

