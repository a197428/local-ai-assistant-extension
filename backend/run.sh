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

# Определяем путь к Python в виртуальном окружении
VENV_PYTHON="venv/bin/python"
UVICORN_CMD="uvicorn"

if [ -f "$VENV_PYTHON" ]; then
  echo "✅ Использую виртуальное окружение: $VENV_PYTHON"
  PYTHON_CMD="$VENV_PYTHON -m uvicorn"
else
  echo "⚠️ Виртуальное окружение не найдено, использую системный Python"
  PYTHON_CMD="uvicorn"
fi

$PYTHON_CMD main:app --host ${HOST:-0.0.0.0} --port ${PORT:-8000} --reload