"""Storage Contract — frontera explícita entre los consumidores de
almacenamiento y la implementación actual de Cloud.

Propósito (ver docs/ARCHITECTURE_DEPENDENCY_AUDIT.md, secciones 4/9/10/12):
introducir una API estrecha y estable para las operaciones de almacenamiento
que realmente necesitan AI, Chat, Invoices, Auth y Backup, SIN descomponer
todavía cloud/services.py y SIN cambiar comportamiento.

  CONSUMER
     │
     ▼
 StorageContract (este módulo: interfaz neutral en modules/, no en core)
     │
     ▼
 CloudStorageAdapter (delega lazy a modules.api.cloud.services)
     │
     ▼
 cloud/services.py   (implementación actual, NO se descompone)

Reglas de diseño:
- El contrato es NARROW: solo operaciones genéricas de almacenamiento usadas
  por los consumidores. NO expone CRUD del file manager, sharing, trash,
  versioning, ZIP, previews, búsqueda/FTS, ni funciones internas privadas.
- El adapter importa cloud/services de forma LAZY (dentro de cada método),
  replicando la convención ya usada por los consumidores (22 imports lazy).
  Así no se crea ningún ciclo de import en tiempo de carga.
- Símbolos privados (p. ej. cloud.services._ai_ext_flags) y el acceso directo
  a cloud.repository NO forman parte del contrato. Se documentan como deuda
  de la fase de descomposición (los consumidores que aún los necesitan siguen
  usando cloud.services directamente).
"""

from __future__ import annotations

from typing import Protocol


class StorageContract(Protocol):
    """Interfaz mínima de almacenamiento. Firma idéntica a las funciones
    actuales de cloud/services para que el adapter sea un pasamuros trivial
    (reversible). Los consumidores dependen de esta interfaz, no de Cloud."""

    # ── Raíces / rutas ──────────────────────────────────────────────
    def get_user_root(self, token=None):
        """Devuelve la raíz del Cloud del usuario autenticado (o None)."""
        ...

    def get_view_root(self, view="drive", token=None):
        """Devuelve la raíz física de una vista (drive/ai/business/...)."""
        ...

    def get_user_quota(self, token=None):
        """Devuelve la cuota (GB) del usuario autenticado."""
        ...

    def get_dir_size(self, path):
        """Tamaño (bytes) de un directorio, con caché por usuario."""
        ...

    def safe_join(self, base, *paths):
        """Une rutas bajo `base` de forma segura; lanza ValueError en escapes."""
        ...

    # ── Operaciones de archivos de IA (adjuntos / notas / workspaces) ──
    def ai_root_for_uid(self, uid):
        """Raíz física de los archivos de IA de un usuario."""
        ...

    def ai_save_file_uid(self, uid, filename, data: bytes, username=None, check_quota=True):
        """Guarda un archivo de IA bajo <DATA_DIR>/ai/<uid>/ y registra metadata."""
        ...

    def ai_save_file(self, token, filename, data: bytes, username=None, user_id=None):
        """Versión con token de ai_save_file_uid."""
        ...

    def ai_update_file_by_uid(self, uid, file_id, data: bytes, check_quota=True):
        """Sobrescribe el contenido de un archivo de IA preservando nombre/metadata."""
        ...

    def ai_read_file_by_uid(self, uid, file_id):
        """Devuelve el contenido (bytes) de un archivo de IA, o None."""
        ...

    def ai_download_file_by_uid(self, uid, file_id):
        """Devuelve la ruta física de un archivo de IA, o None."""
        ...

    def ai_download_file(self, token, file_id):
        """Versión con token de ai_download_file_by_uid."""
        ...

    def ai_list_files(self, token):
        """Lista los refs (dicts) de los archivos de IA del usuario."""
        ...

    def ai_get_refs_by_uid(self, uid, ids):
        """Devuelve los refs (dicts) de los ids de IA indicados."""
        ...

    def ai_delete_file(self, token, file_id):
        """Elimina un archivo de IA por token; True si se borró."""
        ...

    def ai_delete_files_by_uid(self, uid, ids):
        """Elimina metadata + archivo físico de varios adjuntos de IA."""
        ...

    def ai_cleanup_attachments(self, uid, ids):
        """Mueve adjuntos huérfanos de IA a la papelera (borrado de sesiones)."""
        ...

    def ai_ext_flags(self, filename):
        """Clasifica un archivo de IA (mime, es_imagen/texto/audio) por su nombre."""
        ...

    # ── Archivos gestionados bajo la raíz del usuario (subcarpetas) ──
    def save_user_file(self, uid, subpath, filename, src_path):
        """Guarda <src_path> como <user_root>/<subpath>/<filename> del usuario
        (copia o enlace) y ajusta la contabilidad de tamaño. Devuelve la ruta
        destino, o None si no se pudo resolver la raíz del usuario."""
        ...

    def delete_user_path(self, uid, subpath):
        """Elimina <user_root>/<subpath> (archivo o árbol) del usuario y ajusta
        la contabilidad de tamaño. Devuelve True si existía y se eliminó."""
        ...


class CloudStorageAdapter:
    """Adapter pasamuros sobre la implementación actual de Cloud.

    Cada método importa cloud.services de forma lazy y delega. Esto conserva
    el comportamiento actual al 100% (misma firma, mismo backend) y evita
    cualquier ciclo de import. Se puede sustituir por otra implementación del
    StorageContract sin tocar a los consumidores."""

    # ── Raíces / rutas ──────────────────────────────────────────────
    def get_user_root(self, token=None):
        from modules.api.cloud import services as cs
        return cs.get_user_root(token)

    def get_view_root(self, view="drive", token=None):
        from modules.api.cloud import services as cs
        return cs.get_view_root(view, token)

    def get_user_quota(self, token=None):
        from modules.api.cloud import services as cs
        return cs.get_user_quota(token)

    def get_dir_size(self, path):
        from modules.api.cloud import services as cs
        return cs.get_dir_size(path)

    def safe_join(self, base, *paths):
        from modules.api.cloud import services as cs
        return cs.safe_join(base, *paths)

    # ── Operaciones de archivos de IA ──────────────────────────────
    def ai_root_for_uid(self, uid):
        from modules.api.cloud import services as cs
        return cs.ai_root_for_uid(uid)

    def ai_save_file_uid(self, uid, filename, data: bytes, username=None, check_quota=True):
        from modules.api.cloud import services as cs
        return cs.ai_save_file_uid(uid, filename, data, username, check_quota)

    def ai_save_file(self, token, filename, data: bytes, username=None, user_id=None):
        from modules.api.cloud import services as cs
        return cs.ai_save_file(token, filename, data, username, user_id)

    def ai_update_file_by_uid(self, uid, file_id, data: bytes, check_quota=True):
        from modules.api.cloud import services as cs
        return cs.ai_update_file_by_uid(uid, file_id, data, check_quota)

    def ai_read_file_by_uid(self, uid, file_id):
        from modules.api.cloud import services as cs
        return cs.ai_read_file_by_uid(uid, file_id)

    def ai_download_file_by_uid(self, uid, file_id):
        from modules.api.cloud import services as cs
        return cs.ai_download_file_by_uid(uid, file_id)

    def ai_download_file(self, token, file_id):
        from modules.api.cloud import services as cs
        return cs.ai_download_file(token, file_id)

    def ai_list_files(self, token):
        from modules.api.cloud import services as cs
        return cs.ai_list_files(token)

    def ai_get_refs_by_uid(self, uid, ids):
        from modules.api.cloud import services as cs
        return cs.ai_get_refs_by_uid(uid, ids)

    def ai_delete_file(self, token, file_id):
        from modules.api.cloud import services as cs
        return cs.ai_delete_file(token, file_id)

    def ai_delete_files_by_uid(self, uid, ids):
        from modules.api.cloud import services as cs
        return cs.ai_delete_files_by_uid(uid, ids)

    def ai_cleanup_attachments(self, uid, ids):
        from modules.api.cloud import services as cs
        return cs.ai_cleanup_attachments(uid, ids)

    def ai_ext_flags(self, filename):
        from modules.api.cloud import services as cs
        return cs._ai_ext_flags(filename)

    # ── Archivos gestionados bajo la raíz del usuario ─────────────
    def save_user_file(self, uid, subpath, filename, src_path):
        import os
        import shutil
        from modules.api.cloud import services as cs
        root = cs.user_root_for_uid(uid)
        if not root:
            return None
        target_dir = cs.safe_join(root, subpath)
        os.makedirs(target_dir, exist_ok=True)
        dest = cs.safe_join(target_dir, filename)
        size = os.path.getsize(src_path)
        existing = os.path.getsize(dest) if os.path.exists(dest) else 0
        cs.get_dir_size(root)  # primar el caché de tamaño (uso previo a la escritura)
        try:
            if os.path.exists(dest):
                os.unlink(dest)
            os.link(src_path, dest)
        except OSError:
            if os.path.exists(dest):
                os.unlink(dest)
            shutil.copy2(src_path, dest)
        cs.bump_size_cache(uid, size - existing)
        return dest

    def delete_user_path(self, uid, subpath):
        import os
        import shutil
        from modules.api.cloud import services as cs
        root = cs.user_root_for_uid(uid)
        if not root:
            return False
        target = cs.safe_join(root, subpath)
        if not os.path.exists(target):
            return False
        cs.get_dir_size(root)  # primar el caché (incluye el destino a borrar)
        freed = cs._path_size(target)
        if os.path.isdir(target):
            shutil.rmtree(target)
        else:
            os.remove(target)
        cs.bump_size_cache(uid, -freed)
        return True


# Instancia singleton consumida por AI / Chat / Invoices.
storage = CloudStorageAdapter()

# Alias usado por los consumidores migrados (`from modules.storage import store`)
# para no colisionar con variables locales homónimas (p. ej. `storage` en
# ai/routes.py es el resultado de repository.get_note_storage).
store = storage
