// Background Service Worker
// ВАЖНО: Этот файл НЕ обрабатывается Vite, остается чистым JS

// Открываем боковую панель при клике на иконку расширения
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Обработчик сообщений
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PAGE_CONTEXT') {
    getPageContext(sender.tab?.id).then(sendResponse);
    return true; // Асинхронный ответ
  }
});

async function getPageContext(tabId) {
  if (!tabId) {
    return { title: '', url: '', text: '', forms: [] };
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || !tab.url.startsWith('http')) {
      return {
        title: tab.title || '',
        url: tab.url || '',
        text: '',
        forms: []
      };
    }
  } catch {
    return { title: '', url: '', text: '', forms: [] };
  }

  try {
    // Пробуем получить контекст через content script
    return await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE' });
  } catch {
    // Fallback: выполняем скрипт напрямую
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        title: document.title,
        url: window.location.href,
        text: document.body.innerText.slice(0, 5000),
        forms: []
      })
    });
    return result?.result || { title: '', url: '', text: '', forms: [] };
  }
}

console.log('[AI Assistant] Background service worker loaded');