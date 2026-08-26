# CODEBASE ARCHITECTURE & DEAD CODE AUDIT

## Executive Summary

The Null-Void-Engine is a self-hosted, local-first platform built on Flask+SQLite with a monolithic Python backend serving 17 blueprints and 35+ database tables. The four active modules (AI, Cloud, Mail, Mail, Calendar) form a reasonable core, but the codebase carries significant legacy weight from iterative AI-assisted development. The most critical architectural issues are: (1) the `cloud/services.py` mega-file (3821 lines) is imported by 7+ modules creating dangerous coupling, (2) three independent `search_users` implementations exist across modules, (3) the `core/launcher/` module is entirely dead code, (4) scraper SocketIO events have no authentication, and (5) AI API keys are stored unencrypted in the database. The testing coverage is uneven — AI and Cloud are well-tested (~20 test files combined), while Auth, Calendar, Mail, Friends, Chat, and Transactions have zero tests. The codebase is at a "partially structured" state with enough architectural debt to warrant a focused cleanup pass before any freeze.

## Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    USER (Browser / Mobile)                    │
│  Server-rendered HTML + Vanilla JS modules + Socket.IO       │
└────────┬──────────────────────────────────────┬─────────────┘
         │ REST (fetch + token cookie)           │ WebSocket
         ▼                                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Flask Backend (app.py)                     │
│  17 Blueprints + 15 direct routes + 2 middleware hooks       │
│  Gevent + Gunicorn + Flask-SocketIO                          │
└────────┬─────────────────────────────────────────────────────┘
         │
    ┌────┴──────────────────────────────────────────────────┐
    │                                                        │
    ▼                                                        ▼
┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────────┐
│  AI Module   │  │ Cloud Module │  │   Mail   │  │   Calendar   │
│  (2600+ LOC) │  │ (5100+ LOC)  │  │ (1200+   │  │   (235+ LOC) │
│              │  │              │  │  LOC)    │  │              │
└──────┬───────┘  └──────┬───────┘  └────┬─────┘  └──────┬───────┘
       │                 │                │                │
       │  AI->Cloud deps │                │                │
       ├────────────────►│                │                │
       │                 │                │                │
       │  AI->Calendar   │                │                │
       ├─────────────────────────────────►│                │
       │                 │                │                │
    ┌──┴─────────────────┴────────────────┴────────────────┴──┐
    │              Shared Infrastructure                       │
    │  session.py | database.py | schema.py | socket_ext.py   │
    │  crypto_utils.py | notifications.py | limiter.py        │
    └────────────────────────────┬────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────┐
                    │  SQLite (manager.db)│
                    │  35+ tables, WAL   │
                    │  Triggers, FKs     │
                    └────────────────────┘
```

## Active Modules

### AI Module — STATUS: ACTIVE

| Component | Path | Status | Evidence |
|---|---|---|---|
| `routes.py` (696 lines) | `modules/api/ai/routes.py` | ACTIVE | 28 REST + 3 SocketIO handlers, registered as `ai_bp` |
| `services.py` (82 lines) | `modules/api/ai/services.py` | ACTIVE | Re-export facade, imports from all submodules |
| `repository.py` (854 lines) | `modules/api/ai/repository.py` | ACTIVE | 30+ DB functions, 4 migrations (101-104) |
| `crypto.py` (62 lines) | `modules/api/ai/crypto.py` | ACTIVE | Fernet encryption for API keys |
| `core/orchestrator.py` (1324 lines) | `modules/api/ai/core/orchestrator.py` | ACTIVE | Main `stream_chat()` — the core AI function |
| `core/concurrency.py` (175 lines) | `modules/api/ai/core/concurrency.py` | ACTIVE | Generation queue, rate limiting, validation |
| `core/models.py` (431 lines) | `modules/api/ai/core/models.py` | ACTIVE | Provider registry (6 providers), catalog management |
| `core/container.py` (194 lines) | `modules/api/ai/core/container.py` | ACTIVE | Ollama Docker container lifecycle |
| `clients/ollama.py` | `modules/api/ai/clients/ollama.py` | ACTIVE | Ollama HTTP client |
| `clients/external.py` | `modules/api/ai/clients/external.py` | ACTIVE | OpenAI-compatible API client with streaming |
| `security/privacy.py` (579 lines) | `modules/api/ai/security/privacy.py` | ACTIVE | PII masking gateway (DNI, IBAN, NER) |
| `web_search/` (2 files) | `modules/api/ai/web_search/` | ACTIVE | DuckDuckGo search + web scraping |
| `agenda/tools.py` (1123 lines) | `modules/api/ai/agenda/tools.py` | ACTIVE | 6 calendar tools, prompt engineering, fuzzy parsing |
| `agenda/router.py` (422 lines) | `modules/api/ai/agenda/router.py` | ACTIVE | FastText + spaCy intent detection |
| `workspaces/` (4 files) | `modules/api/ai/workspaces/` | ACTIVE | Workspace CRUD, file management |
| `notes.js` (534 lines) | `static/js/ai/notes.js` | ACTIVE | Notes editor with collaboration |
| `workspace.js` (761 lines) | `static/js/ai/workspace.js` | ACTIVE | Workspace UI |
| `chat.js` | `static/js/ai/chat.js` | ACTIVE | Chat interface |
| `orchestrator.py` stream_chat | `modules/api/ai/core/orchestrator.py:423` | ACTIVE | 900-line orchestration function |

### Cloud Module — STATUS: ACTIVE

| Component | Path | Status | Evidence |
|---|---|---|---|
| `routes.py` (886 lines) | `modules/api/cloud/routes.py` | ACTIVE | 45 REST endpoints, registered as `cloud_bp` |
| `services.py` (3821 lines) | `modules/api/cloud/services.py` | ACTIVE | Monolith: file ops, video, AI storage, search, sharing, zip |
| `repository.py` (401 lines) | `modules/api/cloud/repository.py` | ACTIVE | Sharing, quota, AI attachment metadata |
| `sync_agent.py` (915 lines) | `sync_agent/sync_agent.py` | ACTIVE | Desktop sync protocol, embedded agent script |
| `cloud.js` (5300+ lines) | `static/js/cloud/cloud.js` | ACTIVE | Full file manager UI |
| `cloud.html` (3404 lines) | `templates/modules/cloud.html` | ACTIVE | File manager template |

### Mail Module — STATUS: ACTIVE

| Component | Path | Status | Evidence |
|---|---|---|---|
| `routes.py` (244 lines) | `modules/api/mail/routes.py` | ACTIVE | 9 REST endpoints, registered as `mail_bp` |
| `services.py` (602 lines) | `modules/api/mail/services.py` | ACTIVE | IMAP/SMTP, dual-mode (internal+Google) |
| `repository.py` (217 lines) | `modules/api/mail/repository.py` | ACTIVE | Email CRUD, attachment storage |
| `connector.py` (195 lines) | `modules/api/mail/connector.py` | ACTIVE | IMAP/SMTP protocol adapter |
| `mail.js` (1142 lines) | `static/js/mail/mail.js` | ACTIVE | Full email client UI |
| `mail_scheduler.py` (123 lines) | `core/mail_scheduler.py` | ACTIVE | Background scheduled send thread |

### Calendar Module — STATUS: ACTIVE

| Component | Path | Status | Evidence |
|---|---|---|---|
| `routes.py` (122 lines) | `modules/api/events/routes.py` | ACTIVE | 5 REST endpoints, registered as `events_bp` |
| `services.py` (113 lines) | `modules/api/events/services.py` | ACTIVE | Event CRUD + series support |
| `calendar.js` (435 lines) | `static/js/calendar/calendar.js` | ACTIVE | Month/week/day rendering |
| `app.js` (731 lines) | `static/js/calendar/app.js` | ACTIVE | Navigation, CRUD, drag-drop |
| `ui.js` (857 lines) | `static/js/calendar/ui.js` | ACTIVE | Quick popup, modals, detail view |
| `events.js` (165 lines) | `static/js/calendar/events.js` | ACTIVE | Event model + queries |
| `storage.js` (250 lines) | `static/js/calendar/storage.js` | ACTIVE | localStorage + API sync |

## Dead Code Candidates

| Item | Path | Status | Evidence |
|---|---|---|---|
| **`backup/services.py`** | `modules/api/backup/services.py` | DEAD FILE | Never imported; defines non-existent `verify_owner()`. `__init__.py` imports from `routes` instead. |
| **`modules/users.py`** | `modules/users.py` | DEAD FILE | `load_users()` never called from anywhere in the codebase. |
| **`core/launcher/`** | `core/launcher/panel_service.py`, `__init__.py` | DEAD MODULE | `ModuleRegistry` and all functions never imported outside this module. |
| **`core/telemetry/emitter.py`** | `core/telemetry/emitter.py` | DEAD CODE | `TelemetryEmitter`, `init_emitter()`, `get_emitter()` never called. Collector is used instead. |
| **`collector.get_snapshot()`** | `core/telemetry/collector.py:229` | DEAD FUNCTION | Only `get_snapshot_with_hist()` is used externally. |
| **`CONFIG_PATH`** | `modules/api/cloud/services.py:32` | DEAD CONSTANT | Defined but never read or written. |
| **`import glob`** | `modules/api/cloud/routes.py:3` | DEAD IMPORT | Never referenced in the file. |
| **`after_this_request`** | `modules/api/cloud/services.py:22` | DEAD IMPORT | Imported from Flask but never called. |
| **`search_users_db`** | `modules/api/cloud/repository.py:26` | ORPHANED FUNCTION | Cloud's `search_users` route uses `friends_repo.get_friends()` instead. |
| **`get_user_contacts`** | `modules/api/cloud/repository.py:35` | ORPHANED FUNCTION | Cloud contacts routes use `friends_repo.get_friends()`. |
| **`get_file_shares`** | `modules/api/cloud/repository.py:112` | DEAD FUNCTION | `get_shares_in_path` is used instead. |
| **`delete_ai_attachment`** | `modules/api/cloud/repository.py:361` | DEAD FUNCTION | `delete_ai_attachments_by_ids` is used instead. |
| **`remove_friendship`** (line 117) | `modules/api/friends/repository.py:117` | DEAD OVERRIDE | Defined twice; second definition (line 169) silently overrides. |
| **`remove_friend`** (line 104) | `modules/api/friends/services.py:104` | DEAD OVERRIDE | Defined twice; second definition (line 123) silently overrides. |
| **`import platform`** | `app.py:30` | DEAD IMPORT | Never referenced. |
| **`import subprocess`** | `app.py:31` | DEAD IMPORT | Never referenced. |
| **`from datetime import datetime`** | `app.py:33` | DEAD IMPORT | Never referenced. |
| **`abort`** | `app.py:34` | DEAD IMPORT | Never called. |
| **`Limiter`** | `app.py:35` | DEAD IMPORT | Instance comes from `core.limiter`. |
| **`get_remote_address`** | `app.py:36` | DEAD IMPORT | Never referenced. |
| **Mail compose buttons** | `templates/modules/mail.html:184,228,383-412` | DEAD UI | "Mover a", format, link, emoji buttons have no handlers. |
| **`notifications.js` `checkUpcomingEvents()`** | `static/js/calendar/notifications.js:34` | DEPRECATED | Explicitly marked as delegated to backend. |
| **`parse_ai_events()`** | `modules/api/events/routes.py:66-121` | REDUNDANT | Duplicates AI agenda tools with less robustness. |
| **SMTP fallback branch** | `modules/api/mail/connector.py:175-176` | UNREACHABLE | `use_alias` is always True due to env var defaults. |
| **`total_raw` debug info** | `modules/api/mail/services.py:236` | SHOULDN'T EXIST | Debug data exposed in production API response. |

## Duplicate Implementations

### 1. `search_users` — THREE implementations

| Location | Function | SQL |
|---|---|---|
| `friends/repository.py:129` | `search_users(query, exclude_id)` | `SELECT user_id, username FROM users WHERE username LIKE ? AND user_id != ?` |
| `chat/repository.py:321` | `search_users_db(query, exclude_id)` | `SELECT user_id, username FROM users WHERE username LIKE ? AND user_id != ?` |
| `cloud/repository.py:26` | `search_users_db(query, exclude_uid)` | `SELECT user_id, username FROM users WHERE username LIKE ? AND user_id != ?` |

All three perform the identical query. Should be consolidated into `core/` or `modules/users.py`.

### 2. `_get_uid()` / `_get_user()` — MULTIPLE implementations

| Location | Function |
|---|---|
| `ai/routes.py:12-21` | `_get_uid()`, `_get_user()` |
| `ai/workspaces/routes.py:15-24` | `_get_uid()`, `_get_user()` (identical) |
| `mail/routes.py:9-16` | `_get_uid()`, `_get_user()` |
| `invoices/routes.py:8-10` | `_get_uid()` |
| `spreadsheet/routes.py:8-10` | `_get_uid()` |
| `chat/routes.py:23-33` | `@login_required` decorator |

Each module reimplements the same token-extraction + session-validation pattern.

### 3. Encryption systems — TWO implementations

| System | File | Algorithm | Prefix |
|---|---|---|---|
| `encrypt_field`/`decrypt_field` | `core/crypto_utils.py` | AES-256-GCM, PBKDF2 | `nv1$` |
| `encrypt_api_key`/`decrypt_api_key` | `modules/api/ai/crypto.py` | Fernet (AES-128-CBC), env key | `nv2$` |

Both encrypt at-rest secrets but use different algorithms and key derivation.

### 4. Telemetry — TWO systems

| System | File | Status |
|---|---|---|
| `collector.py` (polling) | `core/telemetry/collector.py` | ACTIVE — used by `modules/api/metrics/services.py` |
| `emitter.py` (push) | `core/telemetry/emitter.py` | DEAD — never called |

### 5. Calendar AI integration — TWO paths

| Path | Location | Purpose |
|---|---|---|
| `parse_ai_events()` | `modules/api/events/routes.py:66-121` | Standalone Ollama call with basic prompt |
| `ai/agenda/tools.py` | `modules/api/ai/agenda/tools.py` | Full tool system with fuzzy matching, series linking, categories |

Both extract calendar events from text, but the agenda tools are far more robust.

### 6. `ensure_table()` pattern — LEGACY

`friends/repository.py` calls `ensure_table()` before every query (8 call sites). This predates the centralized `core/schema.py` migration system and is unnecessary.

## Architecture Boundary Violations

| Severity | From | To | File:Line | Issue |
|---|---|---|---|---|
| **HIGH** | `core` | `modules.api.cloud` | `core/backup.py:911` | `from modules.api.cloud.services import BASE_CLOUD_ROOT` — core layer imports API layer |
| **HIGH** | `core` | `modules.api.ai` | `core/schema.py:1012` | `from modules.api.ai.repository` — schema imports AI module |
| **HIGH** | `core` | `modules.api.mail` | `core/mail_scheduler.py:71,88` | Lazy imports of mail connector — core depends on API |
| **MEDIUM** | `modules.api.auth` | `modules.api.cloud` | `auth/services.py:5` | `from modules.api.cloud import init_user_cloud` |
| **MEDIUM** | `modules.api.invoices` | `modules.api.cloud` | `invoices/services.py:6` | `from modules.api.cloud import get_view_root` |
| **MEDIUM** | `modules.api.chat` | `modules.api.cloud` | `chat/routes.py:117,259,550` | Lazy imports of cloud services |
| **MEDIUM** | `modules.api.cloud` | `modules.api.invoices` | `cloud/services.py:1233` | `from modules.api.invoices.services import organize_uploaded_pdf` |
| **MEDIUM** | `modules.api.cloud` | `modules.api.friends` | `cloud/routes.py:625,642` | Lazy import of friends repository |
| **LOW** | `modules.api.ai` | `modules.api.cloud` | `ai/routes.py:224,264,...` (9 sites) | Lazy imports of cloud services — this is the intended pattern |
| **LOW** | `modules.api.ai` | `modules.api.events` | `ai/agenda/tools.py:11` | `from modules.api.events.services import ...` — direct service import |

**Most Critical Issue**: The Cloud module is imported by 7+ modules for both constants (`BASE_CLOUD_ROOT`) and functions (`get_view_root`, `ai_save_file`, etc.). Changing Cloud internals risks breaking AI, Chat, Auth, Invoices, Backup, and System modules.

## AI Audit

### Architecture Assessment

The AI module has a layered structure:
```
routes.py (HTTP) → orchestrator.py (logic) → clients/ (providers) → models.py (catalog)
                                                       ↓
                                               agenda/tools.py (calendar CRUD)
                                               web_search/ (DuckDuckGo)
                                               security/privacy.py (PII masking)
```

### Strengths
- Clean separation: orchestrator handles flow, clients handle protocols, tools handle domain actions
- PII masking gateway before external API calls (579 lines of robust regex + spaCy NER)
- Multi-provider support (6 providers in `PROVIDER_REGISTRY`)
- Tool execution loop with deduplication and 2-round max
- Comprehensive concurrency control (FIFO queue, rate limiting)

### Issues
1. **`stream_chat()` is 900 lines** — handles 10+ concerns in a single function (lines 423-1324 in `orchestrator.py`)
2. **Multiple tool execution paths**: Native function calls, text-based tool calls, `extract_text_tool_calls()` regex, `has_tool_attempt()` detection — competing architectures in the same function
3. **AI API keys stored unencrypted** — `ai_api_keys.api_key` is plaintext (schema.py:408), unlike Gmail passwords which use AES-256-GCM
4. **`services.py` leaks implementation details** — re-exports `CANCELED_GENS`, `ACTIVE_GENERATIONS`, `_gen_active`, private functions with underscore prefix
5. **Global mutable state** — `ACTIVE_NOTE_USERS`, `SID_TO_USER` dicts in `routes.py:486-487` are not process-safe
6. **Hardcoded fallback** — `_resolve_requested_model()` falls back to `"llama3"` (models.py:323)
7. **`_docker_api()` bypasses Docker SDK** — raw HTTP over Unix socket (container.py:29)

## Cloud Audit

### Strengths
- Content-addressed storage with SHA-256 dedup (pool)
- File versioning via hardlinks (zero extra disk space)
- Chunked resumable uploads (TUS-like)
- Streaming ZIP generation
- FTS5 content search with background indexing
- Comprehensive security (path traversal, Zip Bomb, Zip Slip, IDOR)

### Issues
1. **`services.py` is 3821 lines** — covers file ops, video transcoding, AI attachments, search, sharing, zip/unzip, quota. This is a monolith that should be decomposed.
2. **Dual metadata storage** — JSON files (`.starred.json`, `.trash.json`, `.activity.json`) + SQLite for sharing/quota. Two sources of truth.
3. **Direct SQL in routes.py** — `get_user_from_token()` at line 24-32 bypasses the repository layer.
4. **Embedded agent script** — 470+ lines of Python/HTML/CSS/JS as a string literal in `sync_agent.py:442-910`. Unmaintainable.
5. **`CONFIG_PATH` dead constant** — line 32, never used.
6. **`import glob` dead import** — routes.py:3.

## Mail Audit

### Strengths
- Dual-mode architecture (internal + Google/IMAP)
- Encrypted credential storage (AES-256-GCM)
- Trigger-based mail stats (no manual counter updates)
- Clean separation: connector (protocol) → services (logic) → repository (data)

### Issues
1. **IMAP server hardcoded to Gmail** — `connector.py:12` (`imap.gmail.com`), unlike SMTP which is configurable
2. **CC/BCC fields non-functional** — UI exists but data never sent to API
3. **Search bar is decorative** — no backend endpoint
4. **"Mover a" buttons have no handlers** — mail.html:184,228
5. **No connection pooling** — new IMAP session per operation
6. **Scheduled Google emails deleted instead of moved to sent** — `mail_scheduler.py:116`
7. **Legacy credential fallback** — `connector.py:88-94` and `services.py:582-585` query old `users.gmail_*` columns
8. **Bare `except:`** — `services.py:159` catches SystemExit/KeyboardInterrupt
9. **`total_raw` debug info** — `services.py:236` exposes internal data in API response

## Calendar Audit

### Strengths
- Clean CRUD layer: `routes.py` → `services.py` → SQLite. No HTTP awareness in services.
- AI agenda system is comprehensive: intent detection (FastText + spaCy + regex), 6 tools, fuzzy matching, series linking.
- Offline-first frontend with localStorage + API sync + BroadcastChannel cross-tab sync.

### Issues
1. **`parse_ai_events()` duplicates AI agenda** — routes.py:66-121 is a simpler, less robust reimplementation of what `agenda/tools.py` already provides
2. **No external calendar integrations** — zero references to Google Calendar, iCal, CalDAV
3. **Reminders field is data-only** — stored but no backend consumer fires notifications from it
4. **`notifications.js` is partially dead** — `checkUpcomingEvents()` is deprecated
5. **Circular import** — `storage.js` ↔ `events.js` (works but is a design smell)
6. **No tests** — zero test coverage for events module

## Shared Infrastructure

| Component | File | Status | Issues |
|---|---|---|---|
| Session management | `modules/session.py` (412 lines) | ACTIVE | Single active session per user, 24h timeout, tab locking, brute-force protection. Solid. |
| Database | `core/database.py` (163 lines) | ACTIVE | No connection pooling (new conn per call). WAL mode, FK enforcement. |
| Schema | `core/schema.py` (1098 lines) | ACTIVE | 35+ tables, 18 indexes, 10 triggers, 4 migrations. Comprehensive. |
| Crypto | `core/crypto_utils.py` (154 lines) | ACTIVE | AES-256-GCM, PBKDF2. Clean. |
| SocketIO | `core/socket_ext.py` (3 lines) | ACTIVE | Single global instance. Clean. |
| Rate limiting | `core/limiter.py` (19 lines) | ACTIVE | In-memory only (per-worker). No multi-worker support. |
| Notifications | `core/notifications.py` (420 lines) | ACTIVE | Multi-channel (OS/WebPush/FCM/Telegram). |
| Mail scheduler | `core/mail_scheduler.py` (123 lines) | ACTIVE | Background thread, 60s polling. |
| Backup | `core/backup.py` (968 lines) | ACTIVE | Full/differential/incremental, streaming ZIP, anti-DoS. |
| Telemetry | `core/telemetry/collector.py` (295 lines) | ACTIVE | System metrics only (CPU/RAM/temp). Not application-level observability. |
| Config | `config/config.py` (133 lines) | ACTIVE | `.env` + file-based key persistence. |

**Centralization gap**: Auth helpers (`_get_uid()`) are duplicated 8+ times across modules. `search_users` is tripled. There is no shared HTTP client utility (raw `requests` in 14 locations).

## Security

| Finding | Severity | Location | Evidence |
|---|---|---|---|
| Scraper SocketIO has NO auth | **HIGH** | `scraper/socket_events.py:10-19` | Any client can read/modify/broadcast scraper state |
| AI API keys stored unencrypted | **MEDIUM** | `schema.py:408` | `api_key TEXT NOT NULL` — no encryption unlike Gmail passwords |
| Rate limiting per-worker only | **MEDIUM** | `limiter.py:17` | In-memory storage, multiplied by worker count |
| No DB connection pooling | **MEDIUM** | `database.py:73` | New SQLite connection per call |
| Cloud mega-dependency | **MEDIUM** | 7+ modules import cloud.services | Tight coupling, circular import risk |
| Admin check uses username string | **LOW** | `system/routes.py:339` | `sess.get_user(token) != 'admin'` instead of role column |
| Avatar endpoint unauthenticated | **LOW** | `system/routes.py:214-235` | Serves user existence info |
| AI crypto fallback key | **LOW** | `ai/crypto.py:33` | `"null-void-dev-fallback-key"` if env not set |
| PowerShell injection risk | **LOW** | `notifications.py:334-353` | Event titles interpolated into PS commands |

## Testing

### Test Coverage by Module

| Module | Test Files | Coverage |
|---|---|---|
| AI | 12 files | **Good** — API keys, attachments, streaming, tools, OpenRouter, privacy, storage |
| Cloud | 12 files | **Good** — paths, upload, chunks, download, sharing, versions, search, zip |
| Database | 4 files | **Good** — constraints, integrity, triggers, types |
| Backup | 2 files | **Good** — core + stream |
| Crypto | 1 file | **Good** — field encryption roundtrip |
| Auth | 0 files | **None** |
| Calendar | 0 files | **None** |
| Mail | 0 files | **None** |
| Chat | 0 files | **None** |
| Friends | 0 files | **None** |
| Transactions | 0 files | **None** |
| Settings | 0 files | **None** |
| System/Admin | 0 files | **None** |
| Vault | 0 files | **None** |
| Scraper routes | 0 files | **None** (1 boot test only) |
| Notifications | 1 file | **Minimal** — ID stability only |

**No integration tests for AI→Tool→Calendar flow.** No browser/E2E tests. No coverage configuration.

## Observability

| Aspect | Status | Evidence |
|---|---|---|
| Logging | **Fragmented** | `logging.basicConfig()` called 3 times with different levels; most code uses `print()` |
| Structured logs | **None** | No JSON formatting, no log fields |
| Request tracing | **None** | No request IDs, no correlation IDs |
| Error aggregation | **None** | No Sentry, no centralized error tracking |
| Metrics | **System-level only** | CPU/RAM/temp via `psutil`. No app-level metrics (latency, error rate, throughput) |
| AI audit log | **File-based** | `logs/ai_conversations_audit.txt` — full message pairs, no rotation |
| Telemetry | **Polling only** | Collector polls system metrics; emitter (push) is dead code |

## Archive Candidates

| Candidate | Path | Category | Reason |
|---|---|---|---|
| `core/launcher/` | `core/launcher/` | EXPERIMENT | Module registry system never adopted |
| `core/telemetry/emitter.py` | `core/telemetry/emitter.py` | REPLACED | Push-based telemetry replaced by polling collector |
| `modules/users.py` | `modules/users.py` | LEGACY | Superseded by direct DB queries |
| `backup/services.py` | `modules/api/backup/services.py` | REPLACED | Old backup routes replaced by `routes.py` |
| `scraper_service/` | `scraper_service/` | UNCERTAIN | Active microservice but may not be in active product scope |
| `client_agent/` | `client_agent/` | UNCERTAIN | Desktop sync agent — active code but uncertain product direction |
| `null-void-app/` | `null-void-app/` | UNCERTAIN | Android wrapper — thin shell, unclear product priority |
| Dashboard `legacy_inline.js` | `static/js/dashboard/legacy_inline.js` | LEGACY | Extracted from inline template code |

## Refactoring Candidates

### P0 — Must fix before architectural freeze
1. **Scraper SocketIO auth** — `scraper/socket_events.py:10-19` has zero auth. Any connected user can manipulate scraper state. Add session validation.

### P1 — Strongly recommended
2. **Extract shared auth helpers** — Create `core/auth.py` with `get_uid()`, `get_user()`, `login_required` decorator. Eliminate 8+ duplicate implementations.
3. **Extract shared `search_users`** — Move to `core/` or `modules/users.py`. Eliminate triple implementation.
4. **Encrypt AI API keys** — Use `crypto_utils.encrypt_field()` for `ai_api_keys.api_key` (same as Gmail passwords).
5. **Decompose `cloud/services.py`** — Extract into `cloud/files.py`, `cloud/video.py`, `cloud/ai_storage.py`, `cloud/search.py`, `cloud/sharing.py`.

### P2 — Useful but optional
6. **Consolidate encryption** — Unify `nv1$` (AES-256-GCM) and `nv2$` (Fernet) into one system.
7. **Remove dead code** — `backup/services.py`, `modules/users.py`, `core/launcher/`, `emitter.py`, unused functions in `cloud/repository.py`.
8. **Fix Calendar `parse_ai_events()`** — Delegate to `agenda/tools.py` to eliminate duplication.
9. **Mail: IMAP server configurable** — Allow non-Gmail providers via env var.
10. **Mail: Implement CC/BCC** — Data is collected in UI but never sent.

### P3 — Cosmetic / not worth now
11. Fix unused imports in `app.py` (7 imports)
12. Fix `from src.config.config` inconsistencies in settings and cloud
13. Remove `import glob` from cloud/routes.py
14. Remove redundant `import requests` inside functions in scraper/routes.py

## DO NOT TOUCH YET

| Component | Path | Reason |
|---|---|---|
| `core/orchestrator.py` `stream_chat()` | `modules/api/ai/core/orchestrator.py:423` | 900-line function is complex but functional; refactoring risks breaking the AI pipeline without comprehensive tests |
| `ai/agenda/tools.py` | `modules/api/ai/agenda/tools.py` | 1123 lines of carefully tuned prompt engineering, fuzzy matching, and error handling; high regression risk |
| `ai/security/privacy.py` | `modules/api/ai/security/privacy.py` | 579 lines of PII masking with NER; security-critical; requires specialized testing to modify |
| `core/schema.py` migrations | `core/schema.py:997-1014` | Migration system works; touching risks data loss |
| `sync_agent.py` embedded script | `sync_agent/sync_agent.py:442-910` | 470 lines of embedded Python/HTML; hard to maintain but functional; replacement planned via `client_agent/` |
| `scraper_service/` | `scraper_service/` | Product direction uncertain; don't remove until confirmed unnecessary |
| `client_agent/` | `client_agent/` | Active code with TLS pinning, but product scope TBD |
| `null-void-app/` | `null-void-app/` | Android wrapper; product priority unclear |
| `core/notifications.py` Windows PS injection | `core/notifications.py:334-353` | Low risk but complex fix; monitor rather than refactor now |
| `ai/services.py` re-exports | `modules/api/ai/services.py` | Facade pattern used by multiple callers; change would cascade |

## Priority Plan

1. **Fix scraper auth bypass** — Add session validation to `scraper/socket_events.py` (15 min, HIGH impact)
2. **Encrypt AI API keys** — Apply `encrypt_field()` to `ai_api_keys.api_key` with migration (1-2 hours, MEDIUM impact)
3. **Extract shared auth helpers** — Create `core/auth.py` with `get_uid()`, `get_user()`, `login_required` (2-3 hours, HIGH impact on maintainability)
4. **Remove confirmed dead code** — `backup/services.py`, `modules/users.py`, `core/launcher/`, `telemetry/emitter.py` (30 min, LOW risk)
5. **Decompose `cloud/services.py`** — Split into focused submodules (4-6 hours, HIGH impact on maintainability)

## Architectural Freeze Readiness

| Area | Score (0-5) | Explanation |
|---|---|---|
| **AI** | 3 | Well-structured with clear layers (routes→orchestrator→clients→tools), but `stream_chat()` is a 900-line monolith and API keys are unencrypted. |
| **Cloud** | 3 | Powerful and well-tested, but `services.py` is a 3821-line monolith imported by 7+ modules. Needs decomposition before freeze. |
| **Mail** | 2 | Functional but has dead UI buttons, non-functional CC/BCC, Gmail-only IMAP, and no tests. |
| **Calendar** | 3 | Clean CRUD layer, excellent AI agenda tools, but has duplicate `parse_ai_events()`, no external integrations, and zero tests. |
| **Shared infrastructure** | 3 | Session, database, schema are solid. But auth helpers are duplicated 8+ times, `search_users` is tripled, and there's no shared HTTP client. |
| **Security** | 2 | Scraper auth bypass is critical. AI API keys unencrypted. Otherwise solid (PII masking, path traversal, encryption). |
| **Testing** | 2 | AI and Cloud are well-tested. Auth, Calendar, Mail, Chat, Friends, Transactions have zero tests. No integration test for AI→Tool→Calendar. |
| **Observability** | 1 | No structured logging, no request tracing, no error aggregation, no app-level metrics. Only system-level telemetry. |
| **Overall** | **2** | Partially structured. Major cleanup needed in 5 areas before freeze is viable. |

**What remains before freeze:**
1. Fix the scraper auth bypass (security)
2. Encrypt AI API keys (security)
3. Extract shared auth helpers (architecture)
4. Remove confirmed dead code (clarity)
5. Decompose `cloud/services.py` (architecture)
6. Add tests for Calendar and Mail (reliability)
7. Add minimal structured logging (observability)
