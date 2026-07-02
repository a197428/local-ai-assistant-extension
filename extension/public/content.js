// Content Script
// ВАЖНО: Этот файл НЕ обрабатывается Vite, остается чистым JS

const SENSITIVE_URL_PATTERNS = [
  /^chrome:\/\//,
  /^chrome-extension:\/\//,
  /^file:\/\//,
  /^about:/,
];

const SENSITIVE_FIELD_TYPES = new Set([
  'password', 'email', 'tel', 'credit-card',
  'cc-number', 'cc-exp', 'cc-csc',
]);

const SENSITIVE_FIELD_NAMES = /password|passwd|secret|token|api[_-]?key|credit|card|ssn|pin/i;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'EXTRACT_PAGE') {
    sendResponse(extractPageContext());
  }
  return false;
});

function isSensitivePage() {
  const url = window.location.href;
  return SENSITIVE_URL_PATTERNS.some(p => p.test(url));
}

function extractPageContext() {
  if (isSensitivePage()) {
    return {
      title: document.title,
      url: window.location.href,
      text: '',
      forms: [],
      meta: {},
      _blocked: true,
    };
  }

  return {
    title: document.title,
    url: window.location.href,
    text: extractCleanText(),
    forms: extractForms(),
    meta: extractMetaTags(),
  };
}

function extractCleanText() {
  if (!document.body) {
    return '';
  }

  const clone = document.body.cloneNode(true);
  const elements = clone.querySelectorAll('script, style, noscript, iframe, input, textarea, select');
  elements.forEach(el => el.remove());

  let text = clone.innerText || clone.textContent || '';
  text = text.replace(/\s+/g, ' ').trim();

  return text.slice(0, 5000);
}

function isSensitiveField(el) {
  if (SENSITIVE_FIELD_TYPES.has(el.type)) return true;
  if (SENSITIVE_FIELD_NAMES.test(el.name)) return true;
  if (SENSITIVE_FIELD_NAMES.test(el.id)) return true;
  const label = el.labels?.[0]?.textContent || '';
  if (SENSITIVE_FIELD_NAMES.test(label)) return true;
  return false;
}

function extractForms() {
  return Array.from(document.forms).slice(0, 5).map((form, index) => ({
    id: form.id || `form_${index}`,
    action: form.action,
    method: form.method,
    fields: Array.from(form.elements)
      .filter(el => el.name && el.type !== 'hidden' && !isSensitiveField(el))
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
