// Background Service Worker
// ВАЖНО: Этот файл НЕ обрабатывается Vite, остается чистым JS

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PAGE_CONTEXT') {
    getPageContext(sender.tab?.id).then(sendResponse);
    return true;
  }
});

async function getPageContext(tabId) {
  if (!tabId) {
    tabId = await getActiveTabId();
  }

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
        forms: [],
        _blocked: true,
      };
    }
  } catch {
    return { title: '', url: '', text: '', forms: [], _blocked: true };
  }

  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE' });
  } catch {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const sensitiveUrlPatterns = [
          /^chrome:\/\//,
          /^chrome-extension:\/\//,
          /^file:\/\//,
          /^about:/,
        ];
        const sensitiveFieldTypes = new Set([
          'password', 'email', 'tel', 'credit-card',
          'cc-number', 'cc-exp', 'cc-csc',
        ]);
        const sensitiveFieldNames = /password|passwd|secret|token|api[_-]?key|credit|card|ssn|pin/i;
        const url = window.location.href;

        if (sensitiveUrlPatterns.some(pattern => pattern.test(url))) {
          return {
            title: document.title,
            url,
            text: '',
            forms: [],
            meta: {},
            _blocked: true,
          };
        }

        const clone = document.body?.cloneNode(true);
        if (clone) {
          clone
            .querySelectorAll('script, style, noscript, iframe, input, textarea, select')
            .forEach(el => el.remove());
        }

        const text = (clone?.innerText || clone?.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 5000);

        const isSensitiveField = el => {
          if (sensitiveFieldTypes.has(el.type)) return true;
          if (sensitiveFieldNames.test(el.name)) return true;
          if (sensitiveFieldNames.test(el.id)) return true;
          const label = el.labels?.[0]?.textContent || '';
          return sensitiveFieldNames.test(label);
        };

        const forms = Array.from(document.forms).slice(0, 5).map((form, index) => ({
          id: form.id || `form_${index}`,
          action: form.action,
          method: form.method,
          fields: Array.from(form.elements)
            .filter(el => el.name && el.type !== 'hidden' && !isSensitiveField(el))
            .slice(0, 20)
            .map(el => ({
              name: el.name,
              type: el.type,
              label: el.labels?.[0]?.textContent?.trim() || '',
            })),
        }));

        return {
          title: document.title,
          url,
          text,
          forms,
        };
      }
    });
    return result?.result || { title: '', url: '', text: '', forms: [] };
  }
}

async function getActiveTabId() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return activeTab?.id;
  } catch {
    return undefined;
  }
}

console.log('[AI Assistant] Background service worker loaded');
