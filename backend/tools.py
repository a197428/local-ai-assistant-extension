import os
from typing import Any, Dict, List

from exa_py import Exa
from langchain.tools import tool


def _get_exa_client() -> Exa:
    api_key = os.getenv("EXA_API_KEY")
    if not api_key:
        raise RuntimeError("EXA_API_KEY не задан")
    return Exa(api_key=api_key)


@tool
def exa_search_tool(query: str) -> Dict[str, Any]:
    """
    Поиск в интернете с помощью EXA API.
    Используй этот инструмент когда тебе нужна актуальная информация,
    факты, цены, скидочные коды или данные которых нет на текущей странице.

    Args:
        query: Поисковый запрос
    """
    exa = _get_exa_client()

    try:
        # Получаем ответ и результаты поиска
        result = exa.search_and_contents(
            query,
            num_results=5,
            use_autoprompt=True,
            summary=True,
            text=True
        )

        return {
            "results": [
                {
                    "title": res.title,
                    "url": res.url,
                    "summary": res.summary,
                    "text": (res.text or "")[:2000]
                }
                for res in result.results
            ]
        }

    except Exception as e:
        return {
            "error": str(e),
            "results": []
        }


@tool
def exa_answer_tool(query: str) -> str:
    """
    Получить прямой ответ на вопрос из интернета.
    Используй этот инструмент когда нужен краткий точный ответ.

    Args:
        query: Вопрос на который нужно получить ответ
    """
    exa = _get_exa_client()

    try:
        result = exa.answer(query)
        return result.answer
    except Exception as e:
        return f"Ошибка при поиске: {str(e)}"
