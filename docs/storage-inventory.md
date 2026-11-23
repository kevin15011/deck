# Inventario de almacenamiento de Deck 2

Corte local del 23 de noviembre de 2026. Este catálogo cubre el host, las herramientas que gestiona y los datos que la interfaz deja en el navegador. Las ubicaciones se expresan respecto al usuario que ejecuta Deck. Los proyectos pueden estar en otros discos.

## Mapa de datos

| Qué guarda | Dónde | Ciclo de vida |
|---|---|---|
| Conversaciones locales del Lead, mensajes del usuario, cola, respuestas parciales, tiempos, runner, turno y resultado | Directorio de estado, `state.db`: principalmente `sessions`, `receipts`, `session_events` y `activity_steps` | Permite reconstruir la conversación al reconectar. Quitar una sesión local terminada elimina sus registros de estas tablas. |
| Trabajo delegado: encargos, intentos, resultados, llamadas, decisiones de integración y referencias al hilo nativo | Misma base: `tasks`, `task_calls`, eventos y actividad. Los snapshots de lectura y sus accesos también se vinculan al trabajo. | La eliminación local retira tareas, llamadas y snapshots dependientes en una transacción. |
| Imágenes subidas al chat | `state.db → images`: bytes originales en un BLOB, metadatos e identificadores de imagen, carga y sesión. `image_cancellations` registra cancelaciones. | Se almacenan al subirlas. Al preparar una entrega al runner, Deck puede materializar una copia temporal. Quitar la sesión elimina sus filas de imágenes y cancelaciones. |
| Permisos y decisiones, respuestas, rechazos, revisiones de asignación y selección de sesión | `state.db`: recibos, `session_decisions`, `decision_commands`, `decision_replies`, `permission_rejections`, `session_selections` y `session_epochs` | Respaldan las decisiones entre turnos y reinicios. La eliminación de la sesión retira los registros asociados que contempla esa operación. |
| Proyectos registrados, rutas, orden de navegación, definiciones, configuración, planes, operaciones de administración y diagnósticos | `state.db`: familias `projects`, `meta`, `definitions`, `configurations`, `runner_*`, `management_operations`, `diagnostics` y otras | Son datos del workspace compartidos entre sesiones. Registrar un proyecto guarda su referencia. Code Map puede además conservar capturas e índices derivados de su código. |
| Historial adoptado de Deck 1 | `original-history.db`: sesiones, eventos, mensajes, versiones de tareas y datos de recuperación | Copia local para consultar el historial original. Quitar una entrada histórica de la navegación conserva su historial. La base y las raíces originales de Deck 1 son ubicaciones distintas. |
| Estado del servidor y autorización del navegador | Directorio de estado: `launcher.json`, `host.lock`, `local-devices.json`, `host.log`. El navegador guarda cookies de autorización. | El archivo del lanzador contiene información privada de acceso. Los logs de arranque adicionales observados en esta máquina pueden proceder de operaciones anteriores. |
| Notificaciones, suscripciones push, respuestas mostradas, lectores y pendientes | Directorio opcional `notifications/`: archivos JSON de identidad y push, `lead-replies.sqlite` y `push-attention.sqlite` | Se crean al inicializar este almacenamiento. La carpeta no estaba presente en el directorio de estado medido. |
| Codebase Memory / Code Map | Registros, consultas y capturas de preparación en `state.db` (`cbm_*`); paquetes de herramientas en `cbm-artifacts/` e índices y estado de servicios en `cbm-services/`, bajo la raíz gestionada | Una captura de preparación y el índice del servicio son datos diferentes. La implementación contempla poda de capturas; su presencia se midió directamente. |
| Herramientas, operaciones de instalación y dictado | Raíz gestionada: `artifacts/`, `operations/`, `runners/`, `staging/`, bloqueos y `dictation/{models,tmp}/` | Los paquetes y modelos instalados pueden persistir. El dictado escribe el audio en un directorio temporal por operación. |
| Borradores y preferencias del navegador | Almacenamiento local del origen de Deck en el perfil de Edge u otro navegador. Incluye borrador por sesión, preferencias de interfaz y marcas locales de acciones pendientes | Dependen del navegador y perfil. Una copia de la base del host por sí sola no contiene un borrador que solo se escribió en el navegador. |
| Transcripciones y credenciales nativas de Codex o Claude | Perfil del runner utilizado. Deck conserva identificadores y resultados propios que vinculan la sesión con ese historial | Pertenecen al runner. Quitar una sesión local de Deck conserva los archivos del proyecto y la historia nativa. |
| Ejecutable | En esta instalación, `~/.local/bin/deck2` | Se sustituye al instalar. Los artefactos de compilación del repositorio y las dependencias de desarrollo quedan fuera del cómputo de datos operativos. |

El directorio de estado se elige con `--state-dir`; por defecto es `$XDG_STATE_HOME/deck2` o `~/.local/state/deck2`. La raíz gestionada predeterminada es `~/.local/share/deck2-managed-v1`. SQLite puede mantener junto a la base los archivos `-wal` y `-shm` mientras el host está en marcha.

## Espacio observado en esta máquina

| Ubicación | Tamaño aproximado | Desglose |
|---|---:|---|
| `original-history.db` | 1,81 GiB | 1.712 MiB de páginas de `original_events`; los mensajes ocupan unos 25 MiB y los índices también cuentan. |
| `state.db` | 157 MiB | 71,2 MiB de capturas de preparación de Code Map, 32,5 MiB de eventos de sesión, 28,4 MiB de actividad y 7,8 MiB de la tabla de imágenes. El resto incluye índices y otras tablas. |
| Imágenes, **incluidas** en la fila anterior | 49 imágenes, 7,77 MiB de contenido | La suma de los bytes de imagen fue 8.144.836. El tamaño de tabla incluye metadatos y páginas SQLite. |
| Archivos auxiliares del estado | Variable | En la medición, el WAL ocupaba unos 4,1 MiB y el SHM, 32 KiB. |
| Raíz gestionada | 864 MiB | 634 MiB en dos paquetes de Codebase Memory, 215 MiB en servicios de Code Map y 16 MiB en otros artefactos. |
| Ejecutable instalado | 36 MiB | Contado aparte de los datos. |
| Copias y estados secundarios observados | 257 MiB en `~/.local/state/deck2-backups` | También existen directorios pequeños de preview y operaciones. Su origen y política de rotación no se verificaron. |
| Instalación anterior, separada | 14 GiB en `~/.local/state/deck`, 2,3 GiB en `~/.local/share/deck`, 1,4 GiB en `~/.cache/deck` | Medidas por directorio. Se excluyen del total activo de Deck 2. |

**Cómo se midió.** Metadatos del sistema de archivos, espacio asignado por directorio con `du`, esquema SQLite y agregado de páginas por tabla con `dbstat` en conexión de solo lectura. Los tamaños están redondeados y la base activa cambia durante el uso. El corte contó 9 sesiones locales, 331 recibos y 64 tareas. No se inspeccionaron mensajes, imágenes ni secretos. Los perfiles de navegador y runner no se midieron. El borrado de filas SQLite puede dejar páginas reutilizables y no implica una reducción inmediata del archivo en disco.

**Referencias en el código.** [Directorio de estado](../crates/host/src/main.rs), [raíz gestionada](../crates/host/src/managed_tools.rs), [imágenes](../crates/host/src/images.rs), [eliminación de sesiones](../crates/host/src/sessions.rs), [historial adoptado](../crates/host/src/history_adoption.rs), [notificaciones](../crates/host/src/notification_store.rs), [capturas de Code Map](../crates/host/src/cbm_management.rs), [dictado](../crates/host/src/dictation.rs) y [borradores del navegador](../frontend/src/app.tsx).
