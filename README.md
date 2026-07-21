# Null-Void Engine

Herramienta local-first para monitorizar recursos del sistema, gestionar almacenamiento y automatizar backups, con un asistente de IA integrado.

---

## Instalación

### Requisitos Previos: Archivo `.env`
Tanto si usas Docker como si lo instalas manualmente, primero debes crear un archivo llamado `.env` en la raíz del proyecto (junto a `docker-compose.yml`). Este archivo contendrá la configuración básica:

```env
# Configuración del servidor
HOST=0.0.0.0
FLASK_PORT=5000
DEBUG=false
SECRET_KEY="cambia-esto-por-una-clave-segura"

# Credenciales de acceso (usuario:contraseña)
CREDENTIALS=admin:admin

# Configuración HTTPS
USE_HTTPS=false
CERT_FILE="/app/certs/cert.pem"
KEY_FILE="/app/certs/key.pem"

# Scraper automático en segundo plano
AUTO_SCRAPE_ENABLED=false
```

---

### Despliegue Rápido con Docker

El motor está completamente configurado para levantar el backend y el servicio integrado de **Ollama** de forma aislada.

> **¿No tienes Docker instalado?**
>
> <details>
> <summary><b>Haz clic aquí para ver cómo instalarlo según tu Sistema Operativo</b></summary>
>
> #### 🐧 Linux (Ubuntu / Debian y derivados)
> ```bash
> sudo apt-get update
> sudo apt-get install docker.io docker-compose -y
> sudo systemctl start docker
> sudo systemctl enable docker
> sudo usermod -aG docker $USER
> ```
> #### 🪟 Windows
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

---

### 🔒 Activar HTTPS (Opcional)

Si deseas usar cifrado seguro (HTTPS), sigue estos pasos:

1. Crea la carpeta de certificados y genera unos de prueba. (Usa `sudo` para evitar problemas de permisos si Docker ya ha creado la carpeta):
```bash
sudo mkdir -p certs
sudo openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes
sudo chown -R $USER:$USER certs
```

2. Edita tu archivo `.env` para activar la opción:
```env
USE_HTTPS=true
```

3. Reinicia tu servidor (`docker compose down && docker compose up -d`).

Acceso: `http://localhost:5000` (o `https://localhost:5000` si habilitaste SSL).



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

---

## 🌐 Acceso Remoto Seguro (Opcional)

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

> 💡 **Soporte Multiusuario:** Gracias al aislamiento nativo de datos del motor, puedes compartir el nodo de tu servidor (mediante la función *Node Sharing* de Tailscale) o invitar a otros colaboradores a tu Tailnet para que registren sus propias cuentas.

---

## Módulos y Vistas

### Login
Al ingresar, el sistema solicita autenticación a través de una pantalla de acceso segura.

### Vista de Dashboard
Una vez autenticado, se accede al **Panel de Control principal (Dashboard)**. Este menú dinámico organiza los módulos habilitados, proporcionando acceso directo a los servicios locales.

### Asistente IA (Nexus AI)

* **Integración Local con Ollama:** Conexión directa a modelos de lenguaje locales (por ejemplo, TinyLLama).
* **Procesamiento de Archivos:** Soporte completo para adjuntar imágenes y documentos con previsualización en miniatura (*file chips*).
* **Renderizado Avanzado:** Renderizado offline de Markdown e iluminación de sintaxis en bloques de código de forma fluida.
* **Historial Completo:** Guardado persistente de chats individuales por usuario en el sistema.

### Chat local

* **Tiempo Real Síncrono:** Comunicación instantánea bidireccional mediante **Socket.IO**.
* **Micro-indicadores UX:** Indicador en tiempo real cuando un usuario está escribiendo y estado de conexión ("Online").
* **Sincronización Multipespaña:** Sincronización automática de lecturas y estados de chat en múltiples pestañas abiertas en el mismo navegador.

### Null-Void Cloud

* **Gestor de Archivos Moderno:** Interfaz interactiva de arrastrar y soltar (*drag & drop*), subidas múltiples, descargas y navegación de carpetas.
* **Sincronización Local:** Vinculación bidireccional con directorios locales mediante un agente asíncrono seguro (CLI) y la File System Access API nativa del navegador.

### Calendario de Eventos

* **Planificación Interactiva:** Vistas mensuales, semanales y diarias fluidas para organizar y hacer un seguimiento visual de tus tareas y compromisos.
* **Gestión de Eventos Completa:** Creación rápida de actividades, personalización de colores, descripción y categorización en tiempo real.
* **Importación y Exportación:** Compatibilidad nativa para importar y exportar calendarios completos en formatos universales (JSON/ICS) para integración externa.
* **Sistema de Notificaciones Integrado:** Alertas visuales locales y recordatorios automáticos de eventos próximos.