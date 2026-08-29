"""Submódulo de Workspaces/Proyectos: fachada para el resto de la aplicación."""
from .routes import workspaces_bp
from . import repository
from . import services
from .services import build_workspace_context

__all__ = [
    "workspaces_bp",
    "repository",
    "services",
    "build_workspace_context",
]
