import os
from flask import request, send_from_directory, redirect
from ui.session import session                  # Nuestro gestor de sesiones
from ui.api.auth    import auth_bp             # Blueprint para autenticación
from ui.api.metrics import metrics_bp          # Blueprint para métricas
from ui.api.backup  import backup_bp           # Blueprint para backup
from ui.api.system  import system_bp           # Blueprint para acciones de sistema

# ── Directorios base ───────────────────────────────
BASE_DIR   = os.path.dirname(os.path.dirname(__file__))  # Dos niveles arriba del archivo actual
ASSETS_DIR = os.path.join(BASE_DIR, "assets")           # Carpeta donde están los archivos estáticos


def register_routes(app):
    """Registra todas las rutas y blueprints en la aplicación Flask"""

    # ── Blueprints API ────────────────────────────────
    # Registramos cada módulo de la API en la app
    for bp in [auth_bp, metrics_bp, backup_bp, system_bp]:
        app.register_blueprint(bp)

    # ── Rutas estáticas: login ─────────────────────────
    @app.route("/")
    def index():
        token = request.cookies.get("token")
        if token and session.validate(token):
            # Usuario ya logueado → ir al dashboard
            return redirect("/app")
        # No logueado → servimos login
        return send_from_directory(os.path.join(ASSETS_DIR, "login"), "index.html")

    @app.route("/assets/login/<path:filename>")
    def login_assets(filename):
        # Servimos cualquier archivo estático del login (CSS, JS, imágenes)
        return send_from_directory(os.path.join(ASSETS_DIR, "login"), filename)

    @app.route("/assets/<path:filename>")
    def serve_asset(filename):
        # Servimos otros archivos estáticos generales
        return send_from_directory(ASSETS_DIR, filename)

    # ── Rutas estáticas: dashboard ─────────────────────
    @app.route("/app")
    def serve_app():
        token = request.cookies.get("token")
        if token and session.validate(token):
            return send_from_directory(os.path.join(ASSETS_DIR, "dashboard"), "index.html")
        # No válido → redirigir a login
        return redirect("/")
    
    @app.route("/assets/dashboard/<path:filename>")
    def dashboard_assets(filename):
        # Servimos archivos estáticos del dashboard (CSS, JS, imágenes)
        return send_from_directory(os.path.join(ASSETS_DIR, "dashboard"), filename)