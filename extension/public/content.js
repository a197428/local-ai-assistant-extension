// Content Script
// ВАЖНО: Этот файл НЕ обрабатывается Vite, остается чистым JS

// Слушаем запросы от background на извлечение контента страницы
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_PAGE') {
    sendResponse(extractPageContext());
  }
  return false;
});

function extractPageContext() {
  return {
    title: document.title,
    url: window.location.href,
    text: extractCleanText(),
    forms: extractForms(),
    meta: extractMetaTags()
  };
}

function extractCleanText() {
  if (!document.body) {
    return '';
  }

  // Удаляем скрипты и стили
  const clone = document.body.cloneNode(true);
  const elements = clone.querySelectorAll('script, style, noscript, iframe');
  elements.forEach(el => el.remove());
  
  // Получаем чистый текст и обрезаем до 5000 символов
  let text = clone.innerText || clone.textContent || '';
  text = text.replace(/\s+/g, ' ').trim();
  
  return text.slice(0, 5000);
}

function extractForms() {
  return Array.from(document.forms).slice(0, 5).map((form, index) => ({
    id: form.id || `form_${index}`,
    action: form.action,
    method: form.method,
    fields: Array.from(form.elements)
      .filter(el => el.name && el.type !== 'hidden')
      .slice(0, 20)
      .map(el => ({
        name: el.name,
        type: el.type,
        label: el.labels?.[0]?.textContent?.trim() || ''
      }))
  }));
}

function extractMetaTags() {
  const meta = {};
  const metaTags = document.querySelectorAll('meta[name], meta[property]');
  
  metaTags.forEach(tag => {
    const name = tag.getAttribute('name') || tag.getAttribute('property');
    const content = tag.getAttribute('content');
    if (name && content) {
      meta[name] = content.slice(0, 200);
    }
  });
  
  return meta;
}

console.log('[AI Assistant] Content script loaded successfully');
