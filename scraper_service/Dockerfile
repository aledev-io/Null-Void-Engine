FROM python:3.11-slim
ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    nodejs \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install-deps chromium
RUN for i in 1 2 3 4 5; do playwright install chromium && break || sleep 5; done
COPY . .
RUN mkdir -p /app/data
RUN chmod +x start.sh
EXPOSE 5001
CMD ["./start.sh"]
