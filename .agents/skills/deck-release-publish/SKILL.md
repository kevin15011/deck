# Skill: deck-release-publish

> Publicar nueva versión/release de Deck. Incluye bump, build-info, tag, push, release, y smoke tests.

## Trigger

Invocar cuando el usuario diga:
- "publicar release"
- "deploy release"
- "nueva versión"
- "bump version"
- "tag and release"
- "publicar nueva versión"

## Precondiciones

- Working tree limpio (sin cambios sin commitear)
- Branch en `main` o branch de release designada
- Permisos de push a remoto configurados
- Tests pasando en baseline

---

## Checklist Paso a Paso

### 1. Inspección Inicial

```bash
git status
git log --oneline -10
git diff --stat HEAD~1
```

**Verificar:**
- No hay cambios sin commitear
- No hay cambios no relacionados con el release
- Commit base es estable

### 2. Revisar Cambios Pendientes

- Identificar cambios no relacionados que deben excluirse
- Si hay cambios no relacionados: reportar y pedir instrucciones
- Si hay cambios OpenSpec no finalizados: no proceder

### 3. Tests y Verificación Pre-Release

```bash
bun run test          # o test:unit si existe
bun run build        # verificar build completa
bun run typecheck   # o tsc --noEmit
```

**Gates:**
- ❌ Tests fallan → **BLOQUEAR**
- ❌ Build falla → **BLOQUEAR**
- ❌ Typecheck falla → **BLOQUEAR**

### 4. Bump de Versión

Determinar tipo de bump según cambios:
- **patch**: fix, refactor interno, docs
- **minor**: nueva feature backwards-compatible
- **major**: breaking change

```bash
# Usar bun-version-bump o manual
bun run bump --<patch|minor|major>
```

**O manual:**
```bash
# Editar package.json version
# Editar packages/*/package.json según monorepo
```

### 5. Regenerar build-info

```bash
# Regenerar apps/cli/src/runtime/build-info.generated.ts
bun run generate:build-info
# o según script del proyecto
```

**Verificar que se genere correctamente.**

### 6. Commit Release

```bash
git add -A
git commit -m "chore(release): prepare v<X.Y.Z>"
```

**Mensaje exacto:** `chore(release): prepare vX.Y.Z`

### 7. Tag Release

```bash
git tag -a v<X.Y.Z> -m "Release v<X.Y.Z>"
```

### 8. Push y Tag — CONFIRMACIÓN EXPLÍCITA REQUERIDA

⚠️ **BLOQUEAR hasta confirmación explícita del usuario**

```bash
git push origin main
git push origin v<X.Y.Z>
```

**Esperar y verificar:**
- GitHub workflow corre
- Release artifacts se generan
- Release page se crea

### 9. Smoke Tests Post-Release

```bash
# Test de instalación fresca
npm install -g deck
deck --version

# Test de update (si aplica)
deck update check

# Test de TUI (si aplica)
echo '{"DECK_RELEASE_CHECK_FIXTURE":"/path/release.json"}' | bun run deck:run
```

**Verificar:**
- ✅ Instalación funciona
- ✅ Version correcta
- ✅ TUI renderiza sin errores

---

## Safety Gates

### 🚫 NUNCA hacer sin confirmación

- Push a remoto
- Crear tag
- Operaciones destructivas

### 🚫 NO incluir

- `.codebase-memory/*` — directorio del knowledge graph
- Cambios OpenSpec no finalizados
- Build artifacts accidentales (`.output/`, `dist/`, `node_modules/`)
- Archivos con secrets/secrets.env

### 🚫 Verificar antes de commit

```bash
git diff --cached --name-only | grep -E "(secret|env|key)" && echo "CONTAMINADO"
```

Si hay archivos contaminados: limpiar staging y reportar.

### 🚫 Git Safety

- **`git reset --hard`** — ❌ BLOQUEADO sin confirmación explícita
- **`git clean -fd`** — ❌ BLOQUEADO sin confirmación explícita
- **`git rebase`** — ❌ BLOQUEADO sin confirmación explícita

---

## Comandos de Referencia (ajustar al repo)

| Comando | Propósito |
|--------|-----------|
| `bun run test` | Tests unitarios |
| `bun run build` | Build completa |
| `bun run typecheck` | TypeScript check |
| `bun run generate:build-info` | Regenerar build-info |
| `bun run bump:patch` | Bump patch version |
| `bun run bump:minor` | Bump minor version |
| `bun run bump:major` | Bump major version |

### Estructura de Versionado

Deck usa:
- Root `package.json` version
- `apps/cli/package.json` — CLI entry
- `packages/*/package.json` — packages internos

**Verificar que todos los package.json tengan la misma versión.**

---

## Release Fixture (TUI Test)

Para probar la señal visual de release sin publicar:

```bash
DECK_RELEASE_CHECK_FIXTURE=/path/to/release.json bun run deck:run
```

**Donde `/path/to/release.json` contiene:**
```json
{
  "version": "x.y.z",
  "date": "2026-01-01",
  "notes": "Release notes",
  "checksum": "sha256:..."
}
```

---

## Return Format

Al completar, reportar:

```markdown
## Release Publish: Resultado

**Outcome**: success | blocked | failed

### Completed Steps
- [x] Inspección git status/diff/log
- [x] Tests pre-release: {pass/fail}
- [x] Bump version: {patch|minor|major} → vX.Y.Z
- [x] build-info regenerado
- [x] Commit: {commit hash}
- [x] Tag: vX.Y.Z

### Pending (esperando confirmación)
- [ ] Push commit
- [ ] Push tag
- [ ] GitHub workflow / release artifacts
- [ ] Smoke tests post-release

### Blockers
- {ninguno, o descripción}

### Next Step
{Listo para confirmación de push, o listo para Review si todo completo}
```

---

## Notas

- Esta skill es **local al proyecto** — no es global en `~/.config/opencode`
- Invocar solo cuando el usuario solicite explícitamente publicar release
- No ejecutar operaciones destructivas sin confirmación explícita
- Mantener comunicación clara sobre estado y bloqueos