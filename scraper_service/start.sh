#!/bin/bash
set -e

echo "[Scraper] Iniciando microservicio directamente..."

exec python src/app.py
