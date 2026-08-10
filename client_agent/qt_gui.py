# -*- coding: utf-8 -*-
"""
Interfaz de escritorio NATIVA del Agente de Null-Void Cloud (PySide6/Qt).
Diseño premium que replica el estilo visual de la web Cloud.

Flujo:
  1. Splash / Bienvenida -> boton "Iniciar"
  2. Wizard de vinculacion (URL del servidor -> Token -> Nombre dispositivo)
  3. Dashboard principal con sidebar, metricas y consola en vivo
"""

import os
import platform
import sys
import time
import threading

from cloud_api import CloudAgentAPI, clean_error_msg


def _agent_api():
    """CloudAgentAPI con la huella TLS fijada en el .env (AGENT_CERT_HASH),
    de modo que la GUI también rechace servidores suplantados."""
    cert_hash = None
    try:
        from agent import _AGENT_ENV
        cert_hash = (_AGENT_ENV or {}).get("cert_hash")
    except Exception:
        pass
    return CloudAgentAPI(cert_hash=cert_hash)

# ────────── Design Tokens (identicos a la web Cloud) ──────────
P = {
    "bg":             "#111827",
    "surface":        "#161d2f",
    "surface_hi":     "#1e2842",
    "sidebar":        "#0f1422",
    "border":         "rgba(255,255,255,0.07)",
    "border_hi":      "rgba(99,102,241,0.30)",
    "text":           "#e8edf8",
    "text_dim":       "#8b95b0",
    "text_faint":     "#4e5870",
    "accent":         "#6366f1",
    "accent2":        "#8b5cf6",
    "accent_dim":     "rgba(99,102,241,0.20)",
    "accent_badge":   "rgba(99,102,241,0.13)",
    "nav_active":     "rgba(129,140,248,0.25)",
    "nav_text":       "#ffffff",
    "input_bg":       "rgba(255,255,255,0.05)",
    "input_border":   "rgba(99,102,241,0.22)",
    "green":          "#10b981",
    "amber":          "#f59e0b",
    "red":            "#ef4444",
    "console":        "#070b15",
    "console_fg":     "#34d399",
}


def _svg_to_icon(QtGui, QtSvg, QtCore, svg_xml, size=18, color="#8b95b0"):
    svg_bytes = svg_xml.replace('stroke="currentColor"', f'stroke="{color}"').encode("utf-8")
    renderer = QtSvg.QSvgRenderer(QtCore.QByteArray(svg_bytes))
    pm = QtGui.QPixmap(size, size)
    pm.fill(QtGui.QColor(0, 0, 0, 0))
    p = QtGui.QPainter(pm)
    p.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing)
    renderer.render(p)
    p.end()
    return QtGui.QIcon(pm)

# SVGs vectoriales
SVG_ICONS = {
    "dashboard": '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>''',
    "console": '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>''',
    "sync": '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>''',
    "folder": '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>''',
    "pause": '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>''',
    "play": '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>''',
    "logout": '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>''',
    "link": '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>''',
    "pc": '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>''',
    "plus": '''<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>''',
}

def _make_tray_icon(QtGui):
    size = 64
    pm = QtGui.QPixmap(size, size)
    pm.fill(QtGui.QColor(0, 0, 0, 0))
    p = QtGui.QPainter(pm)
    p.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing)
    grad = QtGui.QLinearGradient(0, 0, size, size)
    grad.setColorAt(0.0, QtGui.QColor(P["accent"]))
    grad.setColorAt(1.0, QtGui.QColor(P["accent2"]))
    p.setBrush(QtGui.QBrush(grad))
    p.setPen(QtGui.QPen(QtGui.QColor(0, 0, 0, 0)))
    p.drawRoundedRect(2, 2, size - 4, size - 4, 14, 14)
    p.setBrush(QtGui.QBrush(QtGui.QColor("#ffffff")))
    p.drawEllipse(16, 30, 20, 16)
    p.drawEllipse(30, 24, 20, 18)
    p.drawRect(20, 36, 34, 10)
    p.drawRect(14, 32, 36, 8)
    p.end()
    return QtGui.QIcon(pm)



def _make_logo_pixmap(QtGui, size=48):
    pm = QtGui.QPixmap(size, size)
    pm.fill(QtGui.QColor(0, 0, 0, 0))
    p = QtGui.QPainter(pm)
    p.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing)
    grad = QtGui.QLinearGradient(0, 0, size, size)
    grad.setColorAt(0.0, QtGui.QColor(P["accent"]))
    grad.setColorAt(1.0, QtGui.QColor(P["accent2"]))
    p.setBrush(QtGui.QBrush(grad))
    p.setPen(QtGui.QPen(QtGui.QColor(0, 0, 0, 0)))
    p.drawRoundedRect(0, 0, size, size, int(size * 0.22), int(size * 0.22))
    p.setBrush(QtGui.QBrush(QtGui.QColor("#ffffff")))
    r = size / 64
    p.drawEllipse(int(16*r), int(30*r), int(20*r), int(16*r))
    p.drawEllipse(int(30*r), int(24*r), int(20*r), int(18*r))
    p.drawRect(int(20*r), int(36*r), int(34*r), int(10*r))
    p.drawRect(int(14*r), int(32*r), int(36*r), int(8*r))
    p.end()
    return pm


SHARED_STYLE = f"""
    QDialog, QWidget, QMainWindow, QStackedWidget {{
        background: {P['bg']};
        color: {P['nav_text']};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }}
    QToolTip {{
        background-color: #1e293b;
        color: {P['nav_text']};
        border: 1px solid rgba(99,102,241,0.50);
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 600;
    }}
    QLabel {{ background: transparent; color: {P['nav_text']}; }}
    QLineEdit {{
        background: {P['input_bg']};
        border: 1px solid {P['input_border']};
        border-radius: 8px;
        padding: 11px 14px;
        color: {P['text']};
        font-size: 13px;
    }}
    QLineEdit:focus {{ border-color: {P['accent']}; }}
    QPushButton#primary {{
        background: {P['accent']};
        color: {P['nav_text']};
        border: none;
        border-radius: 8px;
        padding: 13px 24px;
        font-weight: 700;
        font-size: 14px;
    }}
    QPushButton#primary:hover {{ background: #4f46e5; }}
    QPushButton#secondary {{
        background: rgba(255,255,255,0.06);
        color: {P['nav_text']};
        border: 1px solid rgba(99,102,241,0.35);
        border-radius: 8px;
        padding: 11px 20px;
        font-weight: 700;
        font-size: 13px;
    }}
    QPushButton#secondary:hover {{ background: {P['accent_dim']}; color: {P['nav_text']}; border-color: #818cf8; }}
    QPushButton#action {{
        background: #1e293b;
        color: {P['nav_text']};
        border: 1px solid rgba(99,102,241,0.40);
        border-radius: 8px;
        padding: 10px 18px;
        font-weight: 700;
        font-size: 13px;
    }}
    QPushButton#action:hover {{ background: rgba(99,102,241,0.22); border-color: #818cf8; color: {P['nav_text']}; }}
    QPushButton#nav_btn {{
        background: transparent;
        color: #e2e8f0;
        border: none;
        border-radius: 8px;
        padding: 10px 14px;
        text-align: left;
        font-size: 13px;
        font-weight: 600;
    }}
    QPushButton#nav_btn:hover {{
        background: rgba(255,255,255,0.06);
        color: {P['nav_text']};
    }}
    QFrame#card {{
        background: {P['surface']};
        border: 1px solid {P['border_hi']};
        border-radius: 12px;
    }}
"""

def _ui_safe_slot(fn):
    """Envuelve un slot de UI para ignorar el error de widgets Qt ya destruidos
    ("wrapped C/C++ object has been deleted") cuando un hilo termina tarde."""
    def wrapper(*args, **kwargs):
        try:
            fn(*args, **kwargs)
        except RuntimeError:
            pass
    return wrapper


def run_async(fn, on_done, parent=None):
    """Ejecuta fn() en un hilo y entrega su resultado a on_done() en el hilo de Qt."""
    try:
        from PySide6 import QtCore
    except ImportError:
        try:
            from PyQt6 import QtCore
        except ImportError:
            from PyQt5 import QtCore

    class _Worker(QtCore.QObject):
        done = QtCore.Signal(object)

    worker = _Worker(parent)
    worker.done.connect(_ui_safe_slot(on_done))

    def _run():
        result = fn()
        try:
            worker.done.emit(result)
        except RuntimeError:
            pass

    threading.Thread(target=_run, daemon=True).start()
    return worker  # el llamador debe retener la referencia


def _make_confirm_dialog(QtWidgets, QtCore):
    """Factory de diálogo de confirmación con tamaño dinámico (sin overflow):
    el alto crece según el texto, los botones no tocan los bordes."""
    def confirm_dialog(parent, title_message, body, yes_text="Aceptar", no_text="Cancelar"):
        dlg = QtWidgets.QDialog(parent)
        dlg.setWindowTitle(title_message)
        dlg.setWindowModality(QtCore.Qt.WindowModality.WindowModal)
        dlg.setStyleSheet(SHARED_STYLE + f"""
            QLabel#dlg_title {{
                color: {P['nav_text']};
                font-size: 15px;
                font-weight: 800;
            }}
            QLabel#dlg_body {{
                color: {P['text']};
                font-size: 13px;
            }}
        """)

        content = QtWidgets.QVBoxLayout(dlg)
        content.setContentsMargins(30, 26, 30, 22)
        content.setSpacing(10)

        title_lbl = QtWidgets.QLabel(title_message or "")
        title_lbl.setObjectName("dlg_title")

        body_lbl = QtWidgets.QLabel(body or "")
        body_lbl.setObjectName("dlg_body")
        body_lbl.setWordWrap(True)
        body_lbl.setTextInteractionFlags(QtCore.Qt.TextInteractionFlag.TextSelectableByMouse)

        content.addWidget(title_lbl)
        content.addWidget(body_lbl)
        content.addSpacing(8)

        btn_row = QtWidgets.QHBoxLayout()
        btn_row.setSpacing(10)
        btn_row.addStretch(1)
        if no_text:
            btn_no = QtWidgets.QPushButton(no_text)
            btn_no.setObjectName("secondary")
            btn_no.setMinimumSize(110, 40)
            btn_no.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
            btn_no.clicked.connect(dlg.reject)
            btn_row.addWidget(btn_no)
        btn_yes = QtWidgets.QPushButton(yes_text)
        btn_yes.setObjectName("primary")
        btn_yes.setMinimumSize(110, 40)
        btn_yes.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
        btn_yes.clicked.connect(dlg.accept)
        btn_row.addWidget(btn_yes)
        content.addLayout(btn_row)

        # Ajuste dinámico: sin alturas fijas, el layout crece con el texto
        content.activate()
        dlg.adjustSize()
        dlg.setMinimumWidth(410)
        if parent is not None:
            parent_geo = parent.geometry()
            dlg.move(parent_geo.center() - dlg.rect().center())

        return dlg.exec() == QtWidgets.QDialog.DialogCode.Accepted

    return confirm_dialog


def _remaining_devices(client):
    """Consulta al servidor cuántos dispositivos tiene vinculada la cuenta.

    Devuelve un int (número de dispositivos) o None si no se pudo verificar
    (p. ej. sin conexión), en cuyo caso el llamador decide cómo continuar.
    """
    server_url = None
    if getattr(client, 'server_urls', None):
        server_url = client.server_urls[0]
    elif getattr(client, 'server_url', None):
        server_url = client.server_url
    if not server_url:
        return None

    token = getattr(client, 'token', '') or ''
    try:
        data = _agent_api().list_devices(
            server_url,
            token or "session_active",
            bearer_token=token or None,
        )
        names = []
        for dev in data.get("devices", []) or []:
            name = dev.get("name") if isinstance(dev, dict) else str(dev)
            if name:
                names.append(str(name))
        return len(names)
    except Exception:
        return None


SHARED_STYLE += f"""
    QFrame#sidebar {{
        background: {P['sidebar']};
        border-right: 1px solid {P['border']};
    }}
    QFrame#topbar {{
        background: {P['surface']};
        border-bottom: 1px solid {P['border']};
    }}
    QPlainTextEdit {{
        background: {P['console']};
        color: {P['console_fg']};
        border: 1px solid {P['border_hi']};
        border-radius: 10px;
        font-family: "Consolas", "Fira Code", monospace;
        font-size: 11px;
        padding: 8px;
    }}
    QScrollBar:vertical {{
        background: transparent; width: 6px; margin: 0;
    }}
    QScrollBar::handle:vertical {{
        background: rgba(255,255,255,0.12); border-radius: 3px; min-height: 24px;
    }}
    QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{ height: 0; }}
    QMenu {{
        background: {P['surface']};
        border: 1px solid {P['border_hi']};
        border-radius: 8px;
        padding: 4px;
        color: {P['text']};
    }}
    QMenu::item {{ padding: 8px 20px; border-radius: 6px; }}
    QMenu::item:selected {{ background: {P['nav_active']}; color: {P['nav_text']}; }}
"""


# ─────────────────────────────────────────────────────────────────────────────
# PANTALLA SPLASH + WIZARD DE VINCULACION
# ─────────────────────────────────────────────────────────────────────────────

def register_agent_qt_gui(bootstrap_servers, default_device_name, perform_reg_fn):
    try:
        from PySide6 import QtWidgets, QtCore, QtGui, QtSvg
    except ImportError:
        try:
            from PyQt6 import QtWidgets, QtCore, QtGui, QtSvg
        except ImportError:
            try:
                from PyQt5 import QtWidgets, QtCore, QtGui, QtSvg
            except ImportError:
                return None

    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication(sys.argv[:1])

    win = QtWidgets.QDialog()
    win.setWindowTitle("Null-Void Cloud — Configuracion Inicial")
    win.setFixedSize(1280, 800)
    flags = (
        QtCore.Qt.WindowType.Dialog |
        QtCore.Qt.WindowType.CustomizeWindowHint |
        QtCore.Qt.WindowType.WindowTitleHint |
        QtCore.Qt.WindowType.WindowCloseButtonHint
    )
    win.setWindowFlags(flags)
    win.setStyleSheet(SHARED_STYLE)

    # Centrado automatico en pantalla
    screen = app.primaryScreen()
    if screen:
        geo = screen.availableGeometry()
        win.move(geo.center() - win.rect().center())

    root_layout = QtWidgets.QVBoxLayout(win)
    root_layout.setContentsMargins(0, 0, 0, 0)

    stack = QtWidgets.QStackedWidget()
    root_layout.addWidget(stack)
    result_config = {"config": None}

    # ══════════════════════════════════════════════════════════════════════════
    # PAGINA 0 — SPLASH / BIENVENIDA (Diseño responsivo y ultra limpio)
    # ══════════════════════════════════════════════════════════════════════════
    splash = QtWidgets.QWidget()
    splash_l = QtWidgets.QHBoxLayout(splash)
    splash_l.setContentsMargins(0, 0, 0, 0)
    splash_l.setSpacing(0)

    # Panel izquierdo (branding) - Ancho fijo controlado como Discord/Spotify
    left_panel = QtWidgets.QFrame()
    left_panel.setFixedWidth(320)
    left_panel.setStyleSheet("""
        QFrame {
            background: #111827;
            border-right: 1px solid rgba(255,255,255,0.06);
        }
    """)
    left_l = QtWidgets.QVBoxLayout(left_panel)
    left_l.setContentsMargins(32, 40, 32, 40)
    left_l.setSpacing(0)

    logo_lbl = QtWidgets.QLabel()
    logo_lbl.setPixmap(_make_logo_pixmap(QtGui, 56))
    logo_lbl.setAlignment(QtCore.Qt.AlignmentFlag.AlignLeft)
    left_l.addWidget(logo_lbl)
    left_l.addSpacing(20)

    brand_title = QtWidgets.QLabel("Null-Void Cloud")
    brand_title.setStyleSheet("font-size: 32px; font-weight: 800; color: #ffffff; border: none;")
    brand_title.setWordWrap(False)
    left_l.addWidget(brand_title)
    left_l.addStretch(1)

    # Íconos y texto sutiles sin bordes flotantes ni artefactos
    check_svg = '''<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'''
    check_icon = _svg_to_icon(QtGui, QtSvg, QtCore, check_svg, size=14, color="#6366f1")

    for feat in ["Cifrado extremo a extremo", "Sync en tiempo real", "Múltiples carpetas"]:
        feat_item = QtWidgets.QWidget()
        feat_item.setStyleSheet("border: none; background: transparent;")
        feat_h = QtWidgets.QHBoxLayout(feat_item)
        feat_h.setContentsMargins(0, 4, 0, 4)
        feat_h.setSpacing(10)
        
        ic_lbl = QtWidgets.QLabel()
        ic_lbl.setStyleSheet("border: none; background: transparent;")
        ic_lbl.setPixmap(check_icon.pixmap(14, 14))
        
        txt_lbl = QtWidgets.QLabel(feat)
        txt_lbl.setStyleSheet("font-size: 12px; color: #8b95b0; font-weight: 500; border: none; background: transparent;")
        
        feat_h.addWidget(ic_lbl)
        feat_h.addWidget(txt_lbl, 1)
        left_l.addWidget(feat_item)

    splash_l.addWidget(left_panel)

    # Panel derecho (Hero / Call to Action) - Contenedor amplio y centrado
    right_panel = QtWidgets.QWidget()
    right_panel.setStyleSheet("background: #0f1422; border: none;")
    right_l = QtWidgets.QVBoxLayout(right_panel)
    right_l.setContentsMargins(40, 48, 40, 48)
    right_l.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)

    right_content = QtWidgets.QWidget()
    right_content.setMaximumWidth(520)
    rc_l = QtWidgets.QVBoxLayout(right_content)
    rc_l.setContentsMargins(0, 0, 0, 0)
    rc_l.setSpacing(0)
    rc_l.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)

    welcome_title = QtWidgets.QLabel("Bienvenido")
    welcome_title.setStyleSheet("font-size: 32px; font-weight: 800; color: #ffffff; border: none;")
    welcome_title.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)

    welcome_sub = QtWidgets.QLabel("Vincula este dispositivo con tu servidor Null-Void Cloud para comenzar a sincronizar tus archivos.")
    welcome_sub.setStyleSheet("font-size: 15px; color: #8b95b0; line-height: 1.6; border: none;")
    welcome_sub.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
    welcome_sub.setWordWrap(True)

    btn_start = QtWidgets.QPushButton("Iniciar vinculación  →")
    btn_start.setObjectName("primary")
    btn_start.setMinimumHeight(48)
    btn_start.setFixedWidth(240)
    btn_start.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)

    rc_l.addWidget(welcome_title)
    rc_l.addSpacing(14)
    rc_l.addWidget(welcome_sub)
    rc_l.addSpacing(32)
    rc_l.addWidget(btn_start, 0, QtCore.Qt.AlignmentFlag.AlignCenter)

    right_l.addStretch(1)
    right_l.addWidget(right_content, 0, QtCore.Qt.AlignmentFlag.AlignCenter)
    right_l.addStretch(1)

    splash_l.addWidget(right_panel, 1)
    stack.addWidget(splash)

    # ══════════════════════════════════════════════════════════════════════════
    # PAGINA 1 — WIZARD DE VINCULACION (3 pasos)
    # ══════════════════════════════════════════════════════════════════════════
    wizard = QtWidgets.QWidget()
    wiz_main = QtWidgets.QHBoxLayout(wizard)
    wiz_main.setContentsMargins(0, 0, 0, 0)
    wiz_main.setSpacing(0)

    # Barra lateral del wizard
    wiz_side = QtWidgets.QFrame()
    wiz_side.setObjectName("sidebar")
    wiz_side.setMinimumWidth(220)
    wiz_side.setMaximumWidth(220)
    wiz_side_l = QtWidgets.QVBoxLayout(wiz_side)
    wiz_side_l.setContentsMargins(20, 28, 20, 24)
    wiz_side_l.setSpacing(4)

    wiz_logo = QtWidgets.QLabel()
    wiz_logo.setPixmap(_make_logo_pixmap(QtGui, 36))
    wiz_side_l.addWidget(wiz_logo)
    wiz_side_l.addSpacing(8)

    wiz_brand = QtWidgets.QLabel("Null-Void Cloud")
    wiz_brand.setStyleSheet("font-size: 14px; font-weight: 700; color: #818cf8;")
    wiz_side_l.addWidget(wiz_brand)
    wiz_side_l.addSpacing(24)

    step_labels = [("1", "Servidor"), ("2", "Autenticación"), ("3", "Este Dispositivo"), ("4", "Carpeta Base")]
    step_widgets = []
    for num, label in step_labels:
        row = QtWidgets.QHBoxLayout()
        num_lbl = QtWidgets.QLabel(num)
        num_lbl.setFixedSize(24, 24)
        num_lbl.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        num_lbl.setStyleSheet("background: rgba(99,102,241,0.20); color: #6366f1; border-radius: 12px; font-size: 11px; font-weight: 800;")
        lbl = QtWidgets.QLabel(label)
        lbl.setStyleSheet("font-size: 13px; color: #8b95b0; font-weight: 500;")
        row.addWidget(num_lbl)
        row.addSpacing(8)
        row.addWidget(lbl)
        row.addStretch(1)
        step_widgets.append((num_lbl, lbl))
        wiz_side_l.addLayout(row)
        wiz_side_l.addSpacing(6)

    wiz_side_l.addStretch(1)
    wiz_main.addWidget(wiz_side)

    # Contenido del wizard
    wiz_content = QtWidgets.QWidget()
    wiz_content_outer = QtWidgets.QVBoxLayout(wiz_content)
    wiz_content_outer.setContentsMargins(0, 0, 0, 0)
    wiz_content_outer.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)

    wiz_card = QtWidgets.QWidget()
    wiz_card.setMaximumWidth(580)
    wiz_card.setMinimumWidth(380)
    wiz_content_l = QtWidgets.QVBoxLayout(wiz_card)
    wiz_content_l.setContentsMargins(40, 40, 40, 40)
    wiz_content_l.setSpacing(0)

    wiz_stack = QtWidgets.QStackedWidget()
    wiz_step = [0]
    worker_refs = []

    def update_step_highlight(step):
        for i, (n, l) in enumerate(step_widgets):
            if i == step:
                n.setStyleSheet("background: #6366f1; color: #fff; border-radius: 12px; font-size: 11px; font-weight: 800;")
                l.setStyleSheet("font-size: 13px; color: #e8edf8; font-weight: 700;")
            else:
                n.setStyleSheet("background: rgba(99,102,241,0.20); color: #6366f1; border-radius: 12px; font-size: 11px; font-weight: 800;")
                l.setStyleSheet("font-size: 13px; color: #8b95b0; font-weight: 500;")

    def make_step_page(title, subtitle):
        w = QtWidgets.QWidget()
        l = QtWidgets.QVBoxLayout(w)
        l.setContentsMargins(0, 0, 0, 0)
        l.setSpacing(0)
        t = QtWidgets.QLabel(title)
        t.setStyleSheet("font-size: 24px; font-weight: 800; color: #e8edf8;")
        s = QtWidgets.QLabel(subtitle)
        s.setStyleSheet("font-size: 13px; color: #8b95b0; margin-top: 6px;")
        s.setWordWrap(True)
        l.addWidget(t)
        l.addSpacing(4)
        l.addWidget(s)
        l.addSpacing(20)
        return w, l

    def field_label(text):
        lbl = QtWidgets.QLabel(text)
        lbl.setStyleSheet("font-size: 11px; font-weight: 700; color: #8b95b0; text-transform: uppercase; letter-spacing: 0.05em;")
        return lbl

    # Paso 1: URL
    s1, s1l = make_step_page("Dirección del Servidor", "Introduce la URL completa de tu servidor Null-Void Cloud.")
    url_input = QtWidgets.QLineEdit()
    url_input.setPlaceholderText("https://192.168.1.50:5000")
    url_input.setMinimumHeight(46)
    if bootstrap_servers:
        url_input.setText(bootstrap_servers[0])
    s1l.addWidget(field_label("URL del Servidor"))
    s1l.addSpacing(6)
    s1l.addWidget(url_input)
    s1l.addStretch(1)
    wiz_stack.addWidget(s1)

    # Paso 2: Autenticacion mediante Token
    s2, s2l = make_step_page("Token de Enlace", "Introduce el token de enlace único generado desde tu panel web de Null-Void Cloud.")

    tok_input = QtWidgets.QLineEdit()
    tok_input.setPlaceholderText("nv-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")
    tok_input.setMinimumHeight(46)
    tok_input.setEchoMode(QtWidgets.QLineEdit.EchoMode.Password)
    btn_tok_vis = QtWidgets.QPushButton("Mostrar")
    btn_tok_vis.setObjectName("secondary")
    btn_tok_vis.setMinimumHeight(46)
    btn_tok_vis.setFixedWidth(88)
    btn_tok_vis.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)

    def toggle_tok_visibility():
        hidden = tok_input.echoMode() == QtWidgets.QLineEdit.EchoMode.Password
        tok_input.setEchoMode(
            QtWidgets.QLineEdit.EchoMode.Normal if hidden else QtWidgets.QLineEdit.EchoMode.Password
        )
        btn_tok_vis.setText("Ocultar" if hidden else "Mostrar")

    btn_tok_vis.clicked.connect(toggle_tok_visibility)
    tok_hint = QtWidgets.QLabel("Seguridad: Ve a tu panel Cloud → Configuración → Dispositivos → Generar Token de Enlace.")
    tok_hint.setStyleSheet("font-size: 11px; color: #8b95b0; background: rgba(99,102,241,0.13); border: 1px solid rgba(99,102,241,0.22); border-radius: 8px; padding: 10px 14px;")
    tok_hint.setWordWrap(True)

    tok_row = QtWidgets.QHBoxLayout()
    tok_row.setSpacing(8)
    tok_row.addWidget(tok_input, 1)
    tok_row.addWidget(btn_tok_vis)

    s2l.addWidget(field_label("Token de Enlace"))
    s2l.addSpacing(6)
    s2l.addLayout(tok_row)
    s2l.addSpacing(6)
    s2l.addWidget(tok_hint)
    s2l.addStretch(1)
    wiz_stack.addWidget(s2)

    # Paso 3: Dispositivo
    s3, s3l = make_step_page("Nombre del Dispositivo", "Elige cómo aparecerá este equipo en tu panel de Null-Void Cloud.")
    dev_input = QtWidgets.QLineEdit()
    dev_input.setText(default_device_name)
    dev_input.setMinimumHeight(46)
    s3l.addWidget(field_label("Nombre del Dispositivo"))
    s3l.addSpacing(6)
    s3l.addWidget(dev_input)
    s3l.addStretch(1)
    wiz_stack.addWidget(s3)

    # Paso 4: Carpeta Compartida
    default_base_dir = os.path.expanduser("~/Escritorio")
    if not os.path.exists(default_base_dir):
        default_base_dir = os.path.expanduser("~/Desktop")
    if not os.path.exists(default_base_dir):
        default_base_dir = os.path.expanduser("~")

    s4, s4l = make_step_page("Carpeta Compartida", "Selecciona el directorio local donde deseas crear y sincronizar tu carpeta de Null-Void Cloud.")
    dir_row = QtWidgets.QHBoxLayout()
    dir_input = QtWidgets.QLineEdit()
    dir_input.setText(default_base_dir)
    dir_input.setMinimumHeight(46)
    btn_browse = QtWidgets.QPushButton("Examinar...")
    btn_browse.setObjectName("secondary")
    btn_browse.setMinimumHeight(46)
    btn_browse.setFixedWidth(110)
    
    dir_row.addWidget(dir_input, 1)
    dir_row.addSpacing(8)
    dir_row.addWidget(btn_browse)

    dir_preview_lbl = QtWidgets.QLabel(f"Se creará: {os.path.join(default_base_dir, 'Null-Void-Sync')}")
    dir_preview_lbl.setStyleSheet("font-size: 12px; color: #6366f1; font-weight: 600; margin-top: 8px;")
    dir_preview_lbl.setWordWrap(True)

    def update_dir_preview(text):
        base_p = text.strip() or default_base_dir
        target_p = os.path.join(base_p, "Null-Void-Sync")
        dir_preview_lbl.setText(f"Se creará: {target_p}")

    dir_input.textChanged.connect(update_dir_preview)

    def on_browse_dir():
        chosen = QtWidgets.QFileDialog.getExistingDirectory(win, "Seleccionar carpeta base", dir_input.text() or default_base_dir)
        if chosen:
            dir_input.setText(chosen)

    btn_browse.clicked.connect(on_browse_dir)

    s4l.addWidget(field_label("Directorio Base Local"))
    s4l.addSpacing(6)
    s4l.addLayout(dir_row)
    s4l.addWidget(dir_preview_lbl)
    s4l.addStretch(1)
    wiz_stack.addWidget(s4)

    wiz_content_l.addWidget(wiz_stack, 1)

    err_lbl = QtWidgets.QLabel("")
    err_lbl.setStyleSheet("color: #ef4444; font-size: 12px; font-weight: 600; padding: 4px 0;")
    err_lbl.setWordWrap(True)
    wiz_content_l.addWidget(err_lbl)
    wiz_content_l.addSpacing(10)

    nav_row = QtWidgets.QHBoxLayout()
    btn_back = QtWidgets.QPushButton("← Atrás")
    btn_back.setObjectName("secondary")
    btn_back.setMinimumHeight(44)
    btn_back.setVisible(False)
    btn_next = QtWidgets.QPushButton("Continuar →")
    btn_next.setObjectName("primary")
    btn_next.setMinimumHeight(44)
    nav_row.addWidget(btn_back)
    nav_row.addStretch(1)
    nav_row.addWidget(btn_next)
    wiz_content_l.addLayout(nav_row)

    wiz_content_outer.addStretch(1)
    wiz_content_outer.addWidget(wiz_card, 0, QtCore.Qt.AlignmentFlag.AlignCenter)
    wiz_content_outer.addStretch(1)

    wiz_main.addWidget(wiz_content, 1)
    stack.addWidget(wizard)

    # Navegacion
    def go_to_wizard():
        stack.setCurrentIndex(1)
        update_step_highlight(0)

    btn_start.clicked.connect(go_to_wizard)

    def on_back():
        s = wiz_step[0] - 1
        wiz_step[0] = s
        wiz_stack.setCurrentIndex(s)
        update_step_highlight(s)
        btn_back.setVisible(s > 0)
        btn_next.setText("Continuar →")
        err_lbl.setText("")

    def on_next():
        s = wiz_step[0]
        err_lbl.setText("")

        if s == 0:
            url = url_input.text().strip()
            if not url.startswith("http://") and not url.startswith("https://"):
                err_lbl.setText("La URL debe empezar por http:// o https:// (ejemplo: https://192.168.1.50:5000)")
                return

            # Prueba de conexión al servidor en segundo plano
            err_lbl.setStyleSheet("color: #818cf8; font-size: 12px; font-weight: 600;")
            err_lbl.setText("Probando conexión con el servidor...")
            url_input.setEnabled(False)
            btn_back.setEnabled(False)
            btn_next.setEnabled(False)

            def _ping():
                return _agent_api().test_connection(url)

            def _on_conn_done(result):
                ok, err_msg = result
                url_input.setEnabled(True)
                btn_back.setEnabled(True)
                btn_next.setEnabled(True)
                if ok:
                    err_lbl.setText("")
                    err_lbl.setStyleSheet("color: #ef4444; font-size: 12px; font-weight: 600;")
                    wiz_step[0] = 1
                    wiz_stack.setCurrentIndex(1)
                    update_step_highlight(1)
                    btn_back.setVisible(True)
                else:
                    err_lbl.setStyleSheet("color: #ef4444; font-size: 12px; font-weight: 600;")
                    err_lbl.setText(err_msg)

            worker_refs.append(run_async(_ping, _on_conn_done, parent=win))

        elif s == 1:
            token_val = tok_input.text().strip()
            if not token_val:
                err_lbl.setText("El token de enlace no puede estar vacío.")
                return

            url = url_input.text().strip().rstrip("/")
            err_lbl.setStyleSheet("color: #818cf8; font-size: 12px; font-weight: 600;")
            err_lbl.setText("Verificando token de enlace...")
            tok_input.setEnabled(False)
            btn_tok_vis.setEnabled(False)
            btn_back.setEnabled(False)
            btn_next.setEnabled(False)

            def _verify():
                return _agent_api().verify_token(url, token_val)

            def _on_tok_done(result):
                ok, target_dev, err_msg = result
                tok_input.setEnabled(True)
                btn_tok_vis.setEnabled(True)
                btn_back.setEnabled(True)
                btn_next.setEnabled(True)
                err_lbl.setStyleSheet("color: #ef4444; font-size: 12px; font-weight: 600;")
                if ok:
                    err_lbl.setText("")
                    if target_dev:
                        dev_input.setText(target_dev)
                        dev_input.setReadOnly(True)
                        dev_input.setStyleSheet("background: rgba(255,255,255,0.03); color: #818cf8; border: 1px solid rgba(99,102,241,0.35); border-radius: 8px; padding: 11px 14px; font-size: 13px; font-weight: 700;")
                    else:
                        dev_input.setReadOnly(False)
                        dev_input.setStyleSheet("")
                    wiz_step[0] = 2
                    wiz_stack.setCurrentIndex(2)
                    update_step_highlight(2)
                else:
                    err_lbl.setText(err_msg)

            worker_refs.append(run_async(_verify, _on_tok_done, parent=win))

        elif s == 2:
            if not dev_input.text().strip():
                err_lbl.setText("El nombre del dispositivo no puede estar vacío.")
                return
            wiz_step[0] = 3
            wiz_stack.setCurrentIndex(3)
            update_step_highlight(3)
            btn_next.setText("Vincular y Conectar")

        elif s == 3:
            url = url_input.text().strip().rstrip("/")
            device = dev_input.text().strip() or default_device_name
            base_dir = dir_input.text().strip() or default_base_dir

            target_sync_dir = os.path.join(base_dir, "Null-Void-Sync")
            try:
                os.makedirs(target_sync_dir, exist_ok=True)
            except Exception as e:
                err_lbl.setText(f"No se pudo crear la carpeta en ese directorio: {e}")
                return

            btn_next.setText("Conectando...")
            btn_next.setEnabled(False)
            QtWidgets.QApplication.processEvents()

            test_urls = [url]
            if bootstrap_servers:
                test_urls.extend([u for u in bootstrap_servers if u != url])

            tok_val = tok_input.text().strip()
            cfg, err = perform_reg_fn(test_urls, tok_val, device, target_sync_dir)

            if cfg:
                result_config["config"] = cfg
                win.accept()
            else:
                err_lbl.setStyleSheet("color: #ef4444; font-size: 12px; font-weight: 600;")
                err_lbl.setText(clean_error_msg(err or "No se pudo conectar con el servidor."))
                btn_next.setText("Vincular y Conectar")
                btn_next.setEnabled(True)

    btn_back.clicked.connect(on_back)
    btn_next.clicked.connect(on_next)

    win.showNormal()
    win.raise_()
    win.activateWindow()

    if win.exec() == QtWidgets.QDialog.DialogCode.Accepted:
        return result_config["config"]
    return None


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _elapsed_str(client):
    if client.last_sync_time:
        elapsed = int(time.time() - client.last_sync_time)
        if elapsed < 5:
            return "justo ahora"
        if elapsed < 60:
            return f"hace {elapsed}s"
        return f"hace {elapsed // 60} min"
    return "—"


# ─────────────────────────────────────────────────────────────────────────────
# DIÁLOGO — AÑADIR / VINCULAR OTRO PC
# ─────────────────────────────────────────────────────────────────────────────

def open_add_pc_dialog(parent_win, client, QtWidgets, QtCore, QtGui, QtSvg, on_success=None, preselect_dev=None):
    """
    Diálogo de dos pasos para vincular este PC a la nube usando un Token de Enlace:
      Paso 1 – Introducir token  → busca los PCs del usuario en el servidor
      Paso 2 – Seleccionar PC   → elige uno existente o crea uno nuevo
    """

    dlg = QtWidgets.QDialog(parent_win)
    dlg.setWindowTitle("Añadir / Vincular PC")
    dlg.setFixedSize(540, 420)
    dlg.setWindowFlags(
        QtCore.Qt.WindowType.Dialog |
        QtCore.Qt.WindowType.CustomizeWindowHint |
        QtCore.Qt.WindowType.WindowTitleHint |
        QtCore.Qt.WindowType.WindowCloseButtonHint
    )
    dlg.setStyleSheet(f"""
        QDialog {{
            background: {P['bg']};
        }}
        QLabel {{
            color: {P['text']};
        }}
        QLineEdit {{
            background: {P['input_bg']};
            border: 1px solid {P['input_border']};
            border-radius: 8px;
            color: {P['text']};
            padding: 10px 14px;
            font-size: 13px;
            font-family: monospace;
        }}
        QLineEdit:focus {{
            border-color: {P['accent']};
        }}
        QPushButton#primary {{
            background: qlineargradient(x1:0,y1:0,x2:1,y2:0,stop:0 {P['accent']},stop:1 {P['accent2']});
            color: #ffffff;
            border: none;
            border-radius: 8px;
            padding: 10px 22px;
            font-size: 13px;
            font-weight: 700;
        }}
        QPushButton#primary:hover {{ opacity: 0.88; }}
        QPushButton#secondary {{
            background: rgba(255,255,255,0.05);
            color: {P['text_dim']};
            border: 1px solid rgba(255,255,255,0.10);
            border-radius: 8px;
            padding: 10px 18px;
            font-size: 13px;
        }}
        QPushButton#secondary:hover {{
            background: rgba(255,255,255,0.09);
            color: {P['text']};
        }}
        QListWidget {{
            background: #161d2f;
            border: 1px solid rgba(99,102,241,0.25);
            border-radius: 10px;
            color: #ffffff;
            font-size: 13px;
            outline: none;
            padding: 4px;
        }}
        QListWidget::item {{
            padding: 10px 14px;
            border-radius: 6px;
            color: #e8edf8;
            font-weight: 600;
        }}
        QListWidget::item:selected, QListWidget::item:selected:hover {{
            background: rgba(99,102,241,0.35);
            color: #ffffff;
            border: 1px solid rgba(99,102,241,0.55);
        }}
        QListWidget::item:hover:!selected {{
            background: rgba(255,255,255,0.06);
            color: #ffffff;
        }}
    """)

    root_l = QtWidgets.QVBoxLayout(dlg)
    root_l.setContentsMargins(28, 28, 28, 24)
    root_l.setSpacing(0)

    stack = QtWidgets.QStackedWidget()
    root_l.addWidget(stack)

    # ── ESTADO COMPARTIDO ──
    state = {"token": "", "devices": [], "username": "", "workers": []}

    # ──────────────────────────────────────────
    # PASO 1: Introducir Token
    # ──────────────────────────────────────────
    page1 = QtWidgets.QWidget()
    p1l = QtWidgets.QVBoxLayout(page1)
    p1l.setSpacing(14)

    lbl_title1 = QtWidgets.QLabel("Vincular nuevo PC")
    lbl_title1.setStyleSheet("font-size: 17px; font-weight: 800; color: #e8edf8; margin-bottom: 2px;")
    p1l.addWidget(lbl_title1)

    lbl_sub1 = QtWidgets.QLabel(
        "Genera un <b>Token de Enlace</b> desde el panel web "
        "(Panel de Control → botón derecho sobre un PC → Generar Token) "
        "e introdúcelo aquí."
    )
    lbl_sub1.setWordWrap(True)
    lbl_sub1.setStyleSheet(f"font-size: 12px; color: {P['text_dim']}; line-height: 1.5; margin-bottom: 6px;")
    p1l.addWidget(lbl_sub1)

    tok_input = QtWidgets.QLineEdit()
    tok_input.setPlaceholderText("Pega aquí el token de enlace…")
    tok_input.setMinimumHeight(44)
    tok_input.setEchoMode(QtWidgets.QLineEdit.EchoMode.Password)
    btn_tok_vis = QtWidgets.QPushButton("Mostrar")
    btn_tok_vis.setObjectName("secondary")
    btn_tok_vis.setMinimumHeight(44)
    btn_tok_vis.setFixedWidth(84)
    btn_tok_vis.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)

    def toggle_tok_visibility():
        hidden = tok_input.echoMode() == QtWidgets.QLineEdit.EchoMode.Password
        tok_input.setEchoMode(
            QtWidgets.QLineEdit.EchoMode.Normal if hidden else QtWidgets.QLineEdit.EchoMode.Password
        )
        btn_tok_vis.setText("Ocultar" if hidden else "Mostrar")

    btn_tok_vis.clicked.connect(toggle_tok_visibility)
    tok_row = QtWidgets.QHBoxLayout()
    tok_row.setSpacing(8)
    tok_row.addWidget(tok_input, 1)
    tok_row.addWidget(btn_tok_vis)
    p1l.addLayout(tok_row)

    err1_lbl = QtWidgets.QLabel("")
    err1_lbl.setStyleSheet("color: #f87171; font-size: 12px; font-weight: 600;")
    err1_lbl.setWordWrap(True)
    p1l.addWidget(err1_lbl)

    p1l.addStretch(1)

    btn_row1 = QtWidgets.QHBoxLayout()
    btn_cancel1 = QtWidgets.QPushButton("Cancelar")
    btn_cancel1.setObjectName("secondary")
    btn_next1 = QtWidgets.QPushButton("Siguiente →")
    btn_next1.setObjectName("primary")
    btn_next1.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
    btn_cancel1.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
    btn_row1.addWidget(btn_cancel1)
    btn_row1.addStretch(1)
    btn_row1.addWidget(btn_next1)
    p1l.addLayout(btn_row1)

    stack.addWidget(page1)

    # ──────────────────────────────────────────
    # PASO 2: Seleccionar / crear PC
    # ──────────────────────────────────────────
    page2 = QtWidgets.QWidget()
    p2l = QtWidgets.QVBoxLayout(page2)
    p2l.setSpacing(12)

    lbl_title2 = QtWidgets.QLabel("Selecciona un PC")
    lbl_title2.setStyleSheet("font-size: 17px; font-weight: 800; color: #e8edf8; margin-bottom: 2px;")
    p2l.addWidget(lbl_title2)

    lbl_sub2 = QtWidgets.QLabel("Elige un PC existente para sincronizar en él, o crea uno nuevo.")
    lbl_sub2.setStyleSheet(f"font-size: 12px; color: {P['text_dim']}; margin-bottom: 4px;")
    p2l.addWidget(lbl_sub2)

    pc_list = QtWidgets.QListWidget()
    pc_list.setMinimumHeight(140)
    p2l.addWidget(pc_list)

    err2_lbl = QtWidgets.QLabel("")
    err2_lbl.setStyleSheet("color: #f87171; font-size: 12px; font-weight: 600;")
    err2_lbl.setWordWrap(True)
    p2l.addWidget(err2_lbl)

    btn_row2 = QtWidgets.QHBoxLayout()
    btn_row2.setSpacing(8)
    btn_back2 = QtWidgets.QPushButton("← Atrás")
    btn_back2.setObjectName("secondary")
    btn_connect = QtWidgets.QPushButton("Conectar")
    btn_connect.setObjectName("primary")
    btn_unlink = QtWidgets.QPushButton("Desvincular")
    btn_unlink.setStyleSheet("background: rgba(239, 68, 68, 0.12); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 8px; padding: 10px 16px; font-weight: 700; font-size: 13px;")
    btn_unlink.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
    btn_connect.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
    btn_back2.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
    btn_row2.addWidget(btn_back2)
    btn_row2.addStretch(1)
    btn_row2.addWidget(btn_connect)
    btn_row2.addWidget(btn_unlink)
    p2l.addLayout(btn_row2)

    stack.addWidget(page2)

    # ── LÓGICA ──

    def populate_pc_list_items(devs, target_device=None):
        pc_list.clear()
        selected_row = 0
        target_match = preselect_dev or target_device or getattr(client, 'device_name', '')
        
        # Eliminar cualquier duplicado manteniendo el orden
        seen = set()
        unique_devs = []
        for d in devs:
            name = d.get('name') if isinstance(d, dict) else str(d)
            if name not in seen:
                seen.add(name)
                unique_devs.append(d)

        for idx, dev in enumerate(unique_devs):
            dev_name = dev.get('name') if isinstance(dev, dict) else str(dev)
            dev_os = dev.get('os', 'Linux') if isinstance(dev, dict) else 'Linux'
            item = QtWidgets.QListWidgetItem(f"  {dev_name}  ({dev_os})")
            item.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS["pc"], size=16, color="#818cf8"))
            item.setData(QtCore.Qt.ItemDataRole.UserRole, dev_name)
            item.setForeground(QtGui.QColor("#e8edf8"))
            pc_list.addItem(item)
            if target_match and dev_name.lower() == target_match.lower():
                selected_row = idx

        new_item = QtWidgets.QListWidgetItem("  +  Crear nuevo PC")
        new_item.setData(QtCore.Qt.ItemDataRole.UserRole, "__new__")
        new_item.setForeground(QtGui.QColor("#818cf8"))
        pc_list.addItem(new_item)
        if pc_list.count() > 0:
            pc_list.setCurrentRow(selected_row)

    def load_user_devices(override_token=None, use_my_devices=False):
        server_url = None
        if hasattr(client, 'server_urls') and client.server_urls:
            server_url = client.server_urls[0]
        elif hasattr(client, 'server_url') and client.server_url:
            server_url = client.server_url

        tok = override_token or getattr(client, 'token', '') or state.get('token', '')

        # Precargar computadoras conocidas sin duplicados
        curr = getattr(client, 'device_name', '')
        known_devs = getattr(client, 'known_devices', []) or ([curr] if curr else [])
        populate_pc_list_items(known_devs)

        if not server_url:
            msg = "No se pudo detectar la URL del servidor. Mostrando equipos conocidos localmente."
            if stack.currentIndex() == 1:
                err2_lbl.setStyleSheet("color: #f87171; font-size: 12px; font-weight: 600;")
                err2_lbl.setText(msg)
            else:
                err1_lbl.setStyleSheet("color: #f87171; font-size: 12px; font-weight: 600;")
                err1_lbl.setText(msg)
                stack.setCurrentIndex(0)
            return

        if not tok and not use_my_devices:
            # Sin token no hay nada que consultar: no se llama a la API. En modo
            # preselección (clic en un PC del sidebar) se mantiene la lista local;
            # si se vino desde el botón "Siguiente" de la pág. 1 se pide el token.
            if stack.currentIndex() == 1:
                err2_lbl.setStyleSheet("color: #fbbf24; font-size: 12px; font-weight: 600;")
                err2_lbl.setText(
                    "Mostrando equipos conocidos localmente. Para ver/actualizar la lista "
                    "desde la nube, elige «Añadir nuevo PC» e introduce el Token de Enlace."
                )
            else:
                err1_lbl.setStyleSheet("color: #818cf8; font-size: 12px; font-weight: 600;")
                err1_lbl.setText("Introduce el Token de Enlace en el campo de arriba y pulsa Siguiente.")
            return

        err1_lbl.setStyleSheet("color: #818cf8; font-size: 12px; font-weight: 600;")
        err1_lbl.setText("Verificando...")
        btn_next1.setEnabled(False)

        def _load_devs():
            try:
                if use_my_devices:
                    data = _agent_api().my_devices(server_url, getattr(client, 'token', '') or '')
                else:
                    data = _agent_api().list_devices(
                        server_url, tok,
                        bearer_token=getattr(client, 'token', None),
                    )
                return data.get("devices", []), data.get("username", ""), data.get("target_device", "")
            except Exception as e:
                return e

        def _on_devs_done(result):
            btn_next1.setEnabled(True)
            if isinstance(result, Exception):
                if use_my_devices:
                    # Flujo de selección (clic en un PC del sidebar): se conserva la
                    # lista local ya precargada y no se muestra el error, porque el
                    # token de dispositivo no es válido para list-devices.
                    err2_lbl.setText("")
                    return
                msg = clean_error_msg(f"Error: {result}")
                if stack.currentIndex() == 1:
                    err2_lbl.setStyleSheet("color: #f87171; font-size: 12px; font-weight: 600;")
                    err2_lbl.setText(msg)
                else:
                    err1_lbl.setStyleSheet("color: #f87171; font-size: 12px; font-weight: 600;")
                    err1_lbl.setText(msg)
                return
            devs, uname, target_device = result
            err1_lbl.setText("")
            err2_lbl.setText("")
            state["devices"] = devs
            state["username"] = uname
            state["token"] = tok
            populate_pc_list_items(devs, target_device=target_device)
            stack.setCurrentIndex(1)

        state["workers"].append(run_async(_load_devs, _on_devs_done, parent=dlg))

    def go_step2():
        token = tok_input.text().strip()
        if not token:
            err1_lbl.setText("El token no puede estar vacío.")
            return
        load_user_devices(override_token=token)

    def on_list_selection():
        selected = pc_list.currentItem()
        if selected:
            val = selected.data(QtCore.Qt.ItemDataRole.UserRole)
            if val == "__new__":
                btn_back2.setVisible(True)
                tok_input.clear()
                stack.setCurrentIndex(0)

    def do_connect():
        selected = pc_list.currentItem()
        if not selected:
            err2_lbl.setText("Selecciona un PC de la lista.")
            return
        device_name = selected.data(QtCore.Qt.ItemDataRole.UserRole)
        if device_name == "__new__":
            btn_back2.setVisible(True)
            tok_input.clear()
            stack.setCurrentIndex(0)
            return

        # Si ya estamos autenticados en el cliente y seleccionamos un PC existente, conmutar directamente
        if getattr(client, 'token', None):
            client.device_name = device_name
            if hasattr(client, 'config') and isinstance(client.config, dict):
                client.config["device_name"] = device_name
                try:
                    from agent import save_config
                    save_config(client.config)
                except Exception:
                    pass
            dlg.accept()
            if on_success:
                on_success(device_name)
            return

        token = state["token"]
        server_url = None
        if hasattr(client, 'server_urls') and client.server_urls:
            server_url = client.server_urls[0]
        elif hasattr(client, 'server_url') and client.server_url:
            server_url = client.server_url

        err2_lbl.setStyleSheet("color: #818cf8; font-size: 12px; font-weight: 600;")
        err2_lbl.setText("Conectando…")
        btn_connect.setEnabled(False)

        def _register():
            try:
                api = _agent_api()
                res = api.register_device(server_url, token, device_name, platform.system())
                return res, getattr(api, 'last_cert_fingerprint', None)
            except Exception as e:
                return e, None

        def _on_reg_done(result):
            btn_connect.setEnabled(True)
            if isinstance(result, Exception):
                err2_lbl.setStyleSheet("color: #f87171; font-size: 12px; font-weight: 600;")
                err2_lbl.setText(clean_error_msg(f"Error: {result}"))
                return
            res_data, cert_fp = result
            if not isinstance(res_data, dict):
                err2_lbl.setStyleSheet("color: #f87171; font-size: 12px; font-weight: 600;")
                err2_lbl.setText(clean_error_msg(f"Error: {res_data}"))
                return
            if cert_fp and not getattr(client, 'cert_hash', None):
                try:
                    from agent import save_config
                    cfg = getattr(client, 'config', None)
                    if isinstance(cfg, dict) and not cfg.get('cert_hash'):
                        mb = QtWidgets.QMessageBox(dlg)
                        mb.setWindowTitle("Confianza del certificado SSL")
                        mb.setIcon(QtWidgets.QMessageBox.Icon.Question)
                        mb.setText(
                            "El servidor usa un certificado SSL autofirmado.\n\n"
                            f"Huella SHA-256:\n{cert_fp}\n\n"
                            "¿Confiar en este servidor y guardar su huella para "
                            "detectar posibles suplantaciones en futuras conexiones?"
                        )
                        trust_btn = mb.addButton("Confiar y guardar", QtWidgets.QMessageBox.ButtonRole.AcceptRole)
                        no_btn = mb.addButton("No confiar", QtWidgets.QMessageBox.ButtonRole.RejectRole)
                        mb.exec()
                        if mb.clickedButton() is trust_btn:
                            cfg["cert_hash"] = cert_fp
                            save_config(cfg)
                            try:
                                client.cert_hash = cert_fp
                            except Exception:
                                pass
                        elif mb.clickedButton() is no_btn:
                            dlg.accept()
                            return
                except Exception:
                    pass
            dlg.accept()
            if on_success:
                on_success(res_data.get("device_name", ""))

        state["workers"].append(run_async(_register, _on_reg_done, parent=dlg))

    confirm_dialog = _make_confirm_dialog(QtWidgets, QtCore)

    def _unlink_and_redirect():
        """Desvincula el dispositivo (borra la configuración local) y cierra la
        GUI; el bucle principal de agent.py reabre el asistente de configuración."""
        try:
            client.stop_event.set()
        except Exception:
            pass
        try:
            from agent import delete_config
            delete_config()
        except Exception:
            pass
        app = QtWidgets.QApplication.instance()
        if app is not None:
            app.quit()

    def do_unlink():
        dlg.accept()
        if not confirm_dialog(
            parent_win,
            "Desvincular Dispositivo",
            "¿Estás seguro de que deseas desvincular este dispositivo de tu cuenta Null-Void Cloud?",
            yes_text="Sí, desvincular",
            no_text="No",
        ):
            return

        remaining = _remaining_devices(client)
        if remaining is not None and remaining <= 1:
            proceed = confirm_dialog(
                parent_win,
                "Último dispositivo vinculado",
                "«{dev}» es el único dispositivo registrado en tu cuenta. Al desvincularlo "
                "la cuenta quedará sin equipos sincronizados.\n\n"
                "Si continúas, serás enviado al asistente de configuración inicial, donde "
                "deberás vincular un nuevo dispositivo.".format(dev=getattr(client, 'device_name', '') or 'Este equipo'),
                yes_text="Desvincular e ir al asistente",
                no_text="Cancelar",
            )
            if not proceed:
                return

        _unlink_and_redirect()

    btn_cancel1.clicked.connect(dlg.reject)
    btn_next1.clicked.connect(go_step2)
    tok_input.returnPressed.connect(go_step2)
    btn_back2.clicked.connect(lambda: stack.setCurrentIndex(0))
    btn_connect.clicked.connect(do_connect)
    btn_unlink.clicked.connect(do_unlink)
    pc_list.currentRowChanged.connect(on_list_selection)

    if preselect_dev:
        stack.setCurrentIndex(1)
        btn_back2.setVisible(False)
        # Lista de PCs del usuario vía token de dispositivo (Bearer): sin necesidad
        # de un nuevo Token de Enlace. Si falla, se conserva la lista local.
        load_user_devices(use_my_devices=True)
    else:
        # Sin dispositivo preseleccionado: siempre empezar pidiendo el token,
        # para no validar/consulta nada antes de que el usuario introduzca datos.
        stack.setCurrentIndex(0)
    dlg.exec()


def _make_main_window_cls(QtWidgets, QtCore):
    """Subclase real de QMainWindow: bloquea maximizar/pantalla completa y
    delega el cierre en el handler asignado (sin monkey-parchear instancias)."""
    class NullVoidMainWindow(QtWidgets.QMainWindow):
        _close_handler = None

        def changeEvent(self, event):
            if event.type() == QtCore.QEvent.Type.WindowStateChange:
                state = self.windowState()
                if state & (QtCore.Qt.WindowState.WindowMaximized | QtCore.Qt.WindowState.WindowFullScreen):
                    self.setWindowState(QtCore.Qt.WindowState.WindowNoState)
            super().changeEvent(event)

        def closeEvent(self, event):
            if self._close_handler is not None:
                self._close_handler(event)
            else:
                super().closeEvent(event)

    return NullVoidMainWindow


# ─────────────────────────────────────────────────────────────────────────────
# DASHBOARD PRINCIPAL — ESTILO CLOUD
# ─────────────────────────────────────────────────────────────────────────────

def launch_native_qt_gui(client, local_dir, open_folder_cb, log_queue, logout_cb=None):
    try:
        from PySide6 import QtCore, QtGui, QtWidgets, QtSvg
    except ImportError:
        try:
            from PyQt6 import QtCore, QtGui, QtWidgets, QtSvg
        except ImportError:
            try:
                from PyQt5 import QtCore, QtGui, QtWidgets, QtSvg
            except ImportError:
                return False

    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication(sys.argv[:1])
    app.setQuitOnLastWindowClosed(False)

    NullVoidMainWindow = _make_main_window_cls(QtWidgets, QtCore)
    win = NullVoidMainWindow()
    win.setWindowTitle(f"Null-Void Cloud — {client.device_name}")
    win.setWindowIcon(_make_tray_icon(QtGui))
    # Ventana principal: sin botón de maximizar y sin redimensionado
    # (setFixedSize fija el tamaño; el flag elimina el botón de maximizar del WM)
    win.setFixedSize(1280, 800)
    flags = (
        QtCore.Qt.WindowType.Window |
        QtCore.Qt.WindowType.CustomizeWindowHint |
        QtCore.Qt.WindowType.WindowTitleHint |
        QtCore.Qt.WindowType.WindowCloseButtonHint |
        QtCore.Qt.WindowType.WindowMinimizeButtonHint
    )
    win.setWindowFlags(flags)

    # Centrado automatico en pantalla
    screen = app.primaryScreen()
    if screen:
        geo = screen.availableGeometry()
        win.move(geo.center() - win.rect().center())

    central = QtWidgets.QWidget()
    win.setCentralWidget(central)
    root = QtWidgets.QHBoxLayout(central)
    root.setContentsMargins(0, 0, 0, 0)
    root.setSpacing(0)

    win.setStyleSheet(SHARED_STYLE)

    # ═══ SIDEBAR ════════════════════════════════════════════════════════════════
    sidebar = QtWidgets.QFrame()
    sidebar.setObjectName("sidebar")
    sidebar.setFixedWidth(240)
    side_l = QtWidgets.QVBoxLayout(sidebar)
    side_l.setContentsMargins(0, 0, 0, 0)
    side_l.setSpacing(0)

    # Logo header
    logo_header = QtWidgets.QWidget()
    logo_header.setStyleSheet("background: #0f1422; border-bottom: 1px solid rgba(255,255,255,0.07);")
    logo_header.setFixedHeight(58)
    logo_h_l = QtWidgets.QHBoxLayout(logo_header)
    logo_h_l.setContentsMargins(16, 0, 16, 0)
    logo_pm_lbl = QtWidgets.QLabel()
    logo_pm_lbl.setPixmap(_make_logo_pixmap(QtGui, 28))
    logo_name = QtWidgets.QLabel("Null-Void Cloud")
    logo_name.setStyleSheet("font-size: 15px; font-weight: 700; color: #818cf8;")
    logo_h_l.addWidget(logo_pm_lbl)
    logo_h_l.addSpacing(8)
    logo_h_l.addWidget(logo_name)
    logo_h_l.addStretch(1)
    side_l.addWidget(logo_header)

    # Nav
    nav_scroll = QtWidgets.QScrollArea()
    nav_scroll.setWidgetResizable(True)
    nav_scroll.setFrameShape(QtWidgets.QFrame.Shape.NoFrame)
    nav_scroll.setStyleSheet("background: transparent;")
    nav_inner = QtWidgets.QWidget()
    nav_inner.setStyleSheet("background: transparent;")
    nav_l = QtWidgets.QVBoxLayout(nav_inner)
    nav_l.setContentsMargins(10, 16, 10, 16)
    nav_l.setSpacing(2)

    nav_section_style = "font-size: 10px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; padding: 8px 10px 4px;"

    def make_sec_label(text):
        lbl = QtWidgets.QLabel(text)
        lbl.setStyleSheet(nav_section_style)
        return lbl

    nav_l.addWidget(make_sec_label("PRINCIPAL"))

    nav_btns = []

    def make_nav_btn(svg_key, label, page_idx):
        btn = QtWidgets.QPushButton(f"  {label}")
        if svg_key in SVG_ICONS:
            icon = _svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS[svg_key], size=16, color="#8b95b0")
            btn.setIcon(icon)
            btn.setIconSize(QtCore.QSize(16, 16))
        btn.setObjectName("nav_btn")
        btn.setMinimumHeight(38)
        btn.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
        nav_l.addWidget(btn)
        nav_btns.append((btn, page_idx, svg_key))
        return btn

    btn_dashboard = make_nav_btn("dashboard", "Panel de Control", 0)
    btn_logs_nav = make_nav_btn("console", "Consola de Actividad", 1)

    nav_l.addStretch(1)

    # Sección de Computadoras Guardadas debajo de la navegación principal
    nav_l.addWidget(make_sec_label("MIS COMPUTADORAS"))
    
    pc_list_container = QtWidgets.QVBoxLayout()
    pc_list_container.setSpacing(2)
    pc_list_container.setContentsMargins(0, 0, 0, 0)
    nav_l.addLayout(pc_list_container)

    def populate_sidebar_pcs(device_names=None):
        # Limpiar lista anterior
        while pc_list_container.count():
            child = pc_list_container.takeAt(0)
            if child.widget():
                child.widget().deleteLater()
        
        target_devs = device_names or [client.device_name]
        for dev_name in target_devs:
            is_current = (dev_name == client.device_name)
            pc_btn = QtWidgets.QPushButton(f"  {dev_name}")
            pc_icon_color = "#10b981" if is_current else "#8b95b0"
            pc_btn.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS["pc"], size=15, color=pc_icon_color))
            pc_btn.setMinimumHeight(34)
            pc_btn.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
            
            if is_current:
                pc_btn.setStyleSheet("""
                    QPushButton {
                        background: rgba(16, 185, 129, 0.12);
                        color: #10b981;
                        border: 1px solid rgba(16, 185, 129, 0.30);
                        border-radius: 6px;
                        padding: 6px 12px;
                        text-align: left;
                        font-size: 12px;
                        font-weight: 700;
                        margin: 0 4px;
                    }
                """)
            else:
                pc_btn.setStyleSheet("""
                    QPushButton {
                        background: transparent;
                        color: #8b95b0;
                        border: none;
                        border-radius: 6px;
                        padding: 6px 12px;
                        text-align: left;
                        font-size: 12px;
                        font-weight: 500;
                        margin: 0 4px;
                    }
                    QPushButton:hover {
                        background: rgba(255,255,255,0.06);
                        color: #e8edf8;
                    }
                """)
            def _make_switch_cb(name=dev_name):
                def _cb():
                    def _on_switched(new_name):
                        client.device_name = new_name
                        v_device.setText(str(new_name))
                        win.setWindowTitle(f"Null-Void Cloud — {new_name}")
                        populate_sidebar_pcs()
                        log_queue.put(f"[{time.strftime('%H:%M:%S')}] Conectado a PC: {new_name}")
                        if hasattr(client, 'initial_sync') and not client.paused:
                            threading.Thread(target=client.initial_sync, daemon=True).start()
                    open_add_pc_dialog(win, client, QtWidgets, QtCore, QtGui, QtSvg, on_success=_on_switched, preselect_dev=name)
                return _cb
            pc_btn.clicked.connect(_make_switch_cb(dev_name))
            pc_list_container.addWidget(pc_btn)

    populate_sidebar_pcs()
    nav_scroll.setWidget(nav_inner)
    side_l.addWidget(nav_scroll, 1)

    # Perfil al fondo
    profile_widget = QtWidgets.QWidget()
    profile_widget.setStyleSheet("background: #0f1422; border-top: 1px solid rgba(255,255,255,0.07);")
    profile_l = QtWidgets.QHBoxLayout(profile_widget)
    profile_l.setContentsMargins(14, 12, 14, 12)
    profile_l.setSpacing(8)

    avatar_lbl = QtWidgets.QLabel()
    avatar_lbl.setPixmap(_make_logo_pixmap(QtGui, 32))
    profile_texts = QtWidgets.QVBoxLayout()
    profile_texts.setSpacing(2)
    profile_name = QtWidgets.QLabel(str(client.username))
    profile_name.setStyleSheet("font-size: 12px; font-weight: 700; color: #e8edf8;")
    status_lbl = QtWidgets.QLabel("● Conectado")
    status_lbl.setStyleSheet("font-size: 11px; font-weight: 600; color: #10b981;")
    profile_texts.addWidget(profile_name)
    profile_texts.addWidget(status_lbl)
    profile_l.addWidget(avatar_lbl)
    profile_l.addLayout(profile_texts)
    profile_l.addStretch(1)

    # Botón + para añadir PC (a la izquierda del icono rojo de salir)
    btn_add_pc = QtWidgets.QPushButton()
    btn_add_pc.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS["plus"], size=14, color="#818cf8"))
    btn_add_pc.setToolTip("Añadir / Vincular otro PC")
    btn_add_pc.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
    btn_add_pc.setFixedSize(28, 28)
    btn_add_pc.setStyleSheet("""
        QPushButton {
            background: rgba(99, 102, 241, 0.10);
            border: 1px solid rgba(99, 102, 241, 0.25);
            border-radius: 6px;
        }
        QPushButton:hover {
            background: rgba(99, 102, 241, 0.25);
            border-color: #818cf8;
        }
    """)
    profile_l.addWidget(btn_add_pc)

    btn_logout = QtWidgets.QPushButton()
    btn_logout.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS["logout"], size=14, color="#ef4444"))
    btn_logout.setToolTip("Desvincular este dispositivo")
    btn_logout.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)
    btn_logout.setFixedSize(28, 28)
    btn_logout.setStyleSheet("""
        QPushButton {
            background: transparent;
            border: 1px solid rgba(239, 68, 68, 0.22);
            border-radius: 6px;
        }
        QPushButton:hover {
            background: rgba(239, 68, 68, 0.18);
            border-color: #ef4444;
        }
    """)
    profile_l.addWidget(btn_logout)
    side_l.addWidget(profile_widget)

    root.addWidget(sidebar)

    # ═══ AREA PRINCIPAL ══════════════════════════════════════════════════════════
    main_area = QtWidgets.QWidget()
    main_l = QtWidgets.QVBoxLayout(main_area)
    main_l.setContentsMargins(0, 0, 0, 0)
    main_l.setSpacing(0)

    # Topbar
    topbar = QtWidgets.QFrame()
    topbar.setObjectName("topbar")
    topbar.setFixedHeight(58)
    top_l = QtWidgets.QHBoxLayout(topbar)
    top_l.setContentsMargins(24, 0, 24, 0)

    page_title_lbl = QtWidgets.QLabel("Panel de Control")
    page_title_lbl.setStyleSheet("font-size: 16px; font-weight: 800; color: #e8edf8;")
    top_l.addWidget(page_title_lbl)
    top_l.addStretch(1)
    main_l.addWidget(topbar)

    page_stack = QtWidgets.QStackedWidget()
    main_l.addWidget(page_stack, 1)

    # ─── PAGINA 0: DASHBOARD ─────────────────────────────────────────────────
    pg_dash = QtWidgets.QWidget()
    pg_dash_l = QtWidgets.QVBoxLayout(pg_dash)
    pg_dash_l.setContentsMargins(24, 20, 24, 20)
    pg_dash_l.setSpacing(14)

    # Tarjeta info dispositivo
    info_card = QtWidgets.QFrame()
    info_card.setObjectName("card")
    info_grid = QtWidgets.QGridLayout(info_card)
    info_grid.setContentsMargins(20, 16, 20, 16)
    info_grid.setVerticalSpacing(10)
    info_grid.setHorizontalSpacing(20)

    def info_row(label_text, row):
        lbl = QtWidgets.QLabel(label_text)
        lbl.setStyleSheet("color: #cbd5e1; font-size: 13px; font-weight: 600;")
        val = QtWidgets.QLabel("—")
        val.setStyleSheet("color: #ffffff; font-size: 13px; font-weight: 700;")
        val.setTextInteractionFlags(QtCore.Qt.TextInteractionFlag.TextSelectableByMouse)
        val.setWordWrap(True)
        info_grid.addWidget(lbl, row, 0)
        info_grid.addWidget(val, row, 1)
        return val

    v_device = info_row("Dispositivo Activo", 0)
    v_server = info_row("Servidor Nube", 1)
    v_dir = info_row("Carpeta Sincronizada", 2)
    v_last = info_row("Ultima Sincronizacion", 3)
    pg_dash_l.addWidget(info_card)



    # Botones de accion en la vista principal
    action_row = QtWidgets.QHBoxLayout()
    action_row.setSpacing(12)

    btn_pause = QtWidgets.QPushButton("  Pausar Sincronización")
    btn_pause.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS["pause"], size=16, color="#e8edf8"))
    btn_pause.setIconSize(QtCore.QSize(16, 16))
    btn_pause.setObjectName("action")
    btn_pause.setMinimumHeight(42)
    btn_pause.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)

    btn_sync = QtWidgets.QPushButton("  Sincronizar Ahora")
    btn_sync.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS["sync"], size=16, color="#ffffff"))
    btn_sync.setIconSize(QtCore.QSize(16, 16))
    btn_sync.setObjectName("primary")
    btn_sync.setMinimumHeight(42)
    btn_sync.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)

    btn_folder = QtWidgets.QPushButton("  Abrir Carpeta Local")
    btn_folder.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS["folder"], size=16, color="#e8edf8"))
    btn_folder.setIconSize(QtCore.QSize(16, 16))
    btn_folder.setObjectName("action")
    btn_folder.setMinimumHeight(42)
    btn_folder.setCursor(QtCore.Qt.CursorShape.PointingHandCursor)

    action_row.addWidget(btn_pause)
    action_row.addWidget(btn_sync)
    action_row.addWidget(btn_folder)
    action_row.addStretch(1)
    pg_dash_l.addLayout(action_row)

    # Log mini
    log_hdr = QtWidgets.QLabel("ACTIVIDAD RECIENTE")
    log_hdr.setStyleSheet("font-size: 10px; font-weight: 800; color: #4e5870; letter-spacing: 0.08em; margin-top: 2px;")
    pg_dash_l.addWidget(log_hdr)
    log_mini = QtWidgets.QPlainTextEdit()
    log_mini.setReadOnly(True)
    log_mini.setMaximumBlockCount(200)
    pg_dash_l.addWidget(log_mini, 1)

    page_stack.addWidget(pg_dash)

    # ─── PAGINA 1: CONSOLA FULL ───────────────────────────────────────────────
    pg_logs = QtWidgets.QWidget()
    pg_logs_l = QtWidgets.QVBoxLayout(pg_logs)
    pg_logs_l.setContentsMargins(24, 20, 24, 20)
    log_full = QtWidgets.QPlainTextEdit()
    log_full.setReadOnly(True)
    log_full.setMaximumBlockCount(1000)
    pg_logs_l.addWidget(log_full, 1)
    page_stack.addWidget(pg_logs)

    root.addWidget(main_area, 1)

    # ─── Logica navegacion ────────────────────────────────────────────────────
    def set_page(idx):
        if idx < 0:
            return
        page_stack.setCurrentIndex(idx)
        titles = ["Panel de Control", "Consola de Actividad"]
        page_title_lbl.setText(titles[idx] if idx < len(titles) else "")
        for btn, bidx, svg_key in nav_btns:
            if bidx == idx:
                if svg_key in SVG_ICONS:
                    btn.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS[svg_key], size=16, color="#ffffff"))
                btn.setStyleSheet("""
                    background: rgba(129,140,248,0.25);
                    color: #ffffff;
                    border: none;
                    border-radius: 8px;
                    padding: 10px 14px;
                    text-align: left;
                    font-size: 13px;
                    font-weight: 700;
                """)
            else:
                if svg_key in SVG_ICONS:
                    btn.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS[svg_key], size=16, color="#8b95b0"))
                btn.setStyleSheet("")

    def toggle_pause_sync():
        is_paused = client.toggle_pause()
        txt = "  Reanudar Sincronización" if is_paused else "  Pausar Sincronización"
        icon_key = "play" if is_paused else "pause"
        
        btn_pause.setText(txt)
        btn_pause.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS[icon_key], size=16, color="#e8edf8"))
        if not is_paused and hasattr(client, 'initial_sync'):
            threading.Thread(target=client.initial_sync, daemon=True).start()

    def sync_now():
        if not client.paused and hasattr(client, 'initial_sync'):
            threading.Thread(target=client.initial_sync, daemon=True).start()

    def open_folder():
        try:
            open_folder_cb()
        except Exception as e:
            log_queue.put(f"[{time.strftime('%H:%M:%S')}] Error al abrir la carpeta local: {e}")

    confirm_dialog = _make_confirm_dialog(QtWidgets, QtCore)

    def _finish_unlink():
        client.stop_event.set()
        if logout_cb:
            logout_cb()
        if tray:
            tray.hide()
        app.quit()

    def _redirect_if_last_device():
        """Bloquea la desvinculación si es el único dispositivo de la cuenta.

        Devuelve True si se aplicó el bloqueo (no procede desvincular);
        en ese caso, si el usuario lo confirma, se desvincula y el bucle
        principal de agent.py reabre el asistente de configuración inicial.
        """
        remaining = _remaining_devices(client)
        if remaining is None or remaining > 1:
            return False

        go_wizard = confirm_dialog(
            win,
            "Último dispositivo vinculado",
            f"«{client.device_name}» es el único dispositivo registrado en tu cuenta. "
            "Si lo desvinculas, la cuenta quedará sin equipos sincronizados.\n\n"
            "Para continuar, serás enviado al asistente de configuración inicial, donde "
            "deberás vincular un nuevo dispositivo.",
            yes_text="Ir al asistente de vinculación",
            no_text="Cancelar",
        )
        if go_wizard:
            _finish_unlink()
        return True

    def confirm_logout():
        if not confirm_dialog(
            win,
            "Desvincular Dispositivo",
            "¿Estás seguro de que deseas desvincular este dispositivo y cerrar sesión?\n\n"
            "Deberás ingresar un nuevo Token de Enlace para conectar este equipo.",
            yes_text="Sí, desvincular",
            no_text="Cancelar",
        ):
            return
        if _redirect_if_last_device():
            return
        _finish_unlink()

    btn_logout.clicked.connect(confirm_logout)

    def open_add_pc():
        def _on_pc_linked(new_name):
            client.device_name = new_name
            if hasattr(client, 'config') and isinstance(client.config, dict):
                client.config["device_name"] = new_name
            v_device.setText(str(new_name))
            win.setWindowTitle(f"Null-Void Cloud — {new_name}")
            log_queue.put(f"[{time.strftime('%H:%M:%S')}] Conectado a PC: {new_name}")
            # Actualizar sidebar con los PCs conocidos
            current_pcs = set([client.device_name, new_name])
            populate_sidebar_pcs(list(current_pcs))

        open_add_pc_dialog(win, client, QtWidgets, QtCore, QtGui, QtSvg, on_success=_on_pc_linked)

    btn_add_pc.clicked.connect(open_add_pc)

    for btn, pidx, _ in nav_btns:
        if pidx >= 0:
            btn.clicked.connect(lambda checked=False, i=pidx: set_page(i))

    btn_pause.clicked.connect(toggle_pause_sync)
    btn_sync.clicked.connect(sync_now)
    btn_folder.clicked.connect(open_folder)

    set_page(0)

    # Tray
    tray = None
    if QtWidgets.QSystemTrayIcon.isSystemTrayAvailable():
        try:
            tray = QtWidgets.QSystemTrayIcon(_make_tray_icon(QtGui), win)
            tray.setToolTip(f"Null-Void Cloud — {client.device_name}")
            tray_menu = QtWidgets.QMenu()
            tray_menu.addAction("Mostrar Panel").triggered.connect(
                lambda: (win.showNormal(), win.raise_(), win.activateWindow())
            )
            tray_menu.addAction("Pausar / Reanudar").triggered.connect(toggle_pause_sync)
            tray_menu.addAction("Sincronizar Ahora").triggered.connect(sync_now)
            tray_menu.addAction("Abrir Carpeta Local").triggered.connect(open_folder)
            tray_menu.addSeparator()
            tray_menu.addAction("Salir").triggered.connect(lambda: (client.stop_event.set(), tray and tray.hide(), app.quit()))
            tray.setContextMenu(tray_menu)
            tray.show()
        except Exception:
            tray = None

    def close_to_tray(event):
        if tray and tray.isVisible():
            event.ignore()
            win.hide()
            tray.showMessage("Null-Void Cloud", "Sincronizando en segundo plano.", QtGui.QIcon(), 2000)
        else:
            client.stop_event.set()
            app.quit()

    win._close_handler = close_to_tray

    # Refresco
    _asked_unlinked = [False]

    def refresh():
        if getattr(client, 'unlinked_from_server', False) and not _asked_unlinked[0]:
            # El servidor revocó el dispositivo (desvinculación desde la web o la
            # cuenta): avisar al usuario antes de volver al asistente de login.
            _asked_unlinked[0] = True
            client.stop_event.set()
            confirm_dialog(
                win,
                "Dispositivo desvinculado",
                "Este dispositivo fue desvinculado de tu cuenta Null-Void Cloud desde "
                "otro lugar (web o cuenta).\n\n"
                "La sesión local se ha cerrado y los archivos de este PC se movieron a "
                "la papelera de tu nube. Podrás volver a vincularlo cuando quieras.",
                yes_text="Entendido",
            )
            if tray:
                tray.hide()
            app.quit()
            return

        if client.stop_event.is_set():
            if tray:
                tray.hide()
            app.quit()
            return

        with client.stats_lock:
            stats = dict(client.stats)

        if client.paused:
            status_lbl.setText("⏸ Pausado")
            status_lbl.setStyleSheet("font-size: 11px; font-weight: 600; color: #f59e0b;")
            btn_pause.setText("  Reanudar Sincronización")
            btn_pause.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS["play"], size=16, color="#e8edf8"))
        elif client.connected:
            status_lbl.setText("● Conectado")
            status_lbl.setStyleSheet("font-size: 11px; font-weight: 600; color: #10b981;")
            btn_pause.setText("  Pausar Sincronización")
            btn_pause.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS["pause"], size=16, color="#e8edf8"))
        else:
            status_lbl.setText("◌ Reconectando")
            status_lbl.setStyleSheet("font-size: 11px; font-weight: 600; color: #f59e0b;")
            btn_pause.setText("  Pausar Sincronización")
            btn_pause.setIcon(_svg_to_icon(QtGui, QtSvg, QtCore, SVG_ICONS["pause"], size=16, color="#e8edf8"))

        profile_name.setText(str(client.username))
        v_device.setText(str(client.device_name))
        v_server.setText(str(client.active_url or "—"))
        v_dir.setText(str(local_dir))
        v_last.setText(_elapsed_str(client))

        while not log_queue.empty():
            try:
                msg = log_queue.get_nowait()
                log_mini.appendPlainText(msg)
                log_full.appendPlainText(msg)
            except Exception:
                break

    timer = QtCore.QTimer()
    timer.timeout.connect(refresh)
    timer.start(1000)
    refresh()

    win.showNormal()
    win.raise_()
    win.activateWindow()
    try:
        app.exec()
    finally:
        timer.stop()
    return True



if __name__ == "__main__":
    print("Ejecuta este modulo desde agent.py (necesita una instancia de SyncClient).")
