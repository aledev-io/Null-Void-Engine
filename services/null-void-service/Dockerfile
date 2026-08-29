FROM python:3.11-slim
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    poppler-utils \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*
# 1. Actualizar pip primero de forma limpia
RUN pip install --no-cache-dir --upgrade pip

# 2. Instalar dependencias pesadas base por separado
RUN pip install --no-cache-dir --default-timeout=1000 numpy pydantic spacy

# 3. Instalar el resto de dependencias del requirements.txt
COPY requirements.txt .
RUN pip install --no-cache-dir --default-timeout=1000 --retries=20 -r requirements.txt

# 4. Descargar los modelos de spacy de forma independiente
RUN python -m spacy download es_core_news_sm && \
    python -m spacy download en_core_web_sm

COPY . .

RUN mkdir -p data/app
EXPOSE 5000
ENV GUNICORN_VERSION=23.0.0
CMD ["gunicorn", "--worker-class", "geventwebsocket.gunicorn.workers.GeventWebSocketWorker", "--bind", "0.0.0.0:5000", "--workers", "1", "--timeout", "600", "--chdir", "src", "app:app"]