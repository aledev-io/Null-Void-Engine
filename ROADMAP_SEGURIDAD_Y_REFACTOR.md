# 🛡️ Auditoría de Seguridad y Hoja de Ruta de Refactorización (Null-Void-Engine)

> **Documento de seguimiento del análisis de seguridad, correcciones aplicadas y deuda técnica pendiente.**  
> *Fecha de auditoría: 10 de Agosto, 2026*

---

## 📑 1. Vulnerabilidades Identificadas y Correcciones Aplicadas

### 🔴 A. Ejecución Remota de Código (RCE) en Módulo Spreadsheet
* **Ubicación**: [`null-void-service/src/modules/api/spreadsheet/routes.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/null-void-service/src/modules/api/spreadsheet/routes.py#L48-L63)
* **Estado**: **CORREGIDO (v2)** ✅
* **Problema**: El endpoint `/api/spreadsheet/run-python` ejecutaba código Python arbitrario pasando `{"__builtins__": __builtins__}` a `exec()`, permitiendo ejecución de comandos del SO (`os.system`, `subprocess`) o lectura de archivos locales.
* **Solución Aplicada (v1)**: Se implementó un sandbox restringiendo `__builtins__` únicamente a funciones matemáticas y de tipos básicos seguros (`safe_builtins`), bloqueando cualquier `import` o acceso a módulos de sistema.
* **Reapertura (v2, 11/08/2026)**: El sandbox de builtins era **evadible sin ningún builtin** vía introspección de objetos: `().__class__.__mro__[1].__subclasses__()` + filtro por `__name__` + `.__init__.__globals__["sys"].modules["os"]` → `os.popen()` (RCE probado empíricamente, `uid 1000`). La restricción de `__builtins__` no afecta a la introspección de atributos.
* **Solución Aplicada (v2)**: Validación **AST** previa a `exec()` (`_validate_sandbox_code`): se rechazan todos los atributos `dunder` (`__class__`, `__globals__`, `__subclasses__`, ...), sentencias `import`/`class`/`global`/`nonlocal`, los nombres de introspección (`getattr`, `vars`, `globals`, `dir`, `eval`, ...) y códigos > 5000 caracteres. Regresión cubierta por `tests/test_spreadsheet_sandbox.py` (13 casos, incluido el escape probado).

---

### 🔴 B. SSRF y Lectura de Archivos Locales en Scraper (Playwright)
* **Ubicación**: [`scraper_service/src/url_guard.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/scraper_service/src/url_guard.py) y [`scraper_service/src/app.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/scraper_service/src/app.py#L176)
* **Estado**: **CORREGIDO** ✅
* **Problema**: El endpoint `/detail` abría un navegador automatizado Playwright en cualquier `url` proporcionada, lo que permitía leer archivos locales (`file:///etc/passwd`, `file:///app/.env`) o atacar servicios de la red interna (`127.0.0.1`, `169.254.169.254`).
* **Solución Aplicada**: Se creó `url_guard.py` con `validate_public_url()` para exigir únicamente esquemas `http://` / `https://` y resolver el hostname bloqueando cualquier IP interna, privada, loopback o reservada.

---

### 🟠 C. Microservicio Scraper Expuesto sin Autenticación
* **Ubicación**: [`scraper_service/src/app.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/scraper_service/src/app.py#L24) y [`null-void-service/src/core/scraper_client.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/null-void-service/src/core/scraper_client.py)
* **Estado**: **CORREGIDO** ✅
* **Problema**: El microservicio escuchaba en el puerto `5001` sin exigir credenciales entre servicios.
* **Solución Aplicada**: Se implementó la cabecera compartida `X-Internal-Token` usando la clave `SCRAPER_API_KEY`, interceptando todas las peticiones con un `@app.before_request` que devuelve HTTP 401 si no hay token válido.

---

### 🟠 D. Verificación SSL/TLS Desactivada en Cliente de Escritorio (MITM)
* **Ubicación**: [`client_agent/cloud_api.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/client_agent/cloud_api.py#L69) y [`client_agent/qt_gui.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/client_agent/qt_gui.py#L1300)
* **Estado**: **CORREGIDO** ✅
* **Problema**: El agente ejecutaba peticiones con `verify=False` sin validar certificados autofirmados, vulnerable a Man-In-The-Middle.
* **Solución Aplicada**: Se implementó Certificate Pinning por huella SHA-256 (`AGENT_CERT_HASH`). Al vincular el cliente desde la GUI Qt, se muestra un diálogo para confirmar y guardar la huella digital del servidor.
* **Extensión (11/08/2026)**: el **script del sync agent** (`sync_agent/sync_agent.py`) también usaba `verify=False` **sin pinning** en sus 6 puntos de red (ping, upload, delete, mkdir, changes, download). Ahora el servidor incrusta automáticamente la huella SHA-256 de su propio certificado (`_server_tls_fingerprint()`) en el script generado (`EXPECTED_FINGERPRINT`), y `_req()` verifica la huella tras cada petición, abortando con `CERT_MISMATCH` si no coincide. Se corrigió además un SyntaxError pre-existente en la plantilla (`try` tras `;` en la limpieza de `initial_sync`). Regresión cubierta por `tests/test_sync_agent_script.py`.

---

### 🟠 E. Claves Secretas y Credenciales de Fábrica
* **Ubicación**: [`null-void-service/src/config/config.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/null-void-service/src/config/config.py#L40) y [`null-void-service/sync_agent/sync_agent.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/null-void-service/sync_agent/sync_agent.py#L88)
* **Estado**: **CORREGIDO** ✅
* **Solución Aplicada**: `config.py` genera automáticamente una `SECRET_KEY` aleatoria de 64 caracteres hex que se persiste en `data/app/secret_key`. Se eliminaron los fallbacks hardcodeados y se muestra una advertencia si `CREDENTIALS` conserva `admin:admin`.

---

### 🟡 F. Almacenamiento de Contraseñas de Aplicación (Mail) en Texto Plano
* **Ubicación**: [`null-void-service/src/core/crypto_utils.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/null-void-service/src/core/crypto_utils.py)
* **Estado**: **CORREGIDO** ✅
* **Solución Aplicada**: Cifrado simétrico AES-256-GCM derivado con PBKDF2 desde la `SECRET_KEY` para cifrar `gmail_app_password` en la base de datos `manager.db`.

---

### 🟡 G. Rate Limiting en Cloud y Ajuste para Películas
* **Ubicación**: [`null-void-service/src/modules/api/cloud/routes.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/null-void-service/src/modules/api/cloud/routes.py#L470) y [`null-void-service/src/core/limiter.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/null-void-service/src/core/limiter.py)
* **Estado**: **CORREGIDO** ✅
* **Solución Aplicada**: Se asignaron límites específicos por endpoint. `get_limiter_key()` aísla las cuotas del agente (`agent:token`) respecto de la web (`user:IP`). La ruta `/stream_video` se ajustó a **3000 peticiones/hora** para evitar cortes durante peticiones HTTP Range de películas largas.

### 🟡 H. Cifrado en Reposo de Copias de Seguridad y Restauración
* **Ubicación**: [`null-void-service/src/core/crypto_utils.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/null-void-service/src/core/crypto_utils.py#L70), [`core/backup.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/null-void-service/src/core/backup.py#L888) y [`modules/api/backup/routes.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/null-void-service/src/modules/api/backup/routes.py#L354)
* **Estado**: **CORREGIDO** ✅
* **Solución Aplicada**: Cifrado at-rest de copias de seguridad `.zip`/`.nvbak` usando **AES-256-GCM** por bloques en `encrypt_file()`. Implementada la función `restore_backup()` con descifrado seguro y extracción anti-Zip Slip, junto con el endpoint `POST /api/backup/restore` y descarga transparente en `api_backup_download()`.

---

### 🟡 I. XSS Almacenado en Previsualización de SVG (`preview_file`)
* **Ubicación**: [`null-void-service/src/modules/api/cloud/services.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/null-void-service/src/modules/api/cloud/services.py#L1404)
* **Estado**: **CORREGIDO** ✅
* **Problema**: Un SVG con `<script>` subido al Cloud se servía inline en el mismo origen, permitiendo ejecutar código en la sesión del viewer.
* **Solución Aplicada**: La respuesta de preview de `.svg` ahora incluye `Content-Security-Policy: default-src 'none'; script-src 'none'; object-src 'none'; img-src data:` — sin `unsafe-inline`.

---

### 🟡 J. Deuda de Cuota en Sobrescritura y Compartición (Regresión cloud)
* **Ubicación**: [`null-void-service/src/modules/api/cloud/services.py`](file:///home/axel/proyectos/nullvoid-local/Null-Void-Engine/null-void-service/src/modules/api/cloud/services.py#L690)
* **Estado**: **CORREGIDO** ✅
* **Problema**: (1) `upload_file` con `overwrite_existing=True` borraba el destino **antes** de validar la cuota: si la cuota fallaba, el archivo original se perdía. (2) `copy_item` y `get_multi_download_token` usaban `require_access` solo con el nombre del archivo, bloqueando copiar/descargar archivos dentro de **carpetas compartidas** (share de carpeta).
* **Solución Aplicada**: El reemplazo in-place ahora ocurre solo tras pasar el chequeo de cuota. Para recursos compartidos, ambas funciones resuelven vía `_resolve_shared_or_recent_path()`, que valida la carpeta ancestra compartida (manteniendo IDOR denegado).

---

## 🛠️ 2. Hoja de Ruta de Refactorización Futura (Deuda Técnica / Código Espagueti)

### 📌 Prioridad Alta: Refactor de Componentes Monolíticos

1. **Refactorizar `client_agent/qt_gui.py` (~80 KB / >2.000 líneas)**:
   * *Diagnóstico*: Mezcla UI PySide6, hilos asíncronos, diálogos, bandeja de sistema, CSS y llamadas de red.
   * *Acción propuesta*: Dividir en patrón MVC/MVVM:
     * `client_agent/ui/views/` (Ventanas y diálogos)
     * `client_agent/ui/components/` (Widgets reutilizables)
     * `client_agent/ui/controllers/` (Lógica de negocio y workers)

2. **Dividir `null-void-service/src/modules/api/cloud/services.py` (~97 KB / 2.466 líneas)**:
   * *Diagnóstico*: Monolito con subidas, papelera, thumbnails, transcodificación, ZIPs, cuotas y compartición.
   * *Acción propuesta*: Crear submódulos dentro de `cloud/`:
     * `cloud/transcoder.py` (vídeo y miniaturas)
     * `cloud/sharing.py` (recursos compartidos e IDOR)
     * `cloud/archive.py` (gestión ZIP)
     * `cloud/trash.py` (papelera)

---

### 📌 Prioridad Media: Mejoras de Arquitectura y Rendimiento

3. **Abstracción de Consultas SQL Directas en `routes.py`**:
   * Mover las consultas SQL directas presentes en controladores HTTP hacia `repository.py` en los módulos que aún conservan llamadas en vivo a `get_db()`.

4. **Migración de `audit.json` y `security.json` a SQLite**:
   * Reemplazar la reescritura periódica de JSONs en disco por tablas dedicadas `audit_logs` e `ip_blocks` en `manager.db` para aprovechar el modo WAL de SQLite.

5. **Reconexión Exponencial en `client_agent`**:
   * Implementar *Exponential Backoff con Jitter* en las reconexiones del agente cuando el servidor remoto se apaga o reinicia.

