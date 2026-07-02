import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, Copy, Download } from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';

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
	const [wsStatus, setWsStatus] = useState<
		'connecting' | 'connected' | 'disconnected'
	>('disconnected');
	const [agentStatus, setAgentStatus] = useState<AgentStatus>({
		state: 'idle',
	});
	const [pageInfo, setPageInfo] = useState<PageContext | null>(null);
	const [copied, setCopied] = useState(false);

	const wsRef = useRef<WebSocket | null>(null);
	const wsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const wsRetryRef = useRef(0);
	const mountedRef = useRef(true);
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// Автоскролл к последнему сообщению
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages]);

	// Подключение WebSocket
	useEffect(() => {
		mountedRef.current = true;

		const connectWebSocket = () => {
			if (!mountedRef.current) return;

			const ws = new WebSocket(
				`${API_BASE.replace('http', 'ws')}/ws/${sessionId}`,
			);

			ws.onopen = () => {
				if (!mountedRef.current) return;
				wsRetryRef.current = 0;
				setWsStatus('connected');
				console.log('[WS] Connected');
			};

			ws.onclose = () => {
				if (!mountedRef.current) return;
				setWsStatus('disconnected');
				const delay = Math.min(1000 * 2 ** wsRetryRef.current, 30000);
				wsRetryRef.current++;
				console.log(`[WS] Disconnected, reconnecting in ${delay}ms`);
				wsReconnectRef.current = setTimeout(connectWebSocket, delay);
			};

			ws.onerror = error => {
				console.error('[WS] Error:', error);
				if (!mountedRef.current) return;
				setAgentStatus({
					state: 'error',
					message: 'Ошибка соединения с сервером',
				});
			};

			ws.onmessage = event => {
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
							setMessages(prev =>
								updateLastMessage(prev, `❌ ${data.message || 'Неизвестная ошибка'}`),
							);
							break;
					}
				} catch (err) {
					console.error('[WS] Parse error:', err);
					setMessages(prev =>
						updateLastMessage(prev, '❌ Ошибка чтения ответа сервера'),
					);
				}
			};

			wsRef.current = ws;
		};

		connectWebSocket();

		return () => {
			mountedRef.current = false;
			if (wsReconnectRef.current) {
				clearTimeout(wsReconnectRef.current);
			}
			wsRef.current?.close();
		};
	}, [sessionId]);

	// Получение контекста страницы при загрузке
	useEffect(() => {
		const loadPageContext = async () => {
			try {
				const context = await chrome.runtime.sendMessage({
					type: 'GET_PAGE_CONTEXT',
				});
				setPageInfo(context);
			} catch (err) {
				console.warn('Could not load page context:', err);
			}
		};

		loadPageContext();
	}, []);

	const updateLastMessage = (
		messages: Message[],
		content: string,
	): Message[] => {
		const updated = [...messages];
		const lastIndex = updated.length - 1;

		if (lastIndex >= 0 && updated[lastIndex].role === 'assistant') {
			updated[lastIndex] = {
				...updated[lastIndex],
				content: updated[lastIndex].content + content,
			};
		} else {
			updated.push({ role: 'assistant', content, timestamp: Date.now() });
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

	const convertToMarkdown = (): string => {
		if (messages.length === 0) {
			return 'Нет сообщений для экспорта';
		}

		const now = new Date();
		const dateStr = now.toLocaleDateString('ru-RU', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});

		let markdown = `# Диалог с AI Ассистентом\n\n`;
		markdown += `**Дата:** ${dateStr}\n`;

		if (pageInfo) {
			markdown += `**Страница:** ${pageInfo.title}\n`;
			markdown += `**URL:** ${pageInfo.url}\n\n`;
		}

		markdown += `---\n\n`;

		messages.forEach((message, _index) => {
			const role = message.role === 'user' ? 'Пользователь' : 'Ассистент';
			const timestamp = message.timestamp
				? new Date(message.timestamp).toLocaleTimeString('ru-RU', {
						hour: '2-digit',
						minute: '2-digit',
					})
				: '';

			markdown += `### ${role} ${timestamp ? `(${timestamp})` : ''}\n\n`;

			// Экранируем специальные символы Markdown
			const content = message.content
				.replace(/\n/g, '\n\n')
				.replace(/(^|\s)([*_`~|\\])/g, '$1\\$2');

			markdown += `${content}\n\n`;
		});

		markdown += `---\n\n*Экспортировано из Local AI Assistant Extension*`;

		return markdown;
	};

	const copyMarkdownToClipboard = async () => {
		const markdown = convertToMarkdown();

		try {
			await navigator.clipboard.writeText(markdown);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000); // Сброс через 2 секунды
		} catch (err) {
			console.error('Ошибка копирования в буфер обмена:', err);
			// Fallback для старых браузеров
			const textArea = document.createElement('textarea');
			textArea.value = markdown;
			document.body.appendChild(textArea);
			textArea.select();
			try {
				document.execCommand('copy');
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			} catch (fallbackErr) {
				console.error('Fallback копирование также не удалось:', fallbackErr);
				alert('Не удалось скопировать в буфер обмена');
			}
			document.body.removeChild(textArea);
		}
	};

	const downloadMarkdownFile = () => {
		const markdown = convertToMarkdown();
		const now = new Date();
		const dateStr = now.toISOString().split('T')[0];
		const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
		const filename = `ai-assistant-dialog-${dateStr}_${timeStr}.md`;

		const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
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
			{ role: 'assistant', content: '', timestamp: Date.now() },
		]);

		let pageContext: PageContext = { title: '', url: '', text: '' };
		try {
			pageContext = await chrome.runtime.sendMessage({
				type: 'GET_PAGE_CONTEXT',
			});
		} catch (err) {
			console.warn('Could not get page context:', err);
		}

		const payload = {
			message: userMessage,
			page_content: formatPageContext(pageContext),
			page_details: pageContext,
		};

		// Пробуем отправить через WebSocket
		if (wsRef.current?.readyState === WebSocket.OPEN) {
			try {
				wsRef.current.send(JSON.stringify(payload));
			} catch (err) {
				console.error('[WS] Send error:', err);
				setMessages(prev =>
					updateLastMessage(prev, '❌ Ошибка отправки сообщения'),
				);
				setIsLoading(false);
			}
			return;
		}

		// Fallback на REST API
		try {
			const response = await fetch(`${API_BASE}/chat/${sessionId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => '');
				const errorMsg = `❌ Ошибка сервера (${response.status})${errorText ? `: ${errorText}` : ''}`;
				setMessages(prev => updateLastMessage(prev, errorMsg));
				return;
			}

			const data = await response.json();
			setMessages(prev => updateLastMessage(prev, data.response));
		} catch (err) {
			console.error('API error:', err);
			setMessages(prev =>
				updateLastMessage(prev, '❌ Ошибка подключения к серверу'),
			);
		} finally {
			setIsLoading(false);
			setAgentStatus({ state: 'idle' });
		}
	};

	const getStatusBadge = () => {
		switch (agentStatus.state) {
			case 'thinking':
				return <Badge variant='secondary'>🤔 Думаю...</Badge>;
			case 'searching':
				return <Badge variant='secondary'>🔍 Ищу в интернете...</Badge>;
			case 'responding':
				return <Badge variant='secondary'>✍️ Пишу ответ...</Badge>;
			case 'error':
				return <Badge variant='destructive'>❌ Ошибка</Badge>;
			default:
				return null;
		}
	};

	return (
		<div className='flex flex-col h-screen bg-background text-foreground'>
			{/* Шапка */}
			<header className='border-b p-3 flex items-center justify-between'>
				<h1 className='font-semibold text-lg'>AI Ассистент</h1>
				<div className='flex items-center gap-2'>
					<div className='flex items-center gap-1 border-r pr-2'>
						<Button
							variant='ghost'
							size='sm'
							onClick={copyMarkdownToClipboard}
							disabled={messages.length === 0}
							title='Скопировать диалог в формате Markdown'
							className='gap-1 h-8'
						>
							{copied ? (
								<Check className='h-4 w-4' />
							) : (
								<Copy className='h-4 w-4' />
							)}
							<span className='hidden sm:inline'>Копировать</span>
						</Button>
						<Button
							variant='ghost'
							size='sm'
							onClick={downloadMarkdownFile}
							disabled={messages.length === 0}
							title='Скачать диалог как файл Markdown'
							className='gap-1 h-8'
						>
							<Download className='h-4 w-4' />
							<span className='hidden sm:inline'>Скачать</span>
						</Button>
					</div>
					<Badge variant={wsStatus === 'connected' ? 'default' : 'secondary'}>
						{wsStatus === 'connected' ? '✅ Онлайн' : '⏳ Оффлайн'}
					</Badge>
				</div>
			</header>

			{/* Информация о странице */}
			{pageInfo?.title && (
				<div className='px-3 py-2 border-b bg-muted/50 text-sm text-muted-foreground truncate'>
					📄 {pageInfo.title}
				</div>
			)}

			{/* Статус агента */}
			{agentStatus.state !== 'idle' && (
				<div className='px-3 py-2 border-b'>{getStatusBadge()}</div>
			)}

			{/* Область сообщений */}
			<ScrollArea className='flex-1 p-4'>
				<div className='space-y-4'>
					{messages.length === 0 && (
						<div className='text-center text-muted-foreground py-12'>
							<p className='text-lg mb-2'>👋 Привет!</p>
							<p>
								Задавайте вопросы про эту страницу, просите суммаризировать или
								искать информацию в интернете
							</p>
						</div>
					)}

					{messages.map((message, index) => (
						<div
							key={index}
							className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
						>
							<Card
								className={`max-w-[85%] p-3 ${
									message.role === 'user'
										? 'bg-primary text-primary-foreground'
										: 'bg-muted'
								}`}
							>
								<div className='whitespace-pre-wrap text-sm'>
									{message.content ||
										(isLoading && message.role === 'assistant' ? '...' : '')}
								</div>
							</Card>
						</div>
					))}
					<div ref={messagesEndRef} />
				</div>
			</ScrollArea>

			{/* Форма ввода */}
			<form onSubmit={sendMessage} className='p-3 border-t'>
				<div className='flex gap-2'>
					<Input
						value={inputValue}
						onChange={e => setInputValue(e.target.value)}
						placeholder='Введите сообщение...'
						disabled={isLoading}
						className='flex-1'
						autoFocus
					/>
					<Button type='submit' disabled={isLoading || !inputValue.trim()}>
						Отправить
					</Button>
				</div>
			</form>
		</div>
	);
}
