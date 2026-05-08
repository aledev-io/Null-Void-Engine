import os
import sys
import json
import socket
import platform
import subprocess
from datetime import datetime
from flask import Flask, render_template, request, jsonify, abort, redirect, url_for

# Añadir el directorio actual al path para importar módulos locales
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from config.config import CONFIG
from core.database import init_db, get_db, row_to_dict, migrate_users_to_db, transaction_to_dict
from core.notifications import notifier
from ui.session import session as sess

# ── CONTROL DE INSTANCIA ÚNICA ──────────────────────────────
_instance_lock_socket = None

def check_single_instance():
    """Evita que la aplicación se ejecute más de una vez simultáneamente."""
    try:
        # Usamos un socket en un puerto específico como lock global
        # El puerto 47213 es arbitrario y se libera al cerrar el proceso
        global _instance_lock_socket
        _instance_lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _instance_lock_socket.bind(('127.0.0.1', 47213))
    except socket.error:
        # Si el puerto está ocupado, la app ya está corriendo
        system = platform.system()
        msg = "El servidor ya se encuentra en ejecución."
        title = "Manager - Error"
        
        if system == "Windows":
            # PowerShell Message Box (nativo de Windows)
            ps_cmd = f'[Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms"); [System.Windows.Forms.MessageBox]::Show("{msg}", "{title}")'
            subprocess.run(["powershell", "-Command", ps_cmd], capture_output=True)
        else:
            # Linux: Zenity para diálogo modal, fallback a notify-send
            try:
                subprocess.run(["zenity", "--info", "--title", title, "--text", msg, "--width=350"], capture_output=True)
            except:
                subprocess.run(["notify-send", "-i", "error", title, msg], capture_output=True)
        
        print(f"\n[!] ERROR: {msg}")
        os._exit(1)

# Ejecutar chequeo solo en el proceso principal (evita errores con el reloader de Flask)
if os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
    check_single_instance()

# Importar Blueprints (Módulos)
from ui.api.auth import auth_bp
from ui.api.events import events_bp
from ui.api.invoices import invoices_bp
from ui.api.spreadsheet import spreadsheet_bp
from ui.api.transactions import transactions_bp
from ui.api.metrics import metrics_bp
from ui.api.backup import backup_bp
from ui.api.system import system_bp
from ui.api.cloud import cloud_bp
from ui.api.settings import settings_bp

app = Flask(__name__)
app.secret_key = CONFIG.SECRET_KEY

# Registro de Blueprints
app.register_blueprint(auth_bp)
app.register_blueprint(events_bp)
app.register_blueprint(invoices_bp)
app.register_blueprint(spreadsheet_bp)
app.register_blueprint(transactions_bp)
app.register_blueprint(metrics_bp)
app.register_blueprint(backup_bp)
app.register_blueprint(system_bp)
app.register_blueprint(cloud_bp)
app.register_blueprint(settings_bp)

# ── INICIALIZACIÓN ──────────────────────────────────────────

# Crear carpeta de datos si no existe
os.makedirs(os.path.join(os.path.dirname(__file__), 'data'), exist_ok=True)

# Iniciar Base de Datos y Notificaciones
init_db()
migrate_users_to_db(CONFIG.CREDENTIALS)
notifier.start()

# ── SERVICIO DE ACTIVOS (ASSETS) ────────────────────────────
from flask import send_from_directory

@app.route('/assets/<path:path>')
def send_assets(path):
    return send_from_directory('assets', path)

# ── RUTAS DE VISTA (SSR) ────────────────────────────────────

@app.route('/')
def index():
    """Página de Login (Obligatoria)"""
    token = request.cookies.get('token')
    if sess.get_user(token):
        return redirect(url_for('dashboard'))
    return render_template('index.html')

@app.route('/app')
def dashboard():
    """Panel de Control Modular"""
    token = request.cookies.get('token')
    user = sess.get_user(token)
    if not user:
        return redirect(url_for('index'))
    return render_template('dashboard.html', user=user, token=token)

@app.route('/calendar')
def calendar():
    """Calendario SPA"""
    token = request.cookies.get('token')
    user = sess.get_user(token)
    if not user:
        return redirect(url_for('index'))
    return render_template('calendar.html', user=user, token=token)

# ── MANEJO DE ERRORES ───────────────────────────────────────

@app.errorhandler(401)
def unauthorized(e):
    return jsonify(error="No autorizado"), 401

@app.errorhandler(404)
def not_found(e):
    if request.path.startswith('/api/'):
        return jsonify(error="Recurso no encontrado"), 404
    return render_template('index.html'), 404

# ── MAIN ────────────────────────────────────────────────────

if __name__ == '__main__':
    # Configuración de puerto y host desde CONFIG
    port = CONFIG.FLASK_PORT
    host = CONFIG.HOST
    debug = CONFIG.DEBUG
    
    ssl_context = None
    if CONFIG.USE_HTTPS and os.path.exists(CONFIG.CERT_FILE) and os.path.exists(CONFIG.KEY_FILE):
        ssl_context = (CONFIG.CERT_FILE, CONFIG.KEY_FILE)
        print(f"--- Modo Seguro (HTTPS) Activado ---")
    
    print(f"--- Null-Void Engine v2.0 ---")
    print(f"Servidor iniciado en {'https' if ssl_context else 'http'}://{host}:{port}")
    
    app.run(host=host, port=port, debug=debug, ssl_context=ssl_context)