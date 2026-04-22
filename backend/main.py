from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Optional
import json
import os
from dotenv import load_dotenv

load_dotenv()

from agent import run_agent, run_agent_streaming
from state import AgentState

app = FastAPI(title="AI Assistant Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory хранилище сессий
sessions: Dict[str, AgentState] = {}


class ChatRequest(BaseModel):
    message: str
    page_content: Optional[str] = None
    page_details: Optional[dict] = None


@app.post("/chat/{session_id}")
async def chat_rest(session_id: str, request: ChatRequest):
    """REST эндпоинт для чата (фоллбэк)"""
    state = sessions.get(session_id, {"messages": [], "max_steps": 5})

    if request.page_content:
        state["page_content"] = request.page_content
    if request.page_details:
        state["page_details"] = request.page_details

    state["messages"].append({"role": "user", "content": request.message})

    try:
        result = await run_agent(state)
    except Exception as exc:
        return {
            "response": f"Ошибка бэкенда: {str(exc)}",
            "session_id": session_id,
            "steps": 0
        }

    sessions[session_id] = result

    response = result["messages"][-1]
    content = response.content if hasattr(response, 'content') else response.get("content", "")

    return {
        "response": content,
        "session_id": session_id,
        "steps": result.get("steps_taken", 0)
    }


@app.websocket("/ws/{session_id}")
async def chat_websocket(websocket: WebSocket, session_id: str):
    """WebSocket эндпоинт для стриминга ответов"""
    await websocket.accept()

    try:
        while True:
            data = await websocket.receive_text()
            request = json.loads(data)

            # Получаем или создаем состояние сессии
            state = sessions.get(session_id, {"messages": [], "max_steps": 5})

            # Добавляем контекст страницы
            state["page_content"] = request.get("page_content", "")
            state["page_details"] = request.get("page_details", {})

            # Добавляем сообщение пользователя
            state["messages"].append({"role": "user", "content": request["message"]})

            # Отправляем статус
            await websocket.send_json({"type": "status", "status": "thinking"})

            full_response = ""

            try:
                # Запускаем агент со стримингом токенов
                async for event in run_agent_streaming(state):
                    if event["type"] == "token":
                        full_response += event["content"]
                        await websocket.send_json({"type": "token", "content": event["content"]})

                    elif event["type"] == "status":
                        await websocket.send_json({"type": "status", "status": event["status"]})

                    elif event["type"] == "tool_start":
                        await websocket.send_json({"type": "status", "status": "searching", "message": event["tool"]})

                    elif event["type"] == "error":
                        await websocket.send_json({"type": "error", "message": event["message"]})
                        break
            except Exception as exc:
                await websocket.send_json({"type": "error", "message": str(exc)})
                await websocket.send_json({"type": "done"})
                continue

            if not full_response.strip():
                await websocket.send_json({"type": "error", "message": "Пустой ответ модели"})
                await websocket.send_json({"type": "done"})
                continue

            # Сохраняем ответ в историю сессии
            state["messages"].append({"role": "assistant", "content": full_response})
            sessions[session_id] = state

            # Завершаем передачу
            await websocket.send_json({"type": "done"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "deepseek_configured": bool(os.getenv("DEEPSEEK_API_KEY")),
        "exa_configured": bool(os.getenv("EXA_API_KEY"))
    }


@app.delete("/session/{session_id}")
async def clear_session(session_id: str):
    if session_id in sessions:
        del sessions[session_id]
    return {"status": "cleared"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
