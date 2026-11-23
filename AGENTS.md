# Compilaciones de Deck2

- Conserva una sola compilación en el proyecto. El ejecutable que se entrega es `dist/deck2`. Al publicar una actualización, reemplázalo de forma atómica después de verificar el nuevo binario.
- Usa un único directorio de Cargo para compilar y probar. Si otro proceso lo está usando, espera a que termine.
- Conserva `target/debug/` entre tareas (dependencias, caché incremental y binarios de pruebas). Borrar la caché incremental o los binarios de `deck2` obliga a recompilar `deck2` desde cero (~4–5 min).
- Al terminar una tarea, si `target/debug/` supera 8 GB, elimina primero los artefactos que la última compilación no tocó: las entradas de `deps/`, `build/`, `.fingerprint/` e `incremental/` más antiguas que el inicio de esa compilación. Si sigue por encima de 8 GB, o si cambió la toolchain de Rust, elimina `target/debug/` completo.
- Conserva también las dependencias de `target/release/` entre publicaciones: compilarlas desde cero cuesta ~15–20 min, y conservadas el build de release solo recompila `deck2` (~3–5 min). Después de publicar o descartar el binario, elimina únicamente los ejecutables de `deck2` en release (`target/release/deck2` y `target/release/deps/deck2-*`). Si `target/release/` supera 4 GB, aplica la misma limpieza de artefactos antiguos que en `target/debug/`; si sigue por encima, o si cambió la toolchain de Rust, elimínalo completo.

# Pruebas

- La suite completa (`cargo test --locked -p deck2`) debe tardar como máximo 5 minutos incluida la compilación incremental. Ningún test debería superar ~60 s: el más lento fija el mínimo de toda la suite.
- `.cargo/config.toml` pone `TMPDIR=/dev/shm`: los tests crean muchas bases SQLite con `synchronous=FULL` y cada `fsync` en el disco de WSL2 cuesta ~0,5 s. No alargues las rutas temporales: algunos tests crean sockets Unix cerca del límite `SUN_LEN`. Los tests de CBM dejan directorios de solo lectura (~100 KB por corrida). Al terminar, si no hay compilaciones ni pruebas en curso, elimina de `/dev/shm` solo las entradas de tu usuario con nombres `.tmp*`, de 6 caracteres alfanuméricos, `deck2-*` o `rustc*`; antes de borrarlas, dales permiso de escritura (`chmod -R u+w`).
- El perfil `dev` compila las dependencias optimizadas. No cambies `[profile.dev]` ni variables que Cargo registra en la huella de compilación (por ejemplo `RUSTC_BOOTSTRAP`) sin necesidad: invalidan todas las dependencias y cuestan ~15 min de recompilación.
- Para iterar, ejecuta solo los tests del área tocada (por ejemplo `cargo test -p deck2 --lib native::`) y deja la suite completa para antes de publicar.
- Evita acumular copias de ejecutables anteriores en `target/`, `dist/` o el directorio de instalación. Si el daemon aún usa la versión anterior, conserva esa copia únicamente hasta verificar el reinicio con la nueva versión.
- Limita la limpieza a artefactos de compilación. Antes de borrar un directorio compartido, identifica y conserva sus bases de datos, respaldos de sesiones y evidencias de pruebas.

# Continuidad de las sesiones

- Deck no debe bloquear el trabajo del usuario. Actualizar la interfaz o recuperar la conexión debe permitir seguir redactando y conservar la cola. Limita las esperas por permisos o por un resultado incierto a las operaciones que realmente dependan de ellos.

- Deck debe permitir que las personas retomen su trabajo en la misma sesión. Un intento interrumpido puede tener un resultado desconocido incluso después de liberar el proceso que lo ejecutaba.
- Cuando se confirme que el intento dejó de ejecutarse, libera su reserva y atiende el siguiente mensaje de la cola una sola vez. Conserva el contexto nativo, el historial, las respuestas parciales y las decisiones registradas. Nunca reenvíes automáticamente el turno interrumpido.
- Si un proceso o una aprobación aún requiere atención, muestra qué está esperando la sesión y cómo continuar. Verifica la continuidad con un mensaje en cola, tanto con el daemon en marcha como después de un reinicio.
