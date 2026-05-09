import os
import sys
import json
import socket
import platform
import subprocess
from datetime import datetime
from flask import Flask, render_template, request, jsonify, abort, redirect, url_for, send_from_directory

# Añadir el directorio actual al path para importar módulos locales
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from config.config import CONFIG
from core.database import init_db, get_db, row_to_dict, migrate_users_to_db, transaction_to_dict
from core.notifications import notifier
from ui.session import session as sess

# ── CONFIGURACIÓN DE INSTANCIA (MODO SERVIDOR) ──────────────
def check_single_instance():
    """Evita ejecuciones duplicadas solo si corremos el script directamente."""
    # En producción (Gunicorn), dejamos que el orquestador gestione los procesos.
    if os.environ.get('GUNICORN_VERSION'):
        return
    
    try:
        global _instance_lock_socket
        _instance_lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _instance_lock_socket.bind(('127.0.0.1', 47213))
    except socket.error:
        print(f"\n[!] ERROR: El servidor ya se encuentra en ejecución.")
        os._exit(1)

# Solo chequeamos si no estamos bajo Gunicorn y no es el proceso de recarga de Flask
if not os.environ.get('GUNICORN_VERSION') and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
    check_single_instance()

# ── INICIALIZACIÓN DE LA APP ──────────────────────────────
app = Flask(__name__)
app.secret_key = CONFIG.SECRET_KEY

# Importar Blueprints
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

# Registro de Blueprints
blueprints = [
    auth_bp, events_bp, invoices_bp, spreadsheet_bp, transactions_bp,
    metrics_bp, backup_bp, system_bp, cloud_bp, settings_bp
]
for bp in blueprints:
    app.register_blueprint(bp)

# ── INICIALIZACIÓN DE DATOS ──────────────────────────────────

# Asegurar carpetas de datos con rutas absolutas
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(BASE_DIR, 'data'), exist_ok=True)

# Iniciar Base de Datos y Notificaciones (Solo una vez)
with app.app_context():
    init_db()
    migrate_users_to_db(CONFIG.CREDENTIALS)

# El notifier solo se inicia si no es el proceso de recarga
if os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
    notifier.start()

# ── RUTAS Y ACTIVOS ─────────────────────────────────────────

@app.route('/assets/<path:path>')
def send_assets(path):
    return send_from_directory('assets', path)

@app.route('/')
def index():
    token = request.cookies.get('token')
    if sess.get_user(token):
        return redirect(url_for('dashboard'))
    return render_template('index.html')

@app.route('/app')
def dashboard():
    token = request.cookies.get('token')
    user = sess.get_user(token)
    if not user:
        return redirect(url_for('index'))
    return render_template('dashboard.html', user=user, token=token)

@app.route('/calendar')
def calendar():
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

# ── MODO DESARROLLO ─────────────────────────────────────────
if __name__ == '__main__':
    port = CONFIG.FLASK_PORT
    host = CONFIG.HOST
    
    ssl_context = None
    if CONFIG.USE_HTTPS and os.path.exists(CONFIG.CERT_FILE) and os.path.exists(CONFIG.KEY_FILE):
        ssl_context = (CONFIG.CERT_FILE, CONFIG.KEY_FILE)
        print(f"--- Modo Seguro (HTTPS) Activado ---")
    
    print(f"--- Null-Void Engine v2.0 (Dev Mode) ---")
    print(f"Servidor iniciado en {'https' if ssl_context else 'http'}://{host}:{port}")
    
    app.run(host=host, port=port, debug=CONFIG.DEBUG, ssl_context=ssl_context)
