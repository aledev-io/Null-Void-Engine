"""Cifrado simétrico reversible para campos sensibles de la base de datos
(p. ej. contraseñas de aplicación de Gmail).

La clave se deriva de SECRET_KEY del servidor, así que aunque alguien copie
manager.db o un backup, los valores cifrados son ilegibles sin esa clave.
Formato de los valores: nv1$<salt_hex>$<nonce_b64>$<ct_b64>$<tag_b64>
"""
import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

_PREFIX = "nv1$"
_KDF_ITERATIONS = 120_000


def _master_key(salt_hex):
    from config.config import CONFIG
    secret = CONFIG.SECRET_KEY
    if not secret:
        raise RuntimeError("SECRET_KEY no está definida")
    return hashlib.pbkdf2_hmac(
        "sha256", secret.encode("utf-8"), bytes.fromhex(salt_hex), _KDF_ITERATIONS, dklen=32
    )


def encrypt_field(plaintext):
    """Cifra un texto con AES-256-GCM y lo devuelve como cadena autodescriptiva."""
    if not plaintext:
        return plaintext
    salt = os.urandom(16).hex()
    key = _master_key(salt)
    nonce = os.urandom(12)
    enc = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    ct = enc.update(plaintext.encode("utf-8")) + enc.finalize()
    return (
        f"{_PREFIX}{salt}${base64.urlsafe_b64encode(nonce).decode()}$"
        f"{base64.urlsafe_b64encode(ct).decode()}$"
        f"{base64.urlsafe_b64encode(enc.tag).decode()}"
    )


def decrypt_field(value):
    """Descifra un valor de encrypt_field.

    Devuelve el valor original. Si el valor no está cifrado (legacy en
    claro) o no puede descifrarse, se devuelve tal cual para no romper la
    migración de cuentas antiguas.
    """
    if not value or not value.startswith(_PREFIX):
        return value
    try:
        _, salt, nonce_b64, ct_b64, tag_b64 = value.split("$", 4)
        key = _master_key(salt)
        dec = Cipher(
            algorithms.AES(key),
            modes.GCM(base64.urlsafe_b64decode(nonce_b64)),
        ).decryptor()
        pt = dec.update(base64.urlsafe_b64decode(ct_b64))
        pt += dec.finalize_with_tag(base64.urlsafe_b64decode(tag_b64))
        return pt.decode("utf-8")
    except Exception:
        return value


_FILE_MAGIC = b"NVENC1"


def encrypt_file(src_path, dst_path):
    """Cifra un archivo binario (backup) con AES-256-GCM por bloques."""
    import shutil
    salt = os.urandom(16)
    salt_hex = salt.hex()
    key = _master_key(salt_hex)
    nonce = os.urandom(12)
    enc = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()

    tmp_dst = f"{dst_path}.tmp_enc"
    os.makedirs(os.path.dirname(os.path.abspath(dst_path)), exist_ok=True)
    try:
        with open(src_path, "rb") as f_in, open(tmp_dst, "wb") as f_out:
            f_out.write(_FILE_MAGIC)
            f_out.write(salt)
            f_out.write(nonce)
            f_out.write(b"\x00" * 16)  # reservado para tag

            while True:
                chunk = f_in.read(1024 * 1024)
                if not chunk:
                    break
                f_out.write(enc.update(chunk))
            enc.finalize()
            tag = enc.tag
            f_out.seek(len(_FILE_MAGIC) + 16 + 12)
            f_out.write(tag)

        os.replace(tmp_dst, dst_path)
    finally:
        if os.path.exists(tmp_dst):
            try:
                os.remove(tmp_dst)
            except OSError:
                pass


def is_encrypted_file(src_path):
    """Comprueba si un archivo tiene la firma NVENC1."""
    if not src_path or not os.path.exists(src_path):
        return False
    try:
        with open(src_path, "rb") as f:
            return f.read(6) == _FILE_MAGIC
    except Exception:
        return False


def decrypt_file(src_path, dst_path):
    """Descifra un archivo cifrado por encrypt_file (soporta fallback a zip no cifrado)."""
    import shutil
    if not os.path.exists(src_path):
        raise FileNotFoundError(f"Archivo no encontrado: {src_path}")
    os.makedirs(os.path.dirname(os.path.abspath(dst_path)), exist_ok=True)
    with open(src_path, "rb") as f:
        magic = f.read(6)
        if magic != _FILE_MAGIC:
            shutil.copyfile(src_path, dst_path)
            return

        salt = f.read(16)
        nonce = f.read(12)
        tag = f.read(16)

        key = _master_key(salt.hex())
        dec = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()

        tmp_dst = f"{dst_path}.tmp_dec"
        try:
            with open(tmp_dst, "wb") as f_out:
                while True:
                    chunk = f.read(1024 * 1024)
                    if not chunk:
                        break
                    f_out.write(dec.update(chunk))
                f_out.write(dec.finalize())
            os.replace(tmp_dst, dst_path)
        finally:
            if os.path.exists(tmp_dst):
                try:
                    os.remove(tmp_dst)
                except OSError:
                    pass


