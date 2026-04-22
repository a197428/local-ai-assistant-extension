# Local AI Assistant Chrome Extension

Chrome расширение с локальным AI-ассистентом, подключенным к бэкенду на Python (FastAPI + LangGraph). Ассистент имеет доступ к содержимому страниц, может выполнять поиск в интернете через EXA API и отвечает на вопросы в реальном времени.

## Структура проекта

```
├── backend/              # Python FastAPI бэкенд
│   ├── .env             # Переменные окружения (ключи API)
│   ├── agent.py         # LangGraph агент
│   ├── main.py          # FastAPI сервер
│   ├── requirements.txt # Зависимости Python
│   ├── run.sh           # Скрипт запуска
│   ├── state.py         # Состояние агента
│   └── tools.py         # Инструменты поиска (EXA)
├── extension/           # Chrome расширение (MV3)
│   ├── src/             # Исходный код React/TypeScript
│   ├── public/          # Статические файлы (manifest, скрипты)
│   ├── background.js    # Service Worker
│   ├── content.js       # Content Script
│   ├── manifest.json    # Конфигурация расширения
│   ├── package.json     # Зависимости Node.js
│   ├── vite.config.ts   # Конфигурация сборки
│   └── ...
└── README.md            # Эта документация
```

## Требования

- Python 3.10+ и pip
- Node.js 18+ и npm
- Chrome браузер (версия 120+)
- API ключи:
  - [DeepSeek API](https://platform.deepseek.com/) (или другой совместимый провайдер)
  - [EXA API](https://exa.ai/) (для поиска в интернете)

## Быстрый старт

### 1. Настройка бэкенда

```bash
cd backend

# Создание виртуального окружения (опционально)
python -m venv venv
source venv/bin/activate  # Linux/Mac
# или venv\Scripts\activate  # Windows

# Установка зависимостей
pip install -r requirements.txt

# Настройка переменных окружения
cp .env.example .env
# Отредактируйте .env, добавьте ваши API ключи:
# DEEPSEEK_API_KEY=ваш_ключ
# EXA_API_KEY=ваш_ключ

# Запуск сервера
./run.sh
# или вручную:
# uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Сервер будет доступен по адресу: `http://localhost:8000`

Проверка работоспособности: `http://localhost:8000/health`

### 2. Настройка расширения

```bash
cd extension

# Установка зависимостей
npm install

# Сборка расширения в режиме разработки (с отслеживанием изменений)
npm run dev
```

### 3. Загрузка расширения в Chrome

1. Откройте `chrome://extensions/`
2. Включите "Режим разработчика" (Developer mode)
3. Нажмите "Загрузить распакованное расширение" (Load unpacked)
4. Выберите папку `extension/dist` (после сборки) или `extension` (для разработки с `npm run dev`)

### 4. Использование

- Нажмите на иконку расширения в панели инструментов Chrome (или используйте хоткей `Ctrl+Shift+E`)
- Откроется боковая панель с AI ассистентом
- Задавайте вопросы о текущей странице или просите найти информацию в интернете

## API ключи

### DeepSeek API
1. Зарегистрируйтесь на [DeepSeek Platform](https://platform.deepseek.com/)
2. Получите API ключ в личном кабинете
3. Укажите его в `.env` как `DEEPSEEK_API_KEY`

### EXA API (поиск в интернете)
1. Зарегистрируйтесь на [exa.ai](https://exa.ai/)
2. Получите API ключ
3. Укажите его в `.env` как `EXA_API_KEY`

## Разработка

### Бэкенд
- Редактируйте файлы в `backend/`
- Сервер автоматически перезагружается при изменениях (благодаря `--reload`)
- Для отладки агента используйте `curl` или тестовые запросы

### Расширение
- Исходный код: `extension/src/`
- Статические файлы: `extension/public/`
- `npm run dev` — сборка с отслеживанием изменений
- `npm run build` — production сборка
- `npm run typecheck` — проверка типов TypeScript

## Архитектура

### Бэкенд (FastAPI)
- **WebSocket** (`/ws/{session_id}`) — стриминг ответов в реальном времени
- **REST API** (`/chat/{session_id}`) — фоллбэк для совместимости
- **LangGraph агент** — управляет диалогом и использованием инструментов
- **Инструменты**:
  - `exa_search_tool` — поиск в интернете
  - `exa_answer_tool` — прямые ответы на вопросы

### Расширение (Chrome MV3)
- **Service Worker** (`background.js`) — управление расширением, коммуникация с контент-скриптами
- **Content Script** (`content.js`) — извлечение информации со страницы
- **Side Panel** (`sidepanel.html`) — интерфейс ассистента (React + TypeScript)
- **WebSocket клиент** — подключение к бэкенду для стриминга

## Возможные проблемы

### Расширение не загружается
- Убедитесь, что используется Chrome 120+
- Проверьте, что папка `dist` существует (после `npm run build` или `npm run dev`)

### Бэкенд не запускается
- Проверьте, установлены ли все зависимости Python
- Убедитесь, что файл `.env` существует и содержит корректные API ключи
- Проверьте, не занят ли порт 8000

### Нет ответа от ассистента
- Проверьте, запущен ли бэкенд (`http://localhost:8000/health`)
- Убедитесь, что API ключи действительны
- Проверьте консоль расширения (F12 → вкладка Extension)

## Лицензия

MIT