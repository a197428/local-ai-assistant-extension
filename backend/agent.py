from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage
from langgraph.prebuilt import ToolNode
import os
from typing import AsyncGenerator
from dotenv import load_dotenv

from state import AgentState
from tools import exa_answer_tool, exa_search_tool

load_dotenv()

_llm_with_tools = None


def get_llm_with_tools():
    global _llm_with_tools

    if _llm_with_tools is not None:
        return _llm_with_tools

    if not os.getenv("DEEPSEEK_API_KEY"):
        raise RuntimeError("DEEPSEEK_API_KEY не задан")

    llm = ChatOpenAI(
        model=os.getenv("DEEPSEEK_MODEL", "deepseek/deepseek-v3.2"),
        api_key=os.getenv("DEEPSEEK_API_KEY"),
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://routerai.ru/api/v1"),
        streaming=True,
        temperature=0.7,
        max_tokens=4096
    )

    _llm_with_tools = llm.bind_tools([exa_search_tool, exa_answer_tool])
    return _llm_with_tools



def should_continue(state: AgentState) -> str:
    """Определяем следующий шаг выполнения графа"""
    messages = state["messages"]
    last_message = messages[-1]

    if getattr(last_message, "tool_calls", None):
        return "tools"

    return END


def agent_node(state: AgentState) -> dict:
    """Основной узел обработки запроса"""
    messages = state["messages"]
    page_content = state.get("page_content", "")

    system_prompt = """Ты — умный AI ассистент для браузера.
Ты имеешь доступ к содержимому текущей страницы которую просматривает пользователь.
Отвечай кратко, точно и по существу.

Если пользователь спрашивает что-то что отсутствует в контексте страницы - используй поиск в интернете с помощью EXA инструмента.
Всегда проверяй сначала контекст страницы, и только если информации недостаточно - делай поиск.

Отвечай на русском языке."""

    if page_content:
        system_prompt += f"\n\n📄 Содержимое текущей страницы:\n{page_content[:4000]}"

    full_messages = [SystemMessage(content=system_prompt)] + messages

    llm_with_tools = get_llm_with_tools()
    response = llm_with_tools.invoke(full_messages)

    return {"messages": [response]}


# Создаем граф
def build_agent_graph():
    builder = StateGraph(AgentState)

    builder.add_node("agent", agent_node)
    builder.add_node("tools", ToolNode([exa_search_tool, exa_answer_tool]))

    builder.set_entry_point("agent")

    builder.add_conditional_edges(
        "agent",
        should_continue
    )

    builder.add_edge("tools", "agent")

    return builder.compile()


agent_graph = build_agent_graph()


async def run_agent(state: AgentState) -> AgentState:
    """Запускаем агент без стриминга"""
    return await agent_graph.ainvoke(state)


async def run_agent_streaming(state: AgentState) -> AsyncGenerator[dict, None]:
    """Запускаем агент со стримингом токенов"""
    yielded_token = False

    async for event in agent_graph.astream(state, stream_mode="updates"):
        if "agent" in event:
            message = event["agent"]["messages"][0]
            if hasattr(message, 'content') and message.content:
                if not yielded_token:
                    yield {"type": "status", "status": "responding"}
                    yielded_token = True
                yield {"type": "token", "content": message.content}

        elif "tools" in event:
            yield {"type": "tool_start", "tool": "web_search"}
            yield {"type": "status", "status": "searching"}
