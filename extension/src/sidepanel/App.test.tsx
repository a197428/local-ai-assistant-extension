import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import App from './App';

const mockSendMessage = vi.fn().mockResolvedValue({ title: '', url: '', text: '' });

Object.defineProperty(globalThis, 'chrome', {
  value: {
    runtime: {
      sendMessage: mockSendMessage,
    },
  },
});

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  readyState = MockWebSocket.CONNECTING;
  url: string;

  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateError() {
    this.onerror?.(new Event('error'));
  }

  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  simulateRawMessage(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

let originalWebSocket: typeof globalThis.WebSocket;

beforeEach(() => {
  MockWebSocket.reset();
  originalWebSocket = globalThis.WebSocket;
  (globalThis as any).WebSocket = MockWebSocket;
  mockSendMessage.mockResolvedValue({ title: '', url: '', text: '' });
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as any).WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

function openWs(ws: MockWebSocket) {
  act(() => ws.simulateOpen());
}

describe('WebSocket lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('sets connected status on open', () => {
    render(<App />);
    const ws = MockWebSocket.instances[0];
    openWs(ws);
    expect(screen.getByText('✅ Онлайн')).toBeInTheDocument();
  });

  it('sets disconnected status on close', () => {
    render(<App />);
    const ws = MockWebSocket.instances[0];
    openWs(ws);
    act(() => ws.simulateClose());
    expect(screen.getByText('⏳ Оффлайн')).toBeInTheDocument();
  });

  it('reconnects with exponential backoff', () => {
    render(<App />);
    const ws1 = MockWebSocket.instances[0];
    act(() => ws1.simulateClose());
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(MockWebSocket.instances).toHaveLength(2);

    const ws2 = MockWebSocket.instances[1];
    act(() => ws2.simulateClose());

    act(() => { vi.advanceTimersByTime(2000); });
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it('does not reconnect after unmount', () => {
    const { unmount } = render(<App />);
    unmount();
    act(() => { vi.advanceTimersByTime(10000); });
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('resets retry counter on successful open', () => {
    render(<App />);

    const ws1 = MockWebSocket.instances[0];
    act(() => ws1.simulateClose());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(MockWebSocket.instances).toHaveLength(2);

    const ws2 = MockWebSocket.instances[1];
    openWs(ws2);
    act(() => ws2.simulateClose());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(MockWebSocket.instances).toHaveLength(3);
  });
});

describe('WS error handling', () => {
  it('shows error badge on WS error', () => {
    render(<App />);
    const ws = MockWebSocket.instances[0];
    act(() => ws.simulateError());
    expect(screen.getByText('❌ Ошибка')).toBeInTheDocument();
  });

  it('shows error message from backend in chat', async () => {
    const { container } = render(<App />);
    const ws = MockWebSocket.instances[0];
    openWs(ws);

    await act(async () => {
      const input = container.querySelector('input')!;
      const button = container.querySelector('button[type="submit"]')!;
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.click(button);
    });

    act(() => ws.simulateMessage({ type: 'error', message: 'Model not found' }));

    expect(screen.getByText('❌ Model not found')).toBeInTheDocument();
  });

  it('handles non-JSON messages gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<App />);

    const ws = MockWebSocket.instances[0];
    openWs(ws);

    act(() => ws.simulateRawMessage('not json!!!'));

    expect(screen.getByText('❌ Ошибка чтения ответа сервера')).toBeInTheDocument();
    consoleSpy.mockRestore();
  });
});

describe('REST fallback', () => {
  it('shows HTTP error status on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    } as Response);

    const { container } = render(<App />);

    await act(async () => {
      const input = container.querySelector('input')!;
      const button = container.querySelector('button[type="submit"]')!;
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(
        screen.getByText('❌ Ошибка сервера (500): Internal Server Error'),
      ).toBeInTheDocument();
    });
  });

  it('shows generic error on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new TypeError('Failed to fetch'),
    );

    const { container } = render(<App />);

    await act(async () => {
      const input = container.querySelector('input')!;
      const button = container.querySelector('button[type="submit"]')!;
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(
        screen.getByText('❌ Ошибка подключения к серверу'),
      ).toBeInTheDocument();
    });
  });
});

describe('WS send error', () => {
  it('clears loading state on send failure', async () => {
    const { container } = render(<App />);
    const ws = MockWebSocket.instances[0];
    openWs(ws);

    ws.send.mockImplementationOnce(() => {
      throw new Error('send failed');
    });

    await act(async () => {
      const input = container.querySelector('input')!;
      const button = container.querySelector('button[type="submit"]')!;
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.click(button);
    });

    expect(screen.getByText('❌ Ошибка отправки сообщения')).toBeInTheDocument();
    expect(container.querySelector('input')).not.toBeDisabled();
  });
});

describe('WS message handling', () => {
  it('appends token messages to last assistant message', async () => {
    const { container } = render(<App />);
    const ws = MockWebSocket.instances[0];
    openWs(ws);

    await act(async () => {
      const input = container.querySelector('input')!;
      const button = container.querySelector('button[type="submit"]')!;
      fireEvent.change(input, { target: { value: 'hello' } });
      fireEvent.click(button);
    });

    act(() => ws.simulateMessage({ type: 'token', content: 'Hi' }));
    act(() => ws.simulateMessage({ type: 'token', content: ' there' }));
    act(() => ws.simulateMessage({ type: 'done' }));

    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  it('clears loading on done', async () => {
    const { container } = render(<App />);
    const ws = MockWebSocket.instances[0];
    openWs(ws);

    await act(async () => {
      const input = container.querySelector('input')!;
      const button = container.querySelector('button[type="submit"]')!;
      fireEvent.change(input, { target: { value: 'hello' } });
      fireEvent.click(button);
    });

    act(() => ws.simulateMessage({ type: 'done' }));

    expect(container.querySelector('input')).not.toBeDisabled();
  });
});
