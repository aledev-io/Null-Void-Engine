import os
import sys
import subprocess
import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)

# Buscar el archivo .env principal del proyecto o directorio actual
env_paths = [
    os.path.join(BASE_DIR, '.env'),
    os.path.join(BASE_DIR, '..', '.env'),
    os.path.join(BASE_DIR, '..', '..', '.env')
]

bootstrap_servers = []
for path in env_paths:
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('AGENT_BOOTSTRAP_SERVERS='):
                        val = line.split('=', 1)[1].strip().strip('"').strip("'")
                        bootstrap_servers = [s.strip() for s in val.split(',') if s.strip()]
                        if bootstrap_servers:
                            break
        except Exception:
            pass
        if bootstrap_servers:
            break

if bootstrap_servers:
    print(f"IPs encontradas para inyectar: {bootstrap_servers}")
else:
    print("No se encontraron IPs en AGENT_BOOTSTRAP_SERVERS. Se compilará sin auto-descubrimiento.")

agent_py_path = os.path.join(BASE_DIR, 'agent.py')
with open(agent_py_path, 'r', encoding='utf-8') as f:
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
    temp_script = 'agent_release.py'
    with open(temp_script, 'w', encoding='utf-8') as f:
        f.write(new_code)
    
    try:
        print("\nIniciando PyInstaller...")
        add_data_arg = f"--add-data={os.path.join(BASE_DIR, 'templates')}{os.path.pathsep}templates"
        subprocess.run([
            sys.executable, "-m", "PyInstaller",
            "--onefile", "--noconsole",
            "--hidden-import=watchdog.observers.inotify",
            "--hidden-import=watchdog.observers.polling",
            add_data_arg, "--name", "nv-agent", temp_script
        ], check=True)
        
        # Generar binarios/ejecutables nombrados según SO en dist/
        dist_dir = os.path.join(BASE_DIR, 'dist')
        bin_file = os.path.join(dist_dir, 'nv-agent')
        
        if os.path.exists(bin_file):
            for name in ('Null-Void-Agent.exe', 'Null-Void-Agent-Linux', 'Null-Void-Agent-Mac'):
                target = os.path.join(dist_dir, name)
                if not os.path.exists(target):
                    shutil.copy(bin_file, target)
            
        print("\n=============================================")
        print("¡Compilación finalizada con éxito!")
        print("Los ejecutables están en la carpeta 'client_agent/dist/'")
        print("=============================================")
    finally:
        # Limpiar archivos temporales
        for temp_file in ('agent_release.py', 'agent_release.spec'):
            if os.path.exists(temp_file):
                os.remove(temp_file)
else:
    print("ERROR: No se encontraron los marcadores de load_bootstrap_servers en agent.py")
