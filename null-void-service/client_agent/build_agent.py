import os
import subprocess
import shutil

# Buscar el archivo .env en el directorio superior
env_path = '../../.env'
bootstrap_servers = []

print("Leyendo configuración desde .env...")
if os.path.exists(env_path):
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith('AGENT_BOOTSTRAP_SERVERS='):
                val = line.split('=', 1)[1].strip('"').strip("'")
                bootstrap_servers = [s.strip() for s in val.split(',') if s.strip()]

if bootstrap_servers:
    print(f"IPs encontradas para inyectar: {bootstrap_servers}")
else:
    print("No se encontraron IPs en AGENT_BOOTSTRAP_SERVERS. Se compilará sin auto-descubrimiento.")

# Leer el código fuente original
with open('agent.py', 'r', encoding='utf-8') as f:
    code = f.read()

# Marcadores para inyectar la lista de forma rígida
start_marker = "def load_bootstrap_servers():"
end_marker = "BOOTSTRAP_SERVERS = load_bootstrap_servers()"

if start_marker in code and end_marker in code:
    before = code.split(start_marker)[0]
    after = code.split(end_marker)[1]
    
    # "Hornear" la lista directamente en el código para el binario
    baked_list = f"BOOTSTRAP_SERVERS = {bootstrap_servers}\n"
    new_code = before + baked_list + after
    
    # Crear un archivo temporal para la compilación
    with open('agent_release.py', 'w', encoding='utf-8') as f:
        f.write(new_code)
    
    print("\nIniciando PyInstaller...")
    subprocess.run(["pyinstaller", "--onefile", "--hidden-import=watchdog.observers.inotify", "--hidden-import=watchdog.observers.polling", "--name", "nv-agent", "agent_release.py"])
    
    # Limpiar el archivo temporal
    if os.path.exists('agent_release.py'):
        os.remove('agent_release.py')
    if os.path.exists('agent_release.spec'):
        os.remove('agent_release.spec')
        
    print("\n=============================================")
    print("¡Compilación finalizada con éxito!")
    print("El binario 'nv-agent' está en la carpeta 'dist/'")
    print("Las IPs han quedado empaquetadas dentro del ejecutable, por lo que el cliente NO necesita el archivo .env.")
    print("=============================================")
else:
    print("ERROR: No se encontraron los marcadores de load_bootstrap_servers en agent.py")
