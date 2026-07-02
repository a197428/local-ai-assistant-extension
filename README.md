# Local AI Assistant Chrome Extension

Локальный AI-ассистент для Chrome, который открывается в боковой панели, читает контекст текущей страницы и помогает быстро разобраться в содержимом: пересказать, объяснить, найти недостающие факты в интернете и сохранить диалог в Markdown.

Проект собран как связка Chrome MV3 extension + Python backend. Расширение работает с UI на React, а backend на FastAPI запускает LangGraph-агента с OpenAI-compatible DeepSeek API и поиском через EXA.

## Возможности

- Боковая панель Chrome с чат-интерфейсом.
- Автоматическое извлечение текста, meta-тегов и форм с текущей страницы.
- Ответы по контексту открытой вкладки.
- Интернет-поиск через EXA, когда данных страницы недостаточно.
- WebSocket-ответы со статусами `thinking`, `searching`, `responding`.
- REST fallback, если WebSocket временно недоступен.
- Устойчивое переподключение WebSocket с backoff.
- Экспорт диалога в Markdown: копирование в буфер или скачивание `.md`.
- Набор frontend-тестов для WS lifecycle, ошибок и fallback-сценариев.

## Стек

**Extension**

- Chrome Manifest V3
- React 19
- TypeScript
- Vite
- Tailwind CSS
- shadcn-style UI primitives
- Vitest + Testing Library

**Backend**

- Python 3.10+
- FastAPI
- Uvicorn
- LangGraph
- LangChain OpenAI-compatible client
- DeepSeek-compatible API endpoint
- EXA API

## Архитектура

```text
Chrome Side Panel (React)
        |
        | WebSocket / REST
        v
FastAPI Backend
        |
        v
LangGraph Agent
        |
        +-- DeepSeek-compatible LLM
        +-- EXA search tools

Chrome Background Service Worker
        |
        v
Content Script -> Page text/forms/meta extraction
```

## Структура проекта

```text
├── backend/
│   ├── agent.py          # LangGraph agent
│   ├── main.py           # FastAPI app
│   ├── requirements.txt  # Python dependencies
│   ├── run.sh            # Backend launcher
│   ├── state.py          # Agent state
│   └── tools.py          # EXA tools
├── extension/
│   ├── public/           # MV3 static files: manifest, background, content
│   ├── src/
│   │   ├── sidepanel/    # React side panel app and tests
│   │   ├── components/   # UI components
│   │   └── test/         # Test setup
│   ├── package.json
│   ├── vite.config.ts
│   └── vitest.config.ts
└── README.md
```

## Требования

- Python 3.10+ и pip
- Node.js 20+ и npm
- Chrome 120+
- API keys:
  - `DEEPSEEK_API_KEY`
  - `EXA_API_KEY`

## Быстрый старт

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Заполните `.env`:

```env
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://routerai.ru/api/v1
DEEPSEEK_MODEL=deepseek/deepseek-v3.2
EXA_API_KEY=your_exa_api_key
HOST=127.0.0.1
PORT=8000
```

Запуск:

```bash
./run.sh
```

Проверка:

```bash
curl http://localhost:8000/health
```

Ожидаемый ответ:

```json
{
  "status": "healthy",
  "deepseek_configured": true,
  "exa_configured": true
}
```

### 2. Extension

```bash
cd extension
npm install
npm run build
```

### 3. Загрузка в Chrome

1. Откройте `chrome://extensions/`.
2. Включите Developer mode.
3. Нажмите Load unpacked.
4. Выберите папку `extension/dist`.
5. Откройте любую страницу и нажмите иконку Local AI Assistant.

Если backend запущен, в боковой панели должен появиться статус `Онлайн`.

## Команды разработки

### Extension

```bash
cd extension
npm run dev        # watch build для разработки расширения
npm run build      # production build в dist/
npm run typecheck  # TypeScript check
npm run test       # Vitest tests
```

### Backend

```bash
cd backend
./run.sh
```

Основные endpoints:

- `GET /health`
- `POST /chat/{session_id}`
- `WS /ws/{session_id}`
- `DELETE /session/{session_id}`

## Тесты

Frontend покрывает основные runtime-сценарии side panel:

- WebSocket connected/disconnected states.
- Exponential reconnect backoff.
- Cleanup после unmount.
- Backend error messages в чате.
- Non-JSON WebSocket messages.
- REST fallback при HTTP 500 и fetch failure.
- Ошибки отправки WebSocket.
- Token append и сброс loading на `done`.

Запуск:

```bash
cd extension
npm run test
```

## Экспорт Markdown

Диалог можно:

- скопировать в буфер обмена;
- скачать как `.md` файл.

Экспорт включает дату, URL страницы, заголовок страницы, роли сообщений и временные метки.

## Безопасность и приватность

### Какие данные собираются

- **Текст текущей страницы** — извлекается через content script, обрезается до 5000 символов.
- **Заголовок и URL** страницы.
- **Мета-теги** (og:title, description и т.д.).
- **Имена и типы полей форм** — значения НЕ собираются.

### Что НЕ собирается

- Значения полей ввода (пароли, email, телефон, номера карт).
- Поля типов `password`, `email`, `tel`, `credit-card` и т.д. автоматически фильтруются.
- Страницы `chrome://`, `file://`, `about://` — контекст не извлекается.

### Куда отправляются данные

1. Content script извлекает контекст страницы.
2. Контекст отправляется на **локальный** backend (`127.0.0.1:8000`).
3. Backend отправляет часть контекста в **LLM provider** (DeepSeek API) для генерации ответа.
4. **EXA API** используется только при поиске в интернете, если данных страницы недостаточно.

### API-ключи

Хранятся локально в `backend/.env`. Не попадают в git (`.env` в `.gitignore`).

### Ограничения

- Backend слушает только на `127.0.0.1` (не доступен из сети).
- CORS ограничен whitelisted origins.
- Максимальный размер сообщения: 8000 символов.
- Максимальный контекст страницы: 12000 символов.
- История сессии: максимум 50 сообщений, автоматическая очистка через 6 часов.

### Side panel показывает `Оффлайн`

Проверьте, что backend запущен:

```bash
curl http://localhost:8000/health
```

Если соединения нет, запустите:

```bash
cd backend
./run.sh
```

Затем перезагрузите расширение на `chrome://extensions/` или закройте и откройте side panel.

### Расширение не загружается

- Убедитесь, что выполнен `npm run build`.
- Загружайте именно `extension/dist`.
- Проверьте ошибки на странице `chrome://extensions/`.

### Модель не отвечает

- Проверьте `DEEPSEEK_API_KEY`.
- Проверьте `DEEPSEEK_BASE_URL` и `DEEPSEEK_MODEL`.
- Посмотрите логи терминала, где запущен backend.

### Поиск не работает

- Проверьте `EXA_API_KEY`.
- Убедитесь, что у backend есть доступ к интернету.

## Репозиторий

GitHub: https://github.com/a197428/local-ai-assistant-extension

## Лицензия

MIT
