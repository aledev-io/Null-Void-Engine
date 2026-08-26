"""Lógica de negocio y formateo del contexto para Workspaces/Proyectos."""
from . import repository


def build_workspace_context(workspace_id: str):
    """Construye el system prompt de contexto a partir de los archivos del
    workspace. Devuelve el prompt (str) o ``None`` si no hay archivos.

    Se usa en el orquestador para inyectar el contenido como contexto del
    modelo en cada petición de chat.
    """
    if not workspace_id:
        return None
    files = repository.get_workspace_files(workspace_id)
    if not files:
        return None

    context_parts = []
    for f in files:
        content = repository.get_workspace_file_content(f["id"])
        context_parts.append(f"--- Archivo: {f['filename']} ---\n{content}\n")

    if not context_parts:
        return None
    return (
        "Tienes acceso a los siguientes archivos del Espacio de Trabajo "
        "(Workspace) actual. Úsalos como contexto para responder a las "
        "preguntas del usuario:\n\n" + "\n".join(context_parts)
    )


def list_workspace_files(workspace_id: str) -> list[dict]:
    """Lista los archivos del workspace enriquecidos con metadatos del módulo
    cloud (tamaño, tipo, etc.), tal como espera el frontend."""
    files = repository.get_workspace_files(workspace_id)
    from modules.api.cloud import services as cloud_services
    enriched = []
    for f in files:
        entry = {"id": f["id"], "filename": f["filename"], "fileId": f.get("file_id")}
        if f.get("file_id"):
            row = cloud_services.ai_get_refs_by_uid(f.get("user_id"), [f["file_id"]])
            if row:
                ref = row[0]
                entry.update({"size": ref["size"], "sizeLabel": ref["sizeLabel"],
                              "isText": ref["isText"], "isImage": ref["isImage"],
                              "isAudio": ref["isAudio"], "type": ref["type"]})
        enriched.append(entry)
    return enriched
