# Deck — AI Environment Harness

Tu entorno de IA, listo para trabajar.

Deck es una herramienta CLI para instalar, configurar y mantener entornos de trabajo con IA. Prepara el terreno para que trabajes con agentes, memoria, workflows y configuraciones reproducibles sin fricción.

**Versión actual**: v0.0.3

---

## Instalación

### Instalación automática (recomendada cuando hay releases)

```bash
curl -fsSL https://raw.githubusercontent.com/kevin15011/deck/main/scripts/install.sh | bash
```

El instalador automático descarga binarios precompilados desde GitHub Releases. Requiere que existan releases con:

- `deck_v{VERSION}_{OS}-{ARCH}.tar.gz` (ej: `deck_v0.0.3_linux-x64.tar.gz`)
- `checksums.txt` para verificación de integridad

⚠️ **Nota importante**: Si no hay releases publicados aún, la instalación desde fuente es el método confiable disponible actualmente.

### Instalación desde fuente

```bash
# Clonar el repositorio
git clone https://github.com/kevin15011/deck.git
cd deck

# Instalar dependencias
bun install

# Compilar CLI
bun run build

# Instalar globalmente (opcional)
ln -s "$(pwd)/dist/cli/deck" ~/.local/bin/deck
```

### Verificar instalación

```bash
deck --version
deck doctor
```

---

## Uso rápido

### Pi — Iniciar sesión Developer Team

```bash
deck pi developer
```

Esto instala/monta el perfil del Developer Team en Pi y lanza una sesión con el orquestador como system prompt. Pi gestiona todos los agentes dentro de una misma sesión.

### OpenCode — Instalar y usar el orquestador

```bash
# 1. Instalar y configurar el entorno Deck (normalmente vía `deck` TUI)
# 2. Iniciar OpenCode y seleccionar 'deck-developer-orchestrator'
#    junto a los agentes Plan/Build
```

El adapter OpenCode instala skills, prompts y configuración en `~/.config/opencode/` y materializa entradas de agentes en `opencode.json`.

### Comandos disponibles

| Comando | Descripción | Runner |
|---------|-------------|--------|
| `deck` | Menú interactivo principal | — |
| `deck --version` | Mostrar versión | — |
| `deck doctor` | Diagnóstico del entorno | — |
| `deck upgrade` | Actualizar Deck | — |
| `deck pi developer` | Lanzar Developer Team en Pi | Pi |

---

## Características

### ✅ Implementado en v0.0.3

- **Developer Team completo** — 12 agentes del Developer Team: orchestrator, explorer, proposal, spec, design, task, apply_general, apply_backend, apply_frontend, verify, review, archive
- **Soporte para Pi** — Adapter que instala/monta el perfil y lanza sesiones con el orquestador
- **Soporte para OpenCode** — Adapter funcional que instala skills/prompts/config en `~/.config/opencode/` y materializa agentes en `opencode.json`
- **Modelo de configuración declarativa** — Environments definidos en YAML, versionables y reproducibles
- **CLI funcional** — Comandos para diagnóstico, versión y actualización
- **Spec Registry** — Seguimiento de estado y eventos para cambios (OpenSpec)
- **Gestión de modelos** — Selección de provider/model/thinking por agente durante setup

---

## Arquitectura

Deck usa una arquitectura basada en adapters para soportar múltiples runtimes:

```
packages/core/            # Definiciones canónicas (equipos, agentes, skills)
packages/adapter-pi/      # Traductor → sesiones Pi
packages/adapter-opencode/ # Traductor → OpenCode
apps/cli/               # Interfaz CLI
```

### Flujo de materialización

1. `packages/core` define el equipo de forma runner-agnóstica
2. Cada adapter traduce estas definiciones al formato del runtime
3. La CLI invoca el adapter correspondiente para lanzar sesiones

---

## Desarrollo local

### Requisitos

- Bun (runtime)
- Git

### Comandos útiles

```bash
# Instalar dependencias
bun install

# Ejecutar CLI directamente
bun run deck --version
bun run deck doctor

# Compilar binario
bun run build

# Tests
bun test

# TypeScript check
bunx tsc --noEmit
```

### Estructura del monorepo

```
deck/
├── apps/
│   └── cli/           # CLI principal
├── packages/
│   ├── core/          # Modelo canónico y equipos
│   ├── adapter-pi/   # Adapter para Pi
│   ├── adapter-opencode/ # Adapter para OpenCode
│   └── (más adapters en progreso)
├── scripts/
│   └── install.sh     # Script de instalación
├── docs/              # Documentación del proyecto
└── openspec/          # Artefactos de cambios (SDD)
```

---

## Documentación

| Archivo | Propósito |
|---------|----------|
| `README.md` | Este archivo |
| `docs/tool-references.md` | Herramientas oficiales y referencias |
| `docs/prompt-methodology-modules.md` | Metodología de prompts y módulos |

---

## Licencia y contacto

- **Repositorio**: https://github.com/kevin15011/deck
- **Licencia**: Pendiente de definir

---

*¿Necesitas ayuda? Ejecuta `deck doctor` o revisa la documentación en `docs/`.*