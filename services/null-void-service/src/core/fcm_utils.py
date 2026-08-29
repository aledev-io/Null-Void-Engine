import os
import json
import base64
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
import firebase_admin
from firebase_admin import credentials, messaging

from config.config import CONFIG

def init_firebase():
    """Inicializa la app de Firebase si el archivo de credenciales existe."""
    try:
        if not firebase_admin._apps:
            key_path = CONFIG.FCM_CREDENTIALS_PATH
            if os.path.exists(key_path):
                cred = credentials.Certificate(key_path)
                firebase_admin.initialize_app(cred)
                print("[FCM] Firebase Admin inicializado correctamente.")
                return True
            else:
                print(f"[FCM] Falta {key_path}. Las notificaciones FCM están desactivadas.")
                return False
        return True
    except Exception as e:
        print(f"[FCM] Error inicializando Firebase: {e}")
        return False

def get_common_iv_and_encrypt(title: str, body: str):
    if not CONFIG.FCM_SECRET_KEY:
        raise ValueError("FCM_SECRET_KEY no está configurada")
    key = base64.b64decode(CONFIG.FCM_SECRET_KEY)
    iv = os.urandom(12)  # GCM standard is 12 bytes
    
    def encrypt_with_iv(plain_text):
        cipher = Cipher(algorithms.AES(key), modes.GCM(iv))
        encryptor = cipher.encryptor()
        cipher_text = encryptor.update(plain_text.encode('utf-8')) + encryptor.finalize()
        return base64.b64encode(cipher_text + encryptor.tag).decode('utf-8')
        
    return {
        "encrypted_title": encrypt_with_iv(title),
        "encrypted_body": encrypt_with_iv(body),
        "iv_base64": base64.b64encode(iv).decode('utf-8')
    }

def send_fcm_notification(tokens: list, title: str, body: str):
    """
    Envía notificaciones cifradas de extremo a extremo vía Firebase Cloud Messaging.
    """
    if not init_firebase():
        return False
        
    if not tokens:
        return False

    encrypted_data = get_common_iv_and_encrypt(title, body)
    
    message = messaging.MulticastMessage(
        data={
            "title": encrypted_data["encrypted_title"],
            "body": encrypted_data["encrypted_body"],
            "iv": encrypted_data["iv_base64"]
        },
        tokens=tokens,
        # Importante: No pasamos el bloque 'notification', porque si lo pasamos,
        # Firebase lo mostraría en plano en iOS/Android. Al usar solo 'data',
        # despierta a la app en segundo plano y el Kotlin se encarga.
    )
    
    try:
        response = messaging.send_each_for_multicast(message)
        print(f"[FCM] Notificaciones cifradas enviadas. Éxito: {response.success_count}, Fallos: {response.failure_count}")
        return True
    except Exception as e:
        print(f"[FCM] Error enviando a Firebase: {e}")
        return False
