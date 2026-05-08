# Null-Void Engine (Manager)

## Descripción
Infraestructura de gestión centralizada para la monitorización de recursos de sistema, administración de almacenamiento aislado y automatización de respaldos. El sistema opera bajo un modelo estrictamente local para garantizar la integridad y privacidad de los datos.

## Arquitectura
*   **Backend:** Python 3.x (Flask Framework)
*   **Base de Datos:** SQLite 3 (Persistencia relacional)
*   **Interfaz:** HTML5 / CSS3 / Vanilla JavaScript
*   **Seguridad:** Hashing de credenciales (werkzeug), registro de auditoría interno y control de instancia única mediante socket.

## Requisitos
*   Entorno de ejecución Python 3.8 o superior.
*   Librerías listadas en `requirements.txt`.
*   Permisos de ejecución para scripts de sistema.

## Instalación y Configuración Paso a Paso

### 1. Clonar y Preparar Entorno
Baja el repositorio y entra en la carpeta:
```bash
git clone https://github.com/aledev-io/Null-Void-Engine
cd Manager
```

Se recomienda usar un entorno virtual:
```bash
python -m venv venv
source venv/bin/activate  # En Linux
# venv\Scripts\activate   # En Windows
```

### 2. Instalar Dependencias
```bash
pip install -r requirements.txt
```

### 3. Configuración (.env)
Crea un archivo `.env` dentro de la carpeta `config/` para personalizar el servidor (o usa los valores por defecto). Ejemplo:
```env
HOST=127.0.0.1
FLASK_PORT=5000
DEBUG=false
USE_HTTPS=false
CREDENTIALS=admin:tu_password_aqui
```

### 4. Protocolo HTTPS (Opcional)
Para habilitar la navegación segura:
1. Cambia `USE_HTTPS=true` en tu archivo `.env`.
2. Crea una carpeta llamada `certs/` en la raíz del proyecto.
3. Coloca tus archivos `cert.pem` y `key.pem` dentro de `certs/`.
   - Si no los tienes, puedes generar unos de prueba:
     ```bash
     openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes
     ```

### 5. Inicio del Servicio
```bash
python app.py
```
> **Nota sobre Datos:** La carpeta `/data` y la base de datos `manager.db` se generarán automáticamente la primera vez que inicies la aplicación. No necesitas crear ninguna estructura manualmente.

Acceso: `http://127.0.0.1:5000` (o `https://` si lo habilitaste).

## Estructura de Directorios
*   `/core`: Controladores de bajo nivel y lógica de base de datos.
*   `/ui`: Definición de rutas API y gestión de lógica de sesión.
*   `/data`: Repositorio de persistencia (Base de datos, Logs, Actividad Cloud). **(Se genera solo)**.
*   `/config`: Archivos de configuración y variables de entorno.
*   `/static`: Recursos estáticos (JS, CSS, Imágenes).
*   `/templates`: Plantillas HTML del panel de control.
*   `/certs`: Carpeta para certificados SSL/TLS (si se usa HTTPS).

## Seguridad y Cumplimiento
*   **Instancia Única:** El sistema usa el puerto 47213 como bloqueo global para evitar múltiples procesos.
*   **Aislamiento:** Los datos de cada usuario en el Cloud están aislados por su ID único.
*   **Auditoría:** Todas las acciones críticas se guardan en `data/audit.json`.
