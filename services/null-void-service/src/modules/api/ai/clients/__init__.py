"""Clientes HTTP para proveedores locales y externos de IA."""
from . import ollama as ollama_client
from . import external as external_client

__all__ = [
    "ollama_client",
    "external_client",
]
