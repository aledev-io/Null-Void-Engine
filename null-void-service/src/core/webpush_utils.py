import os
import json
import base64
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

VAPID_KEYS_FILE = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'vapid_keys.json')
VAPID_SUBJECT = 'mailto:admin@nullvoid.local'

def get_or_create_vapid_keys():
    if os.path.exists(VAPID_KEYS_FILE):
        with open(VAPID_KEYS_FILE, 'r') as f:
            return json.load(f)
            
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    
    # Export private key as url-safe base64 for pywebpush
    private_numbers = private_key.private_numbers()
    private_bytes = private_numbers.private_value.to_bytes(32, 'big')
    private_b64 = base64.urlsafe_b64encode(private_bytes).decode('utf-8').rstrip('=')
    
    # Export public key
    # For VAPID we need the uncompressed point (0x04) format encoded in url-safe base64
    public_numbers = public_key.public_numbers()
    x = public_numbers.x.to_bytes(32, 'big')
    y = public_numbers.y.to_bytes(32, 'big')
    public_bytes = b'\x04' + x + y
    
    public_b64 = base64.urlsafe_b64encode(public_bytes).decode('utf-8').rstrip('=')
    
    keys = {
        'private_key': private_b64,
        'public_key': public_b64
    }
    
    os.makedirs(os.path.dirname(VAPID_KEYS_FILE), exist_ok=True)
    with open(VAPID_KEYS_FILE, 'w') as f:
        json.dump(keys, f)
        
    return keys

def get_vapid_claims():
    return {
        "sub": VAPID_SUBJECT
    }
