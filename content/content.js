(() => {
  'use strict';

  // ─── Detect page context ─────────────────────────────────────────────────

  function getPageContext() {
    const url = location.href;
    if (url.includes('/sales/inbox') || url.includes('/sales/lead')) return 'sales_nav';
    if (url.includes('/messaging')) return 'messaging';
    if (url.includes('/in/')) return 'profile';
    return 'other';
  }

  // ─── SPA navigation detection ─────────────────────────────────────────────

  function patchHistoryPushState() {
    const orig = history.pushState.bind(history);
    history.pushState = (...args) => {
      orig(...args);
      window.dispatchEvent(new Event('lml:navigate'));
    };
    window.addEventListener('popstate', () => {
      window.dispatchEvent(new Event('lml:navigate'));
    });
  }

  // ─── Conversation scraping — LinkedIn messaging ────────────────────────────

  function scrapeLinkedInConversations() {
    const items = document.querySelectorAll(
      '.msg-conversation-listitem, .msg-conversations-container__convo-item'
    );
    const conversations = [];

    items.forEach(item => {
      try {
        const link = item.querySelector('a[href*="/messaging/thread/"]');
        if (!link) return;

        const href = link.getAttribute('href') || '';
        const match = href.match(/\/messaging\/thread\/([^/?]+)/);
        if (!match) return;
        const id = match[1];

        const nameEl = item.querySelector(
          '.msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names'
        );
        const snippetEl = item.querySelector(
          '.msg-conversation-card__message-snippet, .msg-conversation-listitem__message-snippet'
        );
        const timeEl = item.querySelector(
          '.msg-conversation-listitem__time-stamp, .msg-conversation-card__time-stamp, time'
        );
        const imgEl = item.querySelector('img');
        const unreadEl = item.querySelector('.notification-badge, .msg-conversation-card__unread-count');

        const name = nameEl?.textContent?.trim() || 'Unknown';
        const snippet = snippetEl?.textContent?.trim() || '';
        const timestamp = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
        const avatarUrl = imgEl?.src || '';
        const isUnread = !!unreadEl;

        conversations.push({
          id,
          name,
          snippet,
          timestamp,
          avatarUrl,
          isUnread,
          url: `https://www.linkedin.com/messaging/thread/${id}/`,
          source: 'linkedin',
          scrapedAt: Date.now(),
        });
      } catch {
        // skip malformed items
      }
    });

    return conversations;
  }

  // ─── Conversation scraping — Sales Navigator ──────────────────────────────

  function scrapeSalesNavConversations() {
    const items = document.querySelectorAll(
      '.artdeco-list__item, [data-control-name="view_thread"]'
    );
    const conversations = [];

    items.forEach(item => {
      try {
        const link = item.querySelector('a[href*="/sales/inbox/"]');
        if (!link) return;

        const href = link.getAttribute('href') || '';
        const match = href.match(/\/sales\/inbox\/([^/?]+)/);
        if (!match) return;
        const id = match[1];

        const nameEl = item.querySelector(
          '.artdeco-entity-lockup__title, .message-item__sender-name, span[data-anonymize]'
        );
        const snippetEl = item.querySelector(
          '.message-item__message-body, .artdeco-entity-lockup__subtitle'
        );
        const timeEl = item.querySelector('time, .message-item__time');
        const imgEl = item.querySelector('img');
        const unreadEl = item.querySelector('.notification-badge');

        const name = nameEl?.textContent?.trim() || 'Unknown';
        const snippet = snippetEl?.textContent?.trim() || '';
        const timestamp = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
        const avatarUrl = imgEl?.src || '';
        const isUnread = !!unreadEl;

        conversations.push({
          id,
          name,
          snippet,
          timestamp,
          avatarUrl,
          isUnread,
          url: `https://www.linkedin.com/sales/inbox/${id}`,
          source: 'sales_nav',
          scrapedAt: Date.now(),
        });
      } catch {
        // skip malformed items
      }
    });

    return conversations;
  }

  function scrapeConversations() {
    const ctx = getPageContext();
    if (ctx === 'messaging') return scrapeLinkedInConversations();
    if (ctx === 'sales_nav') return scrapeSalesNavConversations();
    return [];
  }

  // ─── Sync to background ───────────────────────────────────────────────────

  let syncTimeout = null;

  function scheduleScrape() {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      const convos = scrapeConversations();
      if (convos.length > 0) {
        chrome.runtime.sendMessage({ type: 'SYNC_CONVERSATIONS', conversations: convos })
          .catch(() => {});
      }
    }, 600);
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────

  let observer = null;

  function startObserving() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => scheduleScrape());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Label button injection ───────────────────────────────────────────────

  const INJECTED_ATTR = 'data-lml-injected';

  async function injectLabelButtons() {
    const ctx = getPageContext();
    if (ctx !== 'messaging' && ctx !== 'sales_nav') return;

    // Thread header injection
    const headerSelectors = [
      '.msg-thread__link-to-profile',
      '.msg-entity-lockup',
      '.msg-s-message-list-container',
      '.thread-detail-link',
    ];

    let headerEl = null;
    for (const sel of headerSelectors) {
      headerEl = document.querySelector(sel);
      if (headerEl) break;
    }

    if (!headerEl || headerEl.hasAttribute(INJECTED_ATTR)) return;
    headerEl.setAttribute(INJECTED_ATTR, '1');

    const btn = document.createElement('button');
    btn.className = 'lml-label-btn';
    btn.innerHTML = '<span>🏷</span> Labels';
    btn.title = 'Assign labels to this conversation';

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await showLabelDropdown(btn);
    });

    const container = document.createElement('div');
    container.className = 'lml-btn-container';
    container.appendChild(btn);

    headerEl.parentNode?.insertBefore(container, headerEl.nextSibling);
  }

  async function showLabelDropdown(anchor) {
    const existing = document.querySelector('.lml-label-dropdown');
    if (existing) { existing.remove(); return; }

    let labels = [];
    try {
      const result = await chrome.storage.local.get('labels');
      labels = result.labels || [];
    } catch { return; }

    // Get current conversation ID from URL
    const convId = getCurrentConversationId();

    let convLabels = [];
    try {
      const result = await chrome.storage.local.get('conversations');
      const convos = result.conversations || [];
      const convo = convos.find(c => c.id === convId);
      convLabels = convo?.labels || [];
    } catch {}

    const dropdown = document.createElement('div');
    dropdown.className = 'lml-label-dropdown';

    if (labels.length === 0) {
      dropdown.innerHTML = `
        <div class="lml-dropdown-empty">
          No labels yet. Create labels in the extension side panel.
        </div>`;
    } else {
      dropdown.innerHTML = `
        <div class="lml-dropdown-header">Assign Labels</div>
        <div class="lml-dropdown-list">
          ${labels.map(l => `
            <label class="lml-dropdown-item">
              <input type="checkbox" data-label-id="${l.id}" ${convLabels.includes(l.id) ? 'checked' : ''}>
              <span class="lml-color-dot" style="background:${l.color}"></span>
              <span class="lml-label-name">${escapeHtml(l.name)}</span>
            </label>
          `).join('')}
        </div>`;

      dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', async () => {
          const labelId = cb.dataset.labelId;
          if (cb.checked) {
            await addLabelToConversation(convId, labelId);
          } else {
            await removeLabelFromConversation(convId, labelId);
          }
          // Notify sidepanel
          chrome.runtime.sendMessage({ type: 'CONVERSATIONS_UPDATED' }).catch(() => {});
        });
      });
    }

    document.body.appendChild(dropdown);

    const rect = anchor.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 8 + window.scrollY}px`;
    dropdown.style.left = `${rect.left + window.scrollX}px`;

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', () => dropdown.remove(), { once: true });
    }, 0);
  }

  function getCurrentConversationId() {
    const url = location.href;
    const linkedinMatch = url.match(/\/messaging\/thread\/([^/?]+)/);
    if (linkedinMatch) return linkedinMatch[1];
    const salesMatch = url.match(/\/sales\/inbox\/([^/?]+)/);
    if (salesMatch) return salesMatch[1];
    return null;
  }

  async function addLabelToConversation(convId, labelId) {
    if (!convId || !labelId) return;
    const result = await chrome.storage.local.get('conversations');
    const convos = result.conversations || [];
    const convo = convos.find(c => c.id === convId);
    if (!convo) return;
    if (!convo.labels) convo.labels = [];
    if (!convo.labels.includes(labelId)) {
      convo.labels.push(labelId);
      await chrome.storage.local.set({ conversations: convos });
    }
  }

  async function removeLabelFromConversation(convId, labelId) {
    if (!convId || !labelId) return;
    const result = await chrome.storage.local.get('conversations');
    const convos = result.conversations || [];
    const convo = convos.find(c => c.id === convId);
    if (!convo) return;
    convo.labels = (convo.labels || []).filter(id => id !== labelId);
    await chrome.storage.local.set({ conversations: convos });
  }

  // ─── Message sending ──────────────────────────────────────────────────────

  function findMessageInput() {
    const selectors = [
      '.msg-form__contenteditable',
      '.msg-form__msg-content-container .ql-editor',
      'div[contenteditable="true"][role="textbox"]',
      'textarea.msg-form__contenteditable',
      '.compose-form__message-field',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findSendButton() {
    const selectors = [
      'button.msg-form__send-button',
      'button[type="submit"][aria-label*="Send"]',
      '.msg-form__send-toggle',
      'button[data-control-name="send"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function setContentEditable(el, text) {
    el.focus();
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    // Also use execCommand for compat
    try {
      document.execCommand('insertText', false, text);
    } catch {}
  }

  function setInputValue(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      setContentEditable(el, text);
    }
  }

  async function typeAndSend(text) {
    const input = findMessageInput();
    if (!input) {
      return { ok: false, error: 'Message input not found on this page' };
    }

    setInputValue(input, text);

    await new Promise(r => setTimeout(r, 300));

    const sendBtn = findSendButton();
    if (!sendBtn) {
      return { ok: false, error: 'Send button not found — message typed, please send manually' };
    }

    sendBtn.click();
    return { ok: true };
  }

  // ─── Message listener ─────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'TYPE_AND_SEND') {
      typeAndSend(message.text).then(sendResponse);
      return true;
    }
    if (message.type === 'SCRAPE_NOW') {
      const convos = scrapeConversations();
      sendResponse({ conversations: convos });
      return true;
    }
    if (message.type === 'GET_CURRENT_CONVERSATION_ID') {
      sendResponse({ id: getCurrentConversationId() });
      return true;
    }
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    patchHistoryPushState();
    startObserving();
    scheduleScrape();

    // Re-run on SPA navigation
    window.addEventListener('lml:navigate', () => {
      scheduleScrape();
      setTimeout(injectLabelButtons, 1500);
    });

    // Initial label button injection
    setTimeout(injectLabelButtons, 2000);
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
