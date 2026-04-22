#!/bin/bash
# Скрипт запуска бэкенда с загрузкой переменных окружения из .env файла

echo "🔄 Загружаю переменные окружения из .env..."
if [ -f .env ]; then
  export $(cat .env | xargs)
  echo "✅ Переменные окружения загружены"
else
  echo "⚠️ Файл .env не найден, используем значения по умолчанию"
fi

echo "🚀 Запускаю FastAPI сервер на порту ${PORT:-8000}..."
uvicorn main:app --host ${HOST:-0.0.0.0} --port ${PORT:-8000} --reload