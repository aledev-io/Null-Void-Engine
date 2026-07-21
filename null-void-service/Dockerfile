FROM python:3.11-slim
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    poppler-utils \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Compilar el agente de sincronización en la imagen. 
# Copiar primero solo el agente para aprovechar el caché de Docker
# NOTA: Descomenta estas líneas en producción si quieres que el contenedor sirva el ejecutable ya listo.
COPY client_agent/ client_agent/
RUN chmod +x client_agent/compile.sh
RUN ./client_agent/compile.sh

COPY . .

RUN mkdir -p data/app
EXPOSE 5000
ENV GUNICORN_VERSION=23.0.0
CMD ["gunicorn", "--worker-class", "geventwebsocket.gunicorn.workers.GeventWebSocketWorker", "--bind", "0.0.0.0:5000", "--workers", "1", "--timeout", "600", "--chdir", "src", "app:app"]