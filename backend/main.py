from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Dict, Optional
import json
import os
import time
import logging
from dotenv import load_dotenv

load_dotenv()

from agent import run_agent, run_agent_streaming
from state import AgentState

logger = logging.getLogger(__name__)

app = FastAPI(title="AI Assistant Backend")

# CORS: read from env, default to localhost only
_allowed_raw = os.getenv("ALLOWED_ORIGINS", "")
if _allowed_raw.strip():
    allowed_origins = [o.strip() for o in _allowed_raw.split(",") if o.strip()]
else:
    allowed_origins = [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


def _is_allowed_ws_origin(origin: Optional[str]) -> bool:
    if not origin:
        return True
    if origin.startswith("chrome-extension://"):
        return True
    return origin in allowed_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session store with TTL
MAX_SESSIONS = 100
SESSION_TTL_SECONDS = 6 * 3600  # 6 hours
MAX_HISTORY = 50

sessions: Dict[str, dict] = {}


def _cleanup_sessions():
    now = time.time()
    expired = [
        sid for sid, s in sessions.items()
        if now - s.get("_updated_at", 0) > SESSION_TTL_SECONDS
    ]
    for sid in expired:
        del sessions[sid]
    while len(sessions) > MAX_SESSIONS:
        oldest = min(sessions, key=lambda k: sessions[k].get("_updated_at", 0))
        del sessions[oldest]


def _touch_session(session_id: str, state: dict):
    state["_updated_at"] = time.time()
    sessions[session_id] = state


class ChatRequest(BaseModel):
    message: str = Field(..., max_length=8000)
    page_content: Optional[str] = Field(None, max_length=12000)
    page_details: Optional[dict] = None


@app.post("/chat/{session_id}")
async def chat_rest(session_id: str, request: ChatRequest):
    _cleanup_sessions()
    state = sessions.get(session_id, {"messages": [], "max_steps": 5})

    if request.page_content:
        state["page_content"] = request.page_content
    if request.page_details:
        state["page_details"] = request.page_details

    state["messages"].append({"role": "user", "content": request.message})

    try:
        result = await run_agent(state)
    except Exception:
        logger.exception("REST chat error for session %s", session_id)
        return {
            "response": "Ошибка backend. Проверьте логи сервера.",
            "session_id": session_id,
            "steps": 0,
        }

    _touch_session(session_id, result)

    response = result["messages"][-1]
    content = response.content if hasattr(response, "content") else response.get("content", "")

    return {
        "response": content,
        "session_id": session_id,
        "steps": result.get("steps_taken", 0),
    }


@app.websocket("/ws/{session_id}")
async def chat_websocket(websocket: WebSocket, session_id: str):
    origin = websocket.headers.get("origin")
    if not _is_allowed_ws_origin(origin):
        logger.warning("Rejected WS origin: %s", origin)
        await websocket.close(code=1008)
        return

    await websocket.accept()

    try:
        while True:
            data = await websocket.receive_text()

            # Validate payload size (100KB limit)
            if len(data) > 100_000:
                await websocket.send_json({"type": "error", "message": "Слишком большой запрос"})
                await websocket.send_json({"type": "done"})
                continue

            try:
                request = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Неверный формат данных"})
                await websocket.send_json({"type": "done"})
                continue

            message = request.get("message", "")
            if not message or len(message) > 8000:
                await websocket.send_json({"type": "error", "message": "Сообщение отсутствует или слишком длинное"})
                await websocket.send_json({"type": "done"})
                continue

            _cleanup_sessions()
            state = sessions.get(session_id, {"messages": [], "max_steps": 5})

            state["page_content"] = request.get("page_content", "")[:12000]
            state["page_details"] = request.get("page_details", {})
            state["messages"].append({"role": "user", "content": message})

            await websocket.send_json({"type": "status", "status": "thinking"})

            full_response = ""

            try:
                async for event in run_agent_streaming(state):
                    if event["type"] == "token":
                        full_response += event["content"]
                        await websocket.send_json({"type": "token", "content": event["content"]})

                    elif event["type"] == "status":
                        await websocket.send_json({"type": "status", "status": event["status"]})

                    elif event["type"] == "tool_start":
                        await websocket.send_json({"type": "status", "status": "searching", "message": event["tool"]})

                    elif event["type"] == "error":
                        await websocket.send_json({"type": "error", "message": "Ошибка обработки запроса"})
                        break
            except Exception:
                logger.exception("WS streaming error for session %s", session_id)
                await websocket.send_json({"type": "error", "message": "Ошибка backend. Проверьте логи сервера."})
                await websocket.send_json({"type": "done"})
                continue

            if not full_response.strip():
                await websocket.send_json({"type": "error", "message": "Пустой ответ модели"})
                await websocket.send_json({"type": "done"})
                continue

            state["messages"].append({"role": "assistant", "content": full_response})

            # Trim history to last N messages
            if len(state["messages"]) > MAX_HISTORY:
                state["messages"] = state["messages"][-MAX_HISTORY:]

            _touch_session(session_id, state)

            await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WS connection error for session %s", session_id)


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "deepseek_configured": bool(os.getenv("DEEPSEEK_API_KEY")),
        "exa_configured": bool(os.getenv("EXA_API_KEY")),
    }


@app.delete("/session/{session_id}")
async def clear_session(session_id: str):
    if session_id in sessions:
        del sessions[session_id]
    return {"status": "cleared"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)
