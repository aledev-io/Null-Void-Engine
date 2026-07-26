from gevent import monkey
monkey.patch_all()

# Patch gevent Hub to suppress SSLError handshake stack traces (e.g. self-signed cert issues)
try:
    import sys
    import ssl
    from gevent.hub import Hub
    _orig_handle_error = Hub.handle_error
    def _custom_handle_error(self, context, type, value, tb):
        if type is not None and issubclass(type, ssl.SSLError):
            sys.stderr.write(f"[-] SSL Handshake Warning: {value}\n")
            sys.stderr.flush()
            return
        _orig_handle_error(self, context, type, value, tb)
    Hub.handle_error = _custom_handle_error
except Exception as e:
    print(f"Error patching gevent Hub: {e}", file=sys.stderr)

import os
import sys
import json
import socket
import platform
import subprocess
from datetime import datetime
from flask import Flask, render_template, request, jsonify, abort, redirect, url_for, send_from_directory, make_response, g, Response
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from config.config import CONFIG
from core.database import init_db, migrate_users_to_db
from core.notifications import notifier
from core.mail_scheduler import mail_scheduler
from modules.session import session as sess 
from core.socket_ext import socketio
from core.limiter import limiter

_instance_lock_socket = None

def check_single_instance():
    if os.environ.get('GUNICORN_VERSION'):
        return
    global _instance_lock_socket
    try:
        _instance_lock_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _instance_lock_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        _instance_lock_socket.bind(('127.0.0.1', 47213))
    except socket.error:
        print(f"\n[!] ERROR: El servidor ya se encuentra en ejecución.")
        os._exit(1)

def create_app():
    if not os.environ.get('GUNICORN_VERSION') and os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        check_single_instance()

    app = Flask(__name__)
    app.secret_key = CONFIG.SECRET_KEY
    app.config['TEMPLATES_AUTO_RELOAD'] = True
    app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024 * 1024 # 50 GB global size limit

    socketio.init_app(app)
    limiter.init_app(app)

    from modules.api.auth.routes import auth_bp
    from modules.api.events import events_bp
    from modules.api.invoices import invoices_bp
    from modules.api.spreadsheet import spreadsheet_bp
    from modules.api.transactions import transactions_bp
    from modules.api.metrics import metrics_bp
    from modules.api.backup import backup_bp
    from modules.api.system import system_bp
    from modules.api.cloud import cloud_bp
    from modules.api.settings import settings_bp
    from modules.api.chat import chat_bp
    from modules.api.friends import friends_bp
    from modules.api.mail import mail_bp
    from modules.api.ai import ai_bp
    from modules.api.scraper.routes import scraper_bp
    from modules.api.vault import vault_bp
    from core.telemetry.collector import record_request

    @app.before_request
    def before_req():
        record_request()
        
    # Las cabeceras de seguridad se añaden en el otro decorador @app.after_request más abajo

    blueprints = [
        auth_bp, events_bp, invoices_bp, spreadsheet_bp, transactions_bp,
        metrics_bp, backup_bp, system_bp, cloud_bp, settings_bp, chat_bp, 
        friends_bp, mail_bp, ai_bp, scraper_bp, vault_bp
    ]
    for bp in blueprints:
        app.register_blueprint(bp)

    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(CONFIG.DATA_DIR, exist_ok=True)

    with app.app_context():
        init_db()
        migrate_users_to_db(CONFIG.CREDENTIALS)
        from modules.api.scraper.scraper_db import init_db as init_scraper_db
        init_scraper_db()
    sessions_file = os.path.join(CONFIG.DATA_DIR, 'sessions.json')
    if os.path.exists(sessions_file):
        try:
            os.remove(sessions_file)
            sess._sessions = {}
            sess._user_index = {}
        except Exception:
            pass

    if os.environ.get('WERKZEUG_RUN_MAIN') != 'true':
        notifier.start()
        mail_scheduler.start()

    @app.route('/favicon.ico')
    def favicon():
        return send_from_directory('static/img', 'favicon.png', mimetype='image/png')

    @app.route('/sw.js')
    def service_worker():
        response = make_response(send_from_directory('static', 'sw.js'))
        response.headers['Content-Type'] = 'application/javascript'
        return response



    @app.route('/app')
    def dashboard():
        token = request.cookies.get('token')
        user = sess.get_user(token) if token else None
        if not user:
            return redirect(url_for('auth.index'))
        user_id = sess.get_user_id(token)
        return render_template('core/dashboard.html', user=user, user_id=user_id, token=token)

    @app.route('/calendar')
    def calendar():
        token = request.cookies.get('token')
        user = sess.get_user(token) if token else None
        if not user:
            return redirect(url_for('auth.index'))
        return render_template('modules/calendar.html', user=user, token=token)

    @app.route('/docs')
    def docs():
        token = request.cookies.get('token')
        user = sess.get_user(token) if token else None
        if not user:
            return redirect(url_for('auth.index'))
        user_id = sess.get_user_id(token)
        return render_template('core/docs.html', user=user, user_id=user_id, token=token)

    @app.route('/chat')
    def chat():
        token = request.cookies.get('token')
        user = sess.get_user(token) if token else None
        if not user:
            return redirect(url_for('auth.index'))
        return render_template('modules/chat.html', user=user, token=token)

    @app.route('/telemetry')
    def telemetry():
        token = request.cookies.get('token')
        user = sess.get_user(token) if token else None
        if not user:
            return redirect(url_for('auth.index'))
        return render_template('modules/telemetry.html', user=user, token=token)

    @app.route('/marketplace')
    def marketplace():
        token = request.cookies.get('token')
        user = sess.get_user(token) if token else None
        if not user:
            return redirect(url_for('auth.index'))
        return redirect(url_for('system.app'))

    @app.route('/cloud')
    def cloud():
        token = request.cookies.get('token')
        user = sess.get_user(token) if token else None
        if not user:
            return redirect(url_for('auth.index'))
        return render_template('modules/cloud.html', user=user, token=token)

    @app.route('/excel')
    def excel():
        token = request.cookies.get('token')
        user = sess.get_user(token) if token else None
        if not user:
            return redirect(url_for('auth.index'))
        return render_template('modules/excel.html', user=user, token=token)

    @app.route('/invoices')
    def invoices():
        token = request.cookies.get('token')
        user = sess.get_user(token) if token else None
        if not user:
            return redirect(url_for('auth.index'))
        return render_template('modules/invoices.html', user=user, token=token)

    @app.route('/backups')
    def backups():
        token = request.cookies.get('token')
        user = sess.get_user(token) if token else None
        if not user:
            return redirect(url_for('auth.index'))
        return render_template('modules/backups.html', user=user, token=token)

    @app.route('/reminders')
    def reminders():
        token = request.cookies.get('token')
        user = sess.get_user(token) if token else None
        if not user:
            return redirect(url_for('auth.index'))
        return render_template('modules/reminders.html', user=user, token=token)

    @app.route('/mail')
    def mail():
        token = request.cookies.get('token')
        user = sess.get_user(token) if token else None
        if not user:
            return redirect(url_for('auth.index'))
        return render_template('modules/mail.html', user=user, token=token)
    
    @app.route('/api/client_log', methods=['POST'])
    def client_log():
        try:
            data = request.get_json(silent=True) or {}
            print(f"\n[CLIENT LOG] {data.get('level', 'INFO').upper()}: {data.get('message')}\n", flush=True)
        except Exception as e:
            print(f"Error logging client message: {e}", flush=True)
        return jsonify(ok=True)

    @app.before_request
    def check_invalid_session():
        token = request.cookies.get('token')
        if not token:
            return
        user = sess.get_user(token)
        if user:
            return  # Session valid, nothing to do
        # Token exists but session is invalid
        if request.path.startswith('/api/'):
            g.clear_cookies = True
        else:
            # For page routes, redirect to login immediately
            resp = redirect(url_for('auth.index'))
            resp.delete_cookie('token')
            resp.delete_cookie('user')
            return resp

    @app.after_request
    def add_security_headers(response):
        if getattr(g, 'clear_cookies', False):
            response.delete_cookie('token')
            response.delete_cookie('user')

        if CONFIG.USE_HTTPS:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http: blob:; font-src 'self' data: https: http:; media-src 'self' blob:; connect-src 'self' https: http: ws: wss:;"
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['X-XSS-Protection'] = '1; mode=block'

        # Prevent browser caching for JS, CSS and HTML to ensure fresh content
        content_type = response.content_type or ''
        if any(ct in content_type for ct in ['javascript', 'text/css', 'text/html']):
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'

        return response

    @app.errorhandler(401)
    def unauthorized(e):
        if request.path.startswith('/api/'):
            return jsonify(error="Sesión expirada o no válida"), 401
        return redirect(url_for('auth.index'))

    @app.errorhandler(403)
    def forbidden(e):
        if request.path.startswith('/api/'):
            return jsonify(error="Acceso prohibido"), 403
        return render_template('errors/error.html', code=403, title="Acceso Prohibido", message="No tienes los permisos necesarios para acceder a este recurso."), 403

    @app.errorhandler(404)
    def not_found(e):
        if request.path.startswith('/api/'):
            return jsonify(error="Recurso no encontrado"), 404
        return render_template('errors/error.html', code=404, title="Página no encontrada", message="El enlace que has seguido puede estar roto o la página ha sido eliminada."), 404

    @app.errorhandler(500)
    def server_error(e):
        if request.path.startswith('/api/'):
            return jsonify(error="Error interno del servidor"), 500
        return render_template('errors/error.html', code=500, title="Error del Sistema", message="Algo ha salido mal en nuestros servidores."), 500

    @app.route('/api/scraper/export_list_pdf', methods=['POST'])
    def proxy_export_list_pdf():
        token = request.cookies.get('token')
        if not token or not sess.get_user(token):
            return jsonify(error="No autorizado"), 401
        import requests as req
        r = req.post('http://127.0.0.1:5001/export_list_pdf',
                    json=request.get_json(),
                    stream=True)
        return Response(r.content,
                        status=r.status_code,
                        content_type=r.headers.get('Content-Type', 'application/pdf'),
                        headers={'Content-Disposition': r.headers.get('Content-Disposition', '')})

    return app



app = create_app()

if __name__ == '__main__':
    port = CONFIG.FLASK_PORT
    host = CONFIG.HOST
    
    ssl_context = None
    if CONFIG.USE_HTTPS and os.path.exists(CONFIG.CERT_FILE) and os.path.exists(CONFIG.KEY_FILE):
        ssl_context = (CONFIG.CERT_FILE, CONFIG.KEY_FILE)
        print(f"--- Modo Seguro (HTTPS) Activado ---")
    
    print(f"--- Null-Void Engine v2.0 (App Factory Mode) ---")
    print(f"Servidor iniciado en {'https' if ssl_context else 'http'}://{host}:{port}")
    
    socketio.run(app, host=host, port=port, debug=CONFIG.DEBUG)