from flask import Blueprint

events_bp = Blueprint('events', __name__, url_prefix='/api/events')

from . import routes
