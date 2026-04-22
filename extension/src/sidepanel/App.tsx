import { useState, useEffect, useRef, FormEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

const API_BASE = 'http://localhost:8000';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

interface PageContext {
  title: string;
  url: string;
  text: string;
  forms?: any[];
  meta?: Record<string, string>;
}

interface AgentStatus {
  state: 'idle' | 'thinking' | 'searching' | 'responding' | 'error';
  message?: string;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ state: 'idle' });
  const [pageInfo, setPageInfo] = useState<PageContext | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Автоскролл к последнему сообщению
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Подключение WebSocket
  useEffect(() => {
    const connectWebSocket = () => {
      const ws = new WebSocket(`${API_BASE.replace('http', 'ws')}/ws/${sessionId}`);

      ws.onopen = () => {
        setWsStatus('connected');
        console.log('[WS] Connected');
      };

      ws.onclose = () => {
        setWsStatus('disconnected');
        console.log('[WS] Disconnected, reconnecting in 3s');
        setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = (error) => {
        console.error('[WS] Error:', error);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'status':
              setAgentStatus({ state: data.status, message: data.message });
              break;

            case 'token':
              setMessages(prev => updateLastMessage(prev, data.content));
              break;

            case 'done':
              setIsLoading(false);
              setAgentStatus({ state: 'idle' });
              break;

            case 'error':
              setIsLoading(false);
              setAgentStatus({ state: 'error', message: data.message });
              break;
          }
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };

      wsRef.current = ws;
    };

    connectWebSocket();

    return () => {
      wsRef.current?.close();
    };
  }, [sessionId]);

  // Получение контекста страницы при загрузке
  useEffect(() => {
    const loadPageContext = async () => {
      try {
        const context = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' });
        setPageInfo(context);
      } catch (err) {
        console.warn('Could not load page context:', err);
      }
    };

    loadPageContext();
  }, []);

  const updateLastMessage = (messages: Message[], content: string): Message[] => {
    const updated = [...messages];
    const lastIndex = updated.length - 1;

    if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
      updated[lastIndex] = {
        ...updated[lastIndex],
        content: updated[lastIndex].content + content
      };
    }

    return updated;
  };

  const formatPageContext = (ctx: PageContext): string => {
    let result = `📄 Текущая страница:\nЗаголовок: ${ctx.title}\nURL: ${ctx.url}\n\n`;

    if (ctx.text) {
      result += `Содержимое страницы:\n${ctx.text.slice(0, 3000)}\n`;
    }

    return result;
  };

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();

    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsLoading(true);

    // Добавляем сообщение пользователя и пустое сообщение ассистента
    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMessage, timestamp: Date.now() },
      { role: 'assistant', content: '', timestamp: Date.now() }
    ]);

    let pageContext: PageContext = { title: '', url: '', text: '' };
    try {
      pageContext = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTEXT' });
    } catch (err) {
      console.warn('Could not get page context:', err);
    }

    const payload = {
      message: userMessage,
      page_content: formatPageContext(pageContext),
      page_details: pageContext
    };

    // Пробуем отправить через WebSocket
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return;
    }

    // Fallback на REST API
    try {
      const response = await fetch(`${API_BASE}/chat/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      setMessages(prev => updateLastMessage(prev, data.response));
    } catch (err) {
      console.error('API error:', err);
      setMessages(prev => updateLastMessage(prev, '❌ Ошибка подключения к серверу'));
    } finally {
      setIsLoading(false);
      setAgentStatus({ state: 'idle' });
    }
  };

  const getStatusBadge = () => {
    switch (agentStatus.state) {
      case 'thinking':
        return <Badge variant="secondary">🤔 Думаю...</Badge>;
      case 'searching':
        return <Badge variant="secondary">🔍 Ищу в интернете...</Badge>;
      case 'responding':
        return <Badge variant="secondary">✍️ Пишу ответ...</Badge>;
      case 'error':
        return <Badge variant="destructive">❌ Ошибка</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Шапка */}
      <header className="border-b p-3 flex items-center justify-between">
        <h1 className="font-semibold text-lg">AI Ассистент</h1>
        <div className="flex items-center gap-2">
          <Badge variant={wsStatus === 'connected' ? 'default' : 'secondary'}>
            {wsStatus === 'connected' ? '✅ Онлайн' : '⏳ Оффлайн'}
          </Badge>
        </div>
      </header>

      {/* Информация о странице */}
      {pageInfo?.title && (
        <div className="px-3 py-2 border-b bg-muted/50 text-sm text-muted-foreground truncate">
          📄 {pageInfo.title}
        </div>
      )}

      {/* Статус агента */}
      {agentStatus.state !== 'idle' && (
        <div className="px-3 py-2 border-b">
          {getStatusBadge()}
        </div>
      )}

      {/* Область сообщений */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-12">
              <p className="text-lg mb-2">👋 Привет!</p>
              <p>Задавайте вопросы про эту страницу, просите суммаризировать или искать информацию в интернете</p>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <Card className={`max-w-[85%] p-3 ${
                message.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              }`}>
                <div className="whitespace-pre-wrap text-sm">
                  {message.content || (isLoading && message.role === 'assistant' ? '...' : '')}
                </div>
              </Card>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Форма ввода */}
      <form onSubmit={sendMessage} className="p-3 border-t">
        <div className="flex gap-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Введите сообщение..."
            disabled={isLoading}
            className="flex-1"
            autoFocus
          />
          <Button
            type="submit"
            disabled={isLoading || !inputValue.trim()}
          >
            Отправить
          </Button>
        </div>
      </form>
    </div>
  );
}