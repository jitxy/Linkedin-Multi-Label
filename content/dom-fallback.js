(() => {
  'use strict';

  const SYNC_MIN_INTERVAL_MS = 1200;
  let lastSyncAt = 0;
  let timer = null;

  function isMessagingPage() {
    return location.href.includes('/messaging') || location.href.includes('/sales/inbox');
  }

  function cleanText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function getThreadIdFromUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url, location.origin);
      const match = parsed.pathname.match(/\/messaging\/thread\/([^/]+)/) || parsed.pathname.match(/\/sales\/inbox\/([^/]+)/);
      return match ? decodeURIComponent(match[1]) : '';
    } catch {
      const match = String(url).match(/\/messaging\/thread\/([^/?#]+)/) || String(url).match(/\/sales\/inbox\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : '';
    }
  }

  function looksLikeConversationRow(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const text = cleanText(el.innerText);
    if (text.length < 3) return false;
    if (text.includes('Search messages') || text.includes('More inboxes')) return false;
    if (el.querySelector('img') && (el.querySelector('a[href*="/messaging/thread/"]') || el.matches('[role="listitem"], li, .msg-conversation-listitem'))) return true;
    return el.matches('.msg-conversation-listitem, li.msg-conversations-container__convo-item, [data-occludable-job-id]');
  }

  function getConversationRows() {
    const rows = new Set();

    document.querySelectorAll('a[href*="/messaging/thread/"], a[href*="/sales/inbox/"]').forEach(link => {
      const row = link.closest('.msg-conversation-listitem, li, [role="listitem"], .artdeco-list__item') || link;
      if (looksLikeConversationRow(row)) rows.add(row);
    });

    document.querySelectorAll('.msg-conversation-listitem, li.msg-conversations-container__convo-item, [role="listitem"], .artdeco-list__item').forEach(row => {
      if (looksLikeConversationRow(row)) rows.add(row);
    });

    return Array.from(rows).slice(0, 80);
  }

  function extractName(row) {
    const selectors = [
      '.msg-conversation-listitem__participant-names',
      '.msg-conversation-card__participant-names',
      'h3',
      'strong',
      '[dir="ltr"] span[aria-hidden="true"]',
      'span[aria-hidden="true"]'
    ];

    for (const selector of selectors) {
      const el = row.querySelector(selector);
      const text = cleanText(el?.textContent);
      if (text && !/^(You|Messaging|Inbox|Jobs|Unread|Connections|InMail|Starred)$/i.test(text)) return text;
    }

    const lines = cleanText(row.innerText).split(' ').filter(Boolean);
    return lines.slice(0, 3).join(' ') || 'LinkedIn Conversation';
  }

  function extractTimestamp(row) {
    const text = cleanText(row.innerText);
    const match = text.match(/\b(\d{1,2}:\d{2}\s?(?:AM|PM)?|Yesterday|Today|\d{1,2}\/\d{1,2}\/\d{2,4}|\w{3}\s\d{1,2}|Jun\s\d{1,2}|Jul\s\d{1,2})\b/i);
    return match ? match[1] : '';
  }

  function extractSnippet(row, name) {
    const text = cleanText(row.innerText);
    if (!text) return '';

    let snippet = text.replace(name, '').replace(extractTimestamp(row), '').trim();
    snippet = snippet.replace(/^(Mobile|Online|You:|Received \d+ days? ago\. Reply\?|InMail)\s*/i, '').trim();
    snippet = snippet.replace(/\b(1st|2nd|3rd|He\/Him|She\/Her|Mobile|Online)\b/g, '').trim();

    const youMatch = text.match(/You:\s*(.+)$/i);
    if (youMatch) snippet = `You: ${cleanText(youMatch[1])}`;

    return snippet.slice(0, 150);
  }

  function extractAvatar(row) {
    const img = row.querySelector('img[src]');
    return img?.src || '';
  }

  function parseRow(row, index) {
    const link = row.querySelector('a[href*="/messaging/thread/"], a[href*="/sales/inbox/"]');
    const href = link?.href || '';
    const name = extractName(row);
    const id = getThreadIdFromUrl(href) || `dom:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}:${index}`;
    const source = location.href.includes('/sales/inbox') ? 'sales_nav' : 'linkedin';

    return {
      id,
      name,
      snippet: extractSnippet(row, name),
      timestamp: extractTimestamp(row),
      avatarUrl: extractAvatar(row),
      isUnread: !!row.querySelector('[data-test-icon="unread-small"], .notification-badge, .msg-conversation-card__unread-count'),
      url: href || (source === 'sales_nav' ? 'https://www.linkedin.com/sales/inbox/' : `https://www.linkedin.com/messaging/thread/${encodeURIComponent(id)}/`),
      source,
      scrapedAt: Date.now(),
      syncMethod: 'dom_fallback'
    };
  }

  function scrapeDomConversations() {
    if (!isMessagingPage()) return [];
    const seen = new Set();
    const conversations = [];

    getConversationRows().forEach((row, index) => {
      try {
        const conversation = parseRow(row, index);
        if (!conversation.name || seen.has(conversation.id)) return;
        seen.add(conversation.id);
        conversations.push(conversation);
      } catch {}
    });

    return conversations;
  }

  async function syncDomConversations(force = false) {
    if (!force && Date.now() - lastSyncAt < SYNC_MIN_INTERVAL_MS) return;
    lastSyncAt = Date.now();

    const conversations = scrapeDomConversations();
    if (!conversations.length) return;

    try {
      await chrome.runtime.sendMessage({ type: 'SYNC_CONVERSATIONS', conversations });
      chrome.runtime.sendMessage({ type: 'CONVERSATIONS_UPDATED' }).catch(() => {});
    } catch {}
  }

  function scheduleSync(force = false) {
    clearTimeout(timer);
    timer = setTimeout(() => syncDomConversations(force), force ? 100 : 500);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'FETCH_DOM_CONVERSATIONS') {
      const conversations = scrapeDomConversations();
      sendResponse({ ok: conversations.length > 0, conversations, count: conversations.length, source: 'dom_fallback' });
      return true;
    }
  });

  const observer = new MutationObserver(() => scheduleSync(false));
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('focus', () => scheduleSync(true));
  window.addEventListener('lml:navigate', () => scheduleSync(true));
  setInterval(() => scheduleSync(false), 5000);
  scheduleSync(true);
})();
