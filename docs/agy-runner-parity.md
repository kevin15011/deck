# Diseño y paridad del runner `agy` (`agy acp`) en Deck

> **Decisión arquitectónica:** Integrar `agy` (Antigravity CLI) en `deck-next` (`deck2`) usando **`agy acp --stdio`** (Agent Client Protocol, JSON-RPC 2.0 sobre `stdin`/`stdout`) directamente desde Rust, sin bridge de Node.js.
>
> **Versión base verificada:** `agy 1.5.16` (`/home/kevin15011/.local/bin/agy`).

---

## 1. Decisión de arquitectura: `agy acp`

Se descarta `agy -p --input-format stream-json` (orientado a ejecución headless/CI sin permisos interactivos ni inyección limpia de MCP/system prompt por intento) y se adopta **`agy acp --stdio`** porque encaja directamente con el modelo JSON-RPC sobre `stdio` que Deck ya usa para `codex app-server`:

- **100% Rust**, sin runtime externo de Node.js.
- **Permisos interactivos (`Ask first`)** nativos mediante `session/request_permission`.
- **Inyección de MCP por intento** (`session_mcp::Bridge`, `deck-codebase-memory`, `deck-context7`) mediante `mcpServers` en `session/new` y `session/load`, sin mutar la configuración global del usuario.
- **Instrucciones por rol (Lead / Member)** mediante `_meta.antigravity.systemPrompt.append`.
- **Adjuntos de imagen** nativos (`promptCapabilities.image: true`).
- **Continuidad y control explícito** (`session/new`, `session/resume`, `session/load`, `session/close`, `session/cancel`, `session/set_mode`, `session/set_config_option`) con aislamiento vía `--process-per-session` y `--sandbox`.

### Capacidades confirmadas en `initialize` (`agy 1.5.16`)

```json
{
  "protocolVersion": 1,
  "agentCapabilities": {
    "loadSession": true,
    "promptCapabilities": {
      "image": true,
      "audio": false,
      "embeddedContext": true
    },
    "sessionCapabilities": {
      "resume": {},
      "close": {},
      "load": {},
      "list": {},
      "additionalDirectories": {}
    },
    "auth": {
      "logout": {}
    },
    "_meta": {
      "antigravity": {
        "tier": true,
        "systemPrompt": {
          "append": true
        }
      }
    }
  },
  "agentInfo": {
    "name": "Antigravity ACP Server",
    "version": "1.5.16"
  },
  "authMethods": [
    { "id": "oauth-personal", "name": "Log in with Google" },
    { "id": "oauth-business", "name": "Log in with Gemini Enterprise" },
    { "id": "gemini-api-key", "name": "Gemini API key" },
    { "id": "agent-platform", "name": "Gemini Enterprise Agent Platform" }
  ]
}
```

---

## 2. Matriz de paridad: Codex vs Claude vs `agy acp`

| Capacidad en Deck | Codex (`app-server`) | Claude (`claude-sdk.mjs`) | `agy acp` (diseño objetivo) |
|---|---|---|---|
| **Descubrimiento de modelos y effort** | `inspect_native` (`model/list`) | Bridge `catalog` (`supportedModels`) | `configOptions` en `session/new` (modelos + effort `low\|medium\|high\|xhigh\|max`). |
| **Readiness y verificación de auth** | Probe de binario + `app-server` | `claude auth status --json` | Handshake `initialize` + verificación de auth/tier en ACP (`_meta.antigravity.tier` / `authMethods`). |
| **Lead + Streaming de texto / actividad** | JSON-RPC (`item/agentMessage/delta`, `item/reasoning/*`) | Bridge NDJSON (`delta`, `result`) | `session/prompt` → notificaciones `session/update` (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`). |
| **Permisos (`Ask first`, `YOLO`, session grants)** | `CodexJsonRpc` + `DeckMcp` | `ClaudeSdk` (`canUseTool`) + `DeckMcp` | En `relay`: `session/request_permission` → `Decision` con `NativeTransport::AgyAcp` integrado en `permission_policy.rs`. En `yolo`: `--dangerously-skip-permissions` o `session/set_mode` (`yolo`). |
| **Project trust y sandbox** | `read-only` / `workspace-write` / `danger-full-access` | `workspaceTools` acotados + `cwd="/"` si no confiable | `--sandbox`, `cwd` restringido y denegación en `request_permission` para proyectos no confiables y roles read-only (`investigate`, `quality`). |
| **Delegación y Members (`deck_*` MCP)** | `session_mcp::Bridge` HTTP + Bearer | `session_mcp::Bridge` HTTP + Bearer | Pasar `Bridge.config` (`url` + `Authorization: Bearer ...`) en `mcpServers` de `session/new` / `session/load`. Perfil `IndependentDedicated` (proceso y credencial aislados por member). |
| **Continuidad nativa (`resume`)** | `thread/resume` + `NativeProvenance` | `--resume` UUID + chequeo de transcript | `session/resume` / `session/load` con `sessionId` guardado en `NativeContext` + `NativeProvenance` (hash de `~/.gemini/antigravity-cli`, `cwd`, `role`). |
| **Adjuntos de imagen** | Sí (turno inicial) | Sí (turno inicial y live steering) | Bloques de imagen en `session/prompt` (`promptCapabilities.image: true`). |
| **Cancelación y recuperación tras reinicio** | `turn/interrupt` + kill de process group | `stop` + `process_group_stopped` | `session/cancel` + `SIGKILL` al process group + `settle_recovered` sin reenvío automático del turno interrumpido. |
| **Ventana de contexto (`ContextState`)** | `thread/tokenUsage/updated` + compaction | `getContextUsage` | Mapear `usage_update` de ACP si `agy 1.5.16` lo emite con `tokens` y `capacity`; si no, dejar `observation = None` sin estimar. |
| **Live steering mid-turn** | `turn/steer` | `steer` en SDK con echo de UUID | Mantener `can_steer = false` salvo que la Fase 0 confirme soporte real de steering mid-turn en `agy acp`; los mensajes quedan en cola sin bloquear. |
| **Cuota de suscripción (`Usage`)** | `account/rateLimits/updated` | Bridge `quota` | Omitir tarjeta de cuota en v1 salvo que `agy acp` exponga un campo/notificación `_meta` de cuota. |
| **External tools (CBM, Context7, RTK, Context Mode)** | MCP CBM/Context7 + hooks RTK + plugin Context Mode | MCP CBM/Context7 + hooks RTK + plugin Context Mode | Inyectar `deck-codebase-memory` y `deck-context7` vía `mcpServers` en ACP + instrucción explícita de RTK. Hooks de RTK y plugin Context Mode quedan fuera de v1 hasta validar soporte upstream en `agy`. |

---

## 3. Flujo de ciclo de vida en `agy acp`

Antigravity 1.5.16 configures MCP credentials when opening or resuming a session.
ACP offers no in-place credential rotation or turn identifier on session updates.
Deck therefore starts a fresh ACP process and MCP bridge for every Lead turn.
`session/resume` preserves native history, and closing the bridge and transport
at turn end revokes that turn's credential and isolates late updates.

Delegated processes require Linux user and mount namespaces. A trusted project
is mounted read-only for Investigate and Quality in either approval mode.
Untrusted projects are omitted from the native filesystem. Each task keeps its
own profile for native continuation. The host OAuth token is mounted read-only
when present, and the user's profile settings and MCP configuration stay outside
the namespace.

1. **Arranque del proceso:** lanzar `agy acp --stdio` (con `--sandbox` según confianza/rol y `--dangerously-skip-permissions` solo en modo `yolo` sobre proyecto confiable) en su propio process group (`own_child`) y registrar `native_pid`.
2. **Handshake:** enviar `initialize` (`protocolVersion: 1`) y verificar `agentInfo`, `agentCapabilities` y estado de autenticación.
3. **Apertura de sesión:**
   - **Nueva sesión:** `session/new` con `cwd`, `mcpServers` (`session_mcp::Bridge` + `deck-codebase-memory` + `deck-context7` si aplica) y `_meta.antigravity.systemPrompt.append` con las instrucciones del rol (`lead` o member) + política de continuidad.
   - **Continuación:** `session/resume` (o `session/load`) con el `sessionId` guardado en `NativeContext`, validando antes `NativeProvenance` (binario, storage, `cwd`, rol).
   - Aplicar modelo, effort y modo vía `session/set_config_option` / `session/set_mode`.
4. **Ejecución de turno:** enviar `session/prompt` con el prompt del usuario (o `handoff` de member) y bloques de imagen si existen.
5. **Bucle de eventos:**
   - `session/update`: acumular `agent_message_chunk` en `receipt.text` (con límite `MAX_TEXT`), registrar actividad/tool calls y, si llega, `usage_update`.
   - `session/request_permission`: validar bounds/trust, consultar grants de sesión (`permission_policy.rs`), o registrar `Decision` en SQLite y esperar respuesta del usuario antes de contestar al JSON-RPC.
   - Cancelación: enviar `session/cancel`, esperar cierre breve y terminar el process group completo (`SIGKILL` + `reap_group`).
6. **Cierre y recuperación (`AGENTS.md`):**
   - Guardar `NativeContext { runner: Some(NativeRunner::Agy), ... }` solo tras confirmación de sesión.
   - Tras reinicio del daemon con un intento en `Phase::Uncertain`, confirmar `process_group_stopped(pid)` en `settle_recovered` antes de pasar a `Phase::Failed`, conservando historial, respuestas parciales, decisiones y contexto nativo, **sin reenviar nunca automáticamente** el turno interrumpido.

### Nota de autenticación y cumplimiento (ToS)
- `agy acp` soporta `oauth-personal`, `oauth-business`, `gemini-api-key` y `agent-platform`.
- En cuentas OAuth personales de consumidor, el uso interactivo local dirigido por el usuario está soportado, pero los loops multi-agente autónomos tienen restricciones frente a API key / Gemini Enterprise / Vertex.
- `agy_readiness.rs` debe detectar y proyectar el estado/método de autenticación sin exponer secretos, para que Deck pueda informar claramente al usuario si aplica alguna restricción en delegación multi-agente.

---

## 4. Mapa de cambios en `deck-next`

### A. Contrato compartido (`crates/shared`)
- `crates/shared/src/lib.rs`
  - Agregar `NativeRunner::Agy`.
  - Agregar `NativeTransport::AgyAcp`.

### B. Nuevos módulos en `crates/host/src/`
- **`agy_acp.rs`**: cliente JSON-RPC 2.0 sobre `ChildStdin`/`BufReader<ChildStdout>` (`initialize`, `session/new`, `session/load`, `session/resume`, `session/set_mode`, `session/set_config_option`, `session/prompt`, `session/cancel`, lectura acotada de frames, despacho de `session/update` y `session/request_permission`).
- **`agy_readiness.rs`**: resolución de `agy` en `PATH`, validación del directorio de estado (`~/.gemini/antigravity-cli`), probe de readiness/auth vía `agy acp` y endpoint `/api/agy/readiness`.
- **`agy_approval.rs`**: traducción de `session/request_permission` a `Decision` + `NativeApproval` + `PermissionScope`, validación de paths contra `ProjectBinding` y resolución `AllowOnce` / `AllowSession` / `Deny`.
- **`agy.rs`**: `RUNNER = "agy"`, `QUALIFICATION`, `inventory()`, `bind()`, `admitted()`, `selection_key()`, `lead()`, `settle_recovered()`.
- **`agy_member.rs`**: ejecución de roles delegados (`investigate`, `architect`, `apply-fast`, `apply-deep`, `quality`, `setup`) con `session_mcp::Bridge::start_member`, `handoff` y `compatible_predecessor`.

### C. Cableado en módulos existentes (`crates/host/src/`)
- `native_identity.rs`: mapear `NativeRunner::Agy => "acp"` en `validate_binding()` y aceptar `NativeTransport::AgyAcp` en `inspect()`.
- `member_integration.rs`: añadir `Integration::Agy` (`shares_lead_slots = true`, `profile = ExecutionProfile::IndependentDedicated`, `provenance`, `for_receipt`, `for_attempt`, `resolve_model`, `snapshot_runner_matches`).
- `session_contract.rs`: registrar `crate::agy::RUNNER` en `model_data()`, `model_data_for()` y `selection_snapshot()`.
- `session_mcp.rs`: habilitar `delegate_roles` (Lead) y `git_project` (Members) para `NativeRunner::Agy` (actualmente filtrados solo para `Claude`).
- `server.rs` y `session_tasks.rs`: dispatch de `Integration::Agy` a `agy::lead` / `agy::member::run`, `agy::settle_recovered` al arrancar, y ruta de readiness.
- `execution_view.rs`, `permission_policy.rs`, `native_approval.rs`: soporte de `NativeTransport::AgyAcp` para visualización de acciones, validación y grants de sesión.
- `observations.rs` y `session_continuity.rs`: `observe_agy()` + basis `"agy-acp-usage"` si la Fase 0 confirma `usage_update`.
- `runner_management.rs` y `lib.rs`: etiqueta de runner e inspección/mantenimiento (`agy --version`, `agy update`).

### D. Frontend (`frontend/src/`)
- `runner-mark.tsx`: icono SVG inline y nombre (`Antigravity` / `AGY`).
- `runners.tsx`: añadir `'agy'` al selector de mantenimiento.
- `session-approvals.tsx` y `context-window.tsx`: soporte de etiquetas/formato para `AgyAcp` y `agy-acp-usage` (si aplica).
- `session-configuration.tsx`: sin cambios estructurales (ya consume `GET /api/sessions/models` dinámicamente).

---

## 5. Plan de implementación por fases

### Fase 0 — Spike de protocolo real (`agy acp` autenticado)
Capturar los payloads reales de `agy acp 1.5.16` en una sesión autenticada antes de escribir el cliente:
> Completada el 2026-11-25 con `agy 1.5.16` autenticado (Google AI Pro). Payloads exactos en `openspec/changes/agy-runner-parity/brief.md`.

- [x] Esquema exacto de `session/new` (`configOptions` de modelo/effort y `modes`). Niveles válidos por modelo = sufijos en `availableModels`.
- [x] Esquema exacto de `mcpServers` (HTTP + `Authorization`) y `_meta.antigravity.systemPrompt.append`. Las tools MCP llegan como `mcp_<server>_<tool>` y también piden permiso.
- [x] Notificaciones reales de `session/update`; `usage_update` sí llega (`used`, `size`).
- [x] Payload real de `session/request_permission` (ids string, opciones `allow_once` / `reject_once`) y respuesta `{outcome:{outcome:"selected",optionId}}`.
- [x] `session/resume` en proceso nuevo conserva el historial; el `systemPrompt.append` se acumula, así que solo se envía en `session/new`. `session/cancel` devuelve `stopReason: "cancelled"`.
- [x] No se observaron extensiones `_meta` de cuota ni de live steering.

### Fase 1 — MVP Lead en `agy acp`
- [x] `NativeRunner::Agy` y `NativeTransport::AgyAcp` en `crates/shared`.
- [x] `agy_acp.rs`, `agy_readiness.rs`, `agy_approval.rs`, `agy.rs` (Lead).
- [x] Catálogo de modelos en `session_contract.rs` + selección en UI.
- [x] Streaming, permisos `Ask first` / `YOLO`, cancelación, continuidad nativa (`session/resume`) y recuperación tras reinicio.
- [x] Fixture `crates/host/tests/fake_agy_acp.py` + tests en `cargo test -p deck2`.

### Fase 2 — Paridad completa de sesión y equipo
- [x] `agy_member.rs` + `agy_sandbox.rs` + delegación vía `session_mcp::Bridge` (`deck_delegate`, `deck_task_*`, etc.).
- [x] Inyección de MCPs externos (`deck-codebase-memory`, `deck-context7`) en `mcpServers`.
- [x] Adjuntos de imagen en `session/prompt`.
- [x] Observación de contexto (`observations.rs` / `context-window.tsx`) desde `usage_update`.
- [x] Tests de paridad en `crates/host/tests/session_parity.rs`.

### Fase 3 — Pulido y cierre
- [x] Icono en `runner-mark.tsx` y mantenimiento en `runners.tsx` / `runner_management.rs`.
- [x] Cuota de suscripción (ventanas de 5 h y semanal de Gemini + auto-refresh tras turno del Lead); live steering sigue pendiente de soporte upstream en `agy acp`.
- [x] Verificación final de workspace, frontend, release e instalación atómica.
