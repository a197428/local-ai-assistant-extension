from typing import Annotated, TypedDict, Optional, List, Dict
from langgraph.graph.message import add_messages


class AgentState(TypedDict, total=False):
    """Состояние агента LangGraph"""
    messages: Annotated[list, add_messages]
    page_content: str
    page_details: Dict
    current_step: str
    error_count: int
    max_steps: int
    tools_used: List[str]
    need_web_search: bool
    search_query: str
    search_results: List[Dict]