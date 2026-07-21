from .connector import ALIAS_SMTP_HOST, ALIAS_SMTP_PORT, get_google_credentials
from .routes import mail_bp

__all__ = ["mail_bp", "ALIAS_SMTP_HOST", "ALIAS_SMTP_PORT", "get_google_credentials"]
