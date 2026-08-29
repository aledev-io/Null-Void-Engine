# Null-Void Engine

Local-first self-hosted service for system resource monitoring, private file storage, password management, automated backups, and local AI assistance.

---

## <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Quick Start

Start the environment with Docker Compose:

```bash
# 1. Clone the repository
git clone https://github.com/aledev-io/Null-Void-Engine.git
cd Null-Void-Engine

# 2. Configure environment variables
cp .env.example .env

# 3. Build and start the core services (engine + Ollama)
docker compose up --build -d

# (Optional) Also start the web scraper microservice
docker compose --profile scraper up -d
```

* **Web interface:** `http://localhost:5000` (or `https://localhost:5000` if TLS is enabled)
* **Default credentials:** `admin` / `admin`

> **Security Notice:** Change the default credentials in `.env` (`CREDENTIALS`) before exposing the service to a network.

---

## <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> Components & Services

The repository contains the following core and auxiliary components:

* **Main Backend (`services/null-void-service`):** Flask application providing REST APIs, authentication, SQLite persistence (`manager.db`), WebSocket event streaming, and static web assets. Listens on port `5000`.
* **AI Assistant:** Integrated AI client supporting local Ollama models and external AI providers, with provider credentials stored securely per user.
* **Null-Void Cloud:** Private file storage module supporting document previews (PDF.js), media streaming, and on-demand video transcoding (FFmpeg).
* **Vault:** Password and credentials manager implementing client-side AES-256-GCM encryption with automated `.bak` backup rotation.
* **Telemetry:** Hardware and system monitoring collector (CPU, RAM, storage, network) streamed via WebSockets.
* **Sync Agent (`apps/client_agent`):** Desktop synchronization client written in Python (PySide6 / Qt6) for continuous bi-directional directory sync.
* **Mobile Client (`apps/null-void-app`):** Android application built with Capacitor for remote access and push notification handling.
* **Web Scraper (`services/scraper_service`):** Auxiliary Flask microservice using Playwright for automated background web scraping. Listens on port `5001`.

* **Notifications:** Notification dispatcher supporting WebPush (browser Service Workers) and Firebase Cloud Messaging (FCM).

---

## <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg> Docker Deployment

```bash
# Start core services in the background
docker compose up --build -d

# View live logs
docker compose logs -f

# Stop core services
docker compose down
```

> **Note:** `docker compose up -d` starts `nullvoid-engine` and `ollama` only. The web scraper (`nullvoid-scraper`) is **optional** and is **not** part of the normal startup: it is declared with `profiles: ["scraper"]` in `docker-compose.yml` and must be started explicitly:

```bash
# Start the optional web scraper microservice (in addition to core services)
docker compose --profile scraper up -d

# Stop all services including the scraper
docker compose --profile scraper down
```

---

## <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Configuration & Storage

Copy and configure the [.env.example](.env.example) template file to `.env`. Complete configuration options, optional services, and advanced settings are documented directly inside [.env.example](.env.example).

Primary environment variables:

```env
CREDENTIALS=admin:admin
SECRET_KEY=
HOST=0.0.0.0
FLASK_PORT=5000
DEBUG=false
SERVER_NAME=NullVoid
USE_HTTPS=false
DATA_HOST_DIR=/home/user/Null-Void-Data/app
SCRAPER_HOST_DIR=/home/user/Null-Void-Data/scraper
CERTS_HOST_DIR=/home/user/Null-Void-Data/certs
SECRETS_HOST_DIR=/home/user/Null-Void-Data/.secrets
```

### Persistent Storage Mapping
Persistent application data is mounted from the host filesystem into container directories:

```text
Host (Persistent Directory)           Container Destination
──────────────────────────────────    ─────────────────────
DATA_HOST_DIR                         → /app/data
SCRAPER_HOST_DIR                      → /app/scraper_data
CERTS_HOST_DIR                        → /app/certs
SECRETS_HOST_DIR                      → /app/.secrets
```

> **Note:** Cloud storage pooling is currently limited to storage locations on the same physical disk. Cross-disk storage pooling is not supported.

### Network Ports & External Dependencies
* **Port `5000` (HTTP/HTTPS & WebSockets):** Main application backend (`null-void-service`).

* **Port `5001` (HTTP):** Optional web scraper microservice (`scraper_service`). Available when started with the `scraper` Docker Compose profile.

* **Port `11434` (HTTP):** Local Ollama instance for local AI models.

---

## <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Secure Remote Access (Tailscale)

Connect to the server across private networks without port forwarding:

1. **Install Tailscale** on the host machine (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`).
2. **Connect client devices** to the same Tailnet.
3. **Access the interface** using the assigned Tailscale IP (`http://100.x.y.z:5000` or `https://100.x.y.z:5000`).

---

## <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Repository Structure

```text
Null-Void-Engine/
├── apps/
│   ├── client_agent/          # Desktop sync client (PySide6 / Qt)
│   └── null-void-app/         # Mobile Android client (Capacitor)
├── services/
│   ├── null-void-service/     # Main backend application (Flask / WebSockets)
│   └── scraper_service/       # Web scraping microservice (Flask / Playwright)
├── tests/                     # Automated test suite (pytest)
├── docs/                      # Technical architecture and audit reports
├── .agents/                   # Agent workflows and development configs
├── docker-compose.yml         # Container orchestration configuration
├── .env.example               # Environment variables template
├── LICENSE                    # Project license
└── README.md
```

---

## <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> Testing & Development

Run the backend test suite:

```bash
pytest tests/
```

Compile the desktop agent locally:

```bash
# Linux / macOS
bash apps/client_agent/compile.sh

# Windows
apps\client_agent\build_windows_agent.bat
```

---

## <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> License

Distributed under the MIT License. See [LICENSE](LICENSE) for more details.