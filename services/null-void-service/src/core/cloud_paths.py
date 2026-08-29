import os
import logging
from config.config import CONFIG

logger = logging.getLogger(__name__)


def _default_cloud_root():
    """Raíz del Cloud del usuario, derivada de la configuración central.

    Es la misma derivación que `modules.api.cloud.services.BASE_CLOUD_ROOT`
    (`CONFIG.DATA_DIR/Cloud`). Este módulo es la fuente pura de la resolución
    de rutas para el restore; Cloud la re-exporta/inyecta su propio root."""
    return os.path.join(CONFIG.DATA_DIR, 'Cloud')


def safe_join(base, *paths):
    """Une rutas bajo `base` de forma segura. Cada segmento se limpia y
    normaliza por completo; las secuencias relativas ('.'/'..') que intenten
    escapar de la base o navegar a carpetas hermanas se rechazan con ValueError."""
    base_abs = os.path.realpath(os.path.abspath(base))
    current = base_abs

    for p in paths:
        for seg in str(p).replace('\\', '/').split('/'):
            seg = seg.strip()
            if not seg:
                continue
            if seg in ('.', '..'):
                logger.error(f"[SECURITY][ALERT] Intento de escape perimetral hacia: {seg}")
                raise ValueError("Acceso denegado: Violación de aislamiento de ruta lúdica")

            next_path = os.path.realpath(os.path.abspath(os.path.join(current, seg)))

            if os.path.commonpath([base_abs, next_path]) != base_abs:
                logger.error(f"[SECURITY][ALERT] Intento de escape perimetral hacia: {next_path}")
                raise ValueError("Acceso denegado: Violación de aislamiento de ruta lúdica")

            current = next_path

    return current


def user_root_for_uid(uid, base_cloud_root=None):
    """Resuelve la raíz del Cloud de un usuario. Con un UID inválido o vacío
    devuelve None. Sanitiza el UID (solo alnum/espacios/._-) y, si queda vacío,
    usa 'unknown'. Puede recibir un `base_cloud_root` explícito; por defecto
    deriva la raíz de la configuración (CONFIG.DATA_DIR/Cloud)."""
    if base_cloud_root is None:
        base_cloud_root = _default_cloud_root()
    if not uid:
        return None
    safe_uid = "".join([c for c in str(uid) if c.isalnum() or c in (' ', '.', '_', '-')]).strip()
    if not safe_uid:
        safe_uid = "unknown"
    return safe_join(base_cloud_root, safe_uid)


def resolve_restore_destination(uid, target_rel_path, base_cloud_root=None):
    """Devuelve el directorio destino seguro de un restore dentro del Cloud del
    usuario.

    Devuelve la ruta absoluta segura, o None ante un usuario/ruta inválidos o
    si `target_rel_path` intenta escapar del root del usuario. Esta capacidad
    NO ejecuta el restore: solo resuelve el destino. Es la lógica pura de
    resolución; el módulo Cloud la re-exporta inyectando su BASE_CLOUD_ROOT."""
    if base_cloud_root is None:
        base_cloud_root = _default_cloud_root()
    user_root = user_root_for_uid(uid, base_cloud_root)
    if not user_root:
        return None
    if not target_rel_path:
        return user_root
    try:
        return safe_join(user_root, target_rel_path)
    except ValueError:
        return None
