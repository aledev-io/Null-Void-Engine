from .routes import ai_bp
from . import services
from . import repository
from . import agenda
tools = agenda
from . import web_search
from . import workspaces
from .security import privacy
from .clients import ollama_client, external_client

__all__ = [
    "ai_bp",
    "services",
    "repository",
    "agenda",
    "tools",
    "web_search",
    "workspaces",
    "privacy",
    "ollama_client",
    "external_client",
]
