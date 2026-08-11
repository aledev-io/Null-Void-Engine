# Null-Void Engine

Herramienta local-first para monitorizar recursos del sistema, gestionar almacenamiento y automatizar backups, con un asistente de IA integrado.

---

## Instalación

### Requisitos Previos: Archivo `.env`
Tanto si usas Docker como si lo instalas manualmente, primero debes crear un archivo llamado `.env` en la raíz del proyecto (junto a `docker-compose.yml`). Un ejemplo con **todas las variables posibles** sería: las que están comentadas son opcionales (con `#`) y puedes dejarlas como están. Lo único imprescindible es cambiar `CREDENTIALS` por tu usuario y contraseña:

```env
# ===== Acceso y servidor =====
CREDENTIALS=admin:admin          # usuario:contraseña (varias separadas por coma)
SECRET_KEY=""                    # clave secreta de la app (déjala vacía: se genera sola y se guarda)
HOST=0.0.0.0                     # IP donde escucha el servidor
FLASK_PORT=5000                  # puerto de acceso
DEBUG=false                      # true = modo desarrollo (no usar en producción)
SERVER_NAME=NullVoid             # nombre visible del servidor

# ===== HTTPS (cifrado) =====
# Para activarlo: USE_HTTPS=true y los certificados en la carpeta indicada.
# Si falta algún certificado, el servidor arranca igualmente sin cifrado.
USE_HTTPS=false                  # true = servidor con cifrado HTTPS
#CERTS_HOST_DIR=./certs          # carpeta de certificados en el disco (por defecto ./certs)
CERT_FILE="/app/certs/cert.pem"  # ruta del certificado (dentro del contenedor)
KEY_FILE="/app/certs/key.pem"    # ruta de la clave privada (dentro del contenedor)

# ===== Almacenamiento =====
# Por defecto todo se guarda en la carpeta data/ del proyecto.
# Para usar otros discos o carpetas, descomenta y pon tu ruta:
#DATA_HOST_DIR=./data            # datos de la app (bases de datos, Cloud, etc.)
#SCRAPER_HOST_DIR=./data         # datos del scraper (base de datos, imágenes, logs)
DATA_DIR=data/app                # subcarpeta de datos de la app
SCRAPER_DIR=data/scraper         # subcarpeta de datos del scraper
#DB_PATH=                        # ruta de la base de datos (por defecto data/app/manager.db)

# ===== Microservicio scraper (extracción web) =====
# El scraper es un servicio aparte que se inicia y se detiene manualmente.
SCRAPER_API_KEY=cambia-esta-clave  # clave compartida entre la app y el scraper
#SCRAPER_BASE_URL=http://127.0.0.1:5001   # cómo la app llama al scraper
#ENGINE_BASE_URL=http://127.0.0.1:5000    # cómo el scraper llama a la app
AUTO_SCRAPE_ENABLED=false        # true = extracciones automáticas programadas

# ===== Asistente de IA local (Ollama) =====
OLLAMA_HOST=http://127.0.0.1:11434

# ===== Notificaciones push (móvil) =====
FCM_SECRET_KEY=                  # clave del servicio de notificaciones
#FCM_CREDENTIALS_PATH=           # archivo de credenciales del servicio (en .secrets/)

# ===== Correo (cuentas alternativas) =====
#ALIAS_SMTP_HOST=smtp.gmail.com  # servidor de salida de correo
#ALIAS_SMTP_PORT=587             # puerto del servidor de salida

# ===== Telegram (avisos del scraper) =====
TELEGRAM_ENABLED=false           # true = enviar avisos por Telegram
#TELEGRAM_BOT_TOKEN=             # token del bot de Telegram
#TELEGRAM_CHAT_ID=               # chat o grupo donde recibir los avisos

# ===== Vídeo (transcodificación) =====
#VIDEO_CACHE_MAX_MB=5120         # máximo de caché de vídeo (MB)
#VIDEO_PREWARM_QUALITY=720p      # calidad que se genera al abrir un vídeo
#VIDEO_TRANSCODE_TIMEOUT=900     # tiempo máximo para convertir un vídeo (s)

# ===== Ajustes avanzados de backups (no tocar salvo necesidad) =====
#BACKUP_WORKERS=2
#BACKUP_CHUNK_BYTES=2097152
#BACKUP_MAX_FILES=1000
#BACKUP_MAX_FILE_BYTES=104857600
#BACKUP_MAX_TOTAL_BYTES=1073741824
#BACKUP_MAX_TREE_DEPTH=20
#BACKUP_SUSPICIOUS_RATIO=0.5
#BACKUP_PROGRESS_EVERY_BYTES=10485760
#ZIP_CHUNK_BYTES=2097152
#ZIP_MAX_UNCOMPRESSED_BYTES=536870912
```

> <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg> **Clave del agente de sincronización:** si instalas el agente de escritorio (Null-Void Cloud), su `.env` propio admite `AGENT_CERT_HASH` con la huella del certificado del servidor (solo útil con HTTPS).

---

### Despliegue Rápido con Docker

El motor está completamente configurado para levantar el backend y el servicio integrado de **Ollama** de forma aislada.

> **¿No tienes Docker instalado?**
>
> <details>
> <summary><b>Haz clic aquí para ver cómo instalarlo según tu Sistema Operativo</b></summary>
>
> #### <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg> Linux (Ubuntu / Debian y derivados)
> ```bash
> sudo apt-get update
> sudo apt-get install docker.io docker-compose -y
> sudo systemctl start docker
> sudo systemctl enable docker
> sudo usermod -aG docker $USER
> ```
> #### <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Windows
> 1. Descarga e instala [Docker Desktop](https://www.docker.com/products/docker-desktop/).
> 2. Asegúrate de tener habilitado **WSL 2**.
> </details>

Si ya tienes Docker y creaste tu archivo `.env`, levanta el proyecto:

```bash
# Levantar el entorno y compilar las imágenes en segundo plano
docker compose up --build -d

# Para ver los logs
docker compose logs -f

# Para detener los servicios
docker compose down
```

> <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> **Microservicio scraper:** es un servicio aparte (contenedor `nullvoid-scraper`) que **no arranca con el resto**: se activa manualmente cuando lo necesites con:
> ```bash
> docker compose --profile scraper up -d
> ```
> Para detenerlo, el mismo comando con `down`. No es necesario para el funcionamiento del resto de la app.

---

### <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Activar HTTPS (Opcional)

Si deseas usar cifrado seguro (HTTPS), sigue estos pasos:

1. Crea la carpeta de certificados y genera unos de prueba. (Usa `sudo` para evitar problemas de permisos si Docker ya ha creado la carpeta):
```bash
sudo mkdir -p certs
sudo openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes
sudo chown -R $USER:$USER certs
```

> Los certificados pueden estar en cualquier carpeta del disco: solo indica la ruta con `CERTS_HOST_DIR` en el `.env` (por defecto `./certs`, la carpeta de la raíz del proyecto).

2. Edita tu archivo `.env` para activar la opción:
```env
USE_HTTPS=true
```

3. Reinicia tu servidor (`docker compose down && docker compose up -d`).

Acceso: `http://localhost:5000` (o `https://localhost:5000` si habilitaste SSL).

> <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> **Sin HTTPS, sin agente de escritorio:** el ejecutable del agente de sincronización solo se descarga por HTTPS (evita que alguien lo altere por el camino). Si el servidor corre sin cifrado, la app funciona igual, pero la descarga del agente estará desactivada.



## Stack

- **Backend:** Python 3.x / Flask + Flask-SocketIO (Eventlet)
- **Base de datos:** SQLite 3 (usuarios, historial de chats, auditoría y telemetría)
- **Frontend:** HTML5 semántico, Vanilla JS y CSS con arquitectura de variables CSS (soporte nativo de tema oscuro/claro)
- **100% offline:** `socket.io.min.js`, `marked.min.js` y `highlight.min.js` cargados localmente desde el servidor.

---

## Estructura del proyecto

```
├── certs/                 # Certificados SSL/TLS
├── data/                  # SQLite, backups y almacenamiento cloud (autogenerado)
├── null-void-service/     # Servicio backend principal
│   └── src/
│       ├── config/        # Variables de entorno y configuración
│       ├── core/          # Componentes core, webpush, telemetría
│       ├── modules/       # Lógica de negocio y sesiones
│       │   └── api/       # Controladores REST (cloud, IA, vault, scraper, backups)
│       ├── static/        # Scripts, estilos, librerías y Service Workers
│       ├── templates/     # HTML (auth, dashboard, módulos)
│       └── app.py         # Punto de entrada principal
├── scraper_service/       # Microservicio local para extracción web
└── docker-compose.yml     # Orquestación de contenedores
```

---

## Seguridad

- **Instancia única:** Usa el puerto loopback `127.0.0.1:47213` como socket de bloqueo interno para evitar instancias duplicadas simultáneas.
- **Aislamiento multi-usuario:** Todos los datos de Cloud y sincronización están segmentados por `user_id`.
- **Auditoría local:** Se registran eventos críticos: inicios de sesión, backups y accesos no autorizados.
- **Sesiones persistentes:** La sesión activa sobrevive a reinicios del servidor y despliegues; solo se cierra al expirar (24 h) o al iniciar sesión desde otro dispositivo (una sesión por usuario).
- **Agente solo por HTTPS:** El ejecutable del agente de sincronización solo se sirve por HTTPS (ver sección de HTTPS).

---

## <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Acceso Remoto Seguro (Opcional)

Si deseas acceder a tu panel de **Null-Void Engine** de forma segura desde cualquier parte del mundo (sin necesidad de abrir puertos en tu router, configurar DNS dinámicas o exponer públicamente tu servidor), puedes utilizar **Tailscale** de manera sencilla:

1. **Instalar Tailscale:** Instala el agente de Tailscale en la máquina donde corre el servidor y en los dispositivos cliente desde los que te quieras conectar (móvil, laptop, tablet, etc.).

   * **Linux:**
     ```bash
     curl -fsSL https://tailscale.com/install.sh | sh
     sudo tailscale up
     ```

   * **Windows:**
     Descarga e instala el instalador oficial desde la página de [Descargas de Tailscale para Windows](https://tailscale.com/download/windows).

2. **Vincular dispositivos:** Inicia sesión con la misma cuenta en todos los dispositivos para agregarlos a tu red mesh privada y segura (Tailnet).

3. **Listo para conectar:** Usa la IP de Tailscale asignada a tu servidor (por ejemplo, `http://100.x.y.z:5000` o `https://100.x.y.z:5000` si habilitaste SSL) para entrar desde cualquier red móvil, Wi-Fi pública o desde cualquier parte del planeta con cifrado de punto a punto.

> <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg> **Soporte Multiusuario:** Gracias al aislamiento nativo de datos del motor, puedes compartir el nodo de tu servidor (mediante la función *Node Sharing* de Tailscale) o invitar a otros colaboradores a tu Tailnet para que registren sus propias cuentas.

---

## Características y Módulos Integrados

Null-Void Engine integra las siguientes herramientas en un único entorno:

### Asistente IA (Nexus AI)
* **Integración Local con Ollama:** Conexión directa a modelos de lenguaje locales (ej. TinyLLama, Deepseek).
* **Procesamiento de Archivos e Imágenes:** Soporte para adjuntar documentos que la IA puede leer y procesar.
* **Renderizado Avanzado:** Visualización offline de Markdown, bloques de código con resaltado de sintaxis y fórmulas matemáticas (KaTeX).

### Automatización y Web Scraper
* **Microservicio Dedicado:** Un servicio en Python que extrae y procesa datos web en segundo plano.
* **Base de Datos Propia:** Almacenamiento estructurado de los datos extraídos para su consulta y filtrado.

### Vault (Gestor de Contraseñas Zero-Knowledge)
* **Cifrado en el Cliente:** Las credenciales se cifran en el navegador; el servidor solo almacena blobs binarios (`.enc`).
* **Copias de Seguridad:** Sistema automático de respaldos (`.bak`) con rotación para evitar corrupción.

### Notificaciones Push y Recordatorios
* **Service Workers Background:** Recepción de notificaciones nativas en el sistema operativo incluso si la pestaña está cerrada, usando WebPush.
* **Gestor de Recordatorios:** Programación de alertas personalizadas integradas con las notificaciones del sistema.

### Telemetría y Monitorización
* **Dashboard en Tiempo Real:** Gráficas del uso de CPU, RAM, disco y red del servidor, actualizadas por WebSockets (`Chart.js`).

### Null-Void Cloud
* **Gestor de Archivos Local:** sistema de almacenamiento y organización de archivos del servidor.

### Calendario de Eventos
* **Planificación Visual:** Vistas fluidas (mensual, semanal, diaria).

### ERP, Facturas y Otras Utilidades
* **Gestor de Facturas:** Organización y seguimiento de facturación.
* **App Marketplace:** Instalación y gestión de módulos adicionales.
* **Chat Local:** Mensajería instantánea para redes privadas.