from flask_socketio import emit
from core.socket_ext import socketio

# Global lock state for scraping
scraper_state = {
    'is_scraping': False,
    'user': None,
    'type': None # 'search' or 'routine'
}

@socketio.on('request_scraper_state')
def handle_request_scraper_state():
    emit('scraper_state_update', scraper_state)

@socketio.on('set_scraper_state')
def handle_set_scraper_state(data):
    global scraper_state
    scraper_state['is_scraping'] = data.get('is_scraping', False)
    scraper_state['user'] = data.get('user', None)
    scraper_state['type'] = data.get('type', None)
    
    # Broadcast to all connected clients
    emit('scraper_state_update', scraper_state, broadcast=True)
