(() => {
  'use strict';

  // ─── Page context ─────────────────────────────────────────────────────────

  function getPageContext() {
    const url = location.href;
    if (url.includes('/sales/inbox') || url.includes('/sales/lead') || url.includes('/sales/people')) return 'sales_nav';
    if (url.includes('/messaging')) return 'messaging';
    if (url.includes('/in/')) return 'profile';
    return 'other';
  }

  // ─── SPA navigation ───────────────────────────────────────────────────────

  function patchHistoryPushState() {
    const orig = history.pushState.bind(history);
    history.pushState = (...args) => {
      orig(...args);
      window.dispatchEvent(new Event('lml:navigate'));
    };
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('lml:navigate')));
  }

  // ─── Listen for API data from interceptor.js (MAIN world) ─────────────────

  window.addEventListener('lml:conversations', (e) => {
    const conversations = e.detail;
    if (!Array.isArray(conversations) || conversations.length === 0) return;
    chrome.runtime.sendMessage({ type: 'SYNC_CONVERSATIONS', conversations }).catch(() => {});
  });

  // ─── DOM helpers ──────────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ─── Find the conversation LIST sidebar (not the message thread panel) ────

  function findConversationSidebar() {
    // Strategy: find a scrollable container that holds multiple LI items
    // each with a profile image, on the LEFT side of the viewport.

    // 1. Try known stable container roles / landmarks
    const candidates = [
      document.querySelector('[data-control-name="conversations_list"]'),
      document.querySelector('aside ul'),
      document.querySelector('nav ul'),
    ].filter(Boolean);

    // 2. Find UL/OL elements that look like conversation lists
    const lists = document.querySelectorAll('ul, ol');
    for (const list of lists) {
      const items = list.querySelectorAll(':scope > li');
      if (items.length < 2) continue;

      // Count items that have both an image and a link
      let score = 0;
      for (const li of items) {
        const hasImg = !!li.querySelector('img');
        const hasLink = !!li.querySelector('a[href]');
        const hasText = (li.textContent?.trim().length || 0) > 5;
        if (hasImg && hasText) score++;
        if (hasLink) score += 0.5;
      }

      if (score >= 2) {
        // Make sure this list is on the left half of the viewport
        const rect = list.getBoundingClientRect();
        if (rect.left < window.innerWidth * 0.55) {
          candidates.unshift(list);
        }
      }
    }

    return candidates[0] || null;
  }

  // ─── Walk up from a link to find its conversation card container ──────────

  function findConversationCard(linkEl) {
    let el = linkEl.parentElement;
    for (let depth = 0; depth < 10 && el && el !== document.body; depth++) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'li' || tag === 'article') return el;
      if (el.children.length >= 2) {
        const h = el.getBoundingClientRect().height;
        if (h >= 50 && h <= 250) return el;
      }
      el = el.parentElement;
    }
    return linkEl.parentElement || linkEl;
  }

  // ─── Extractors (class-name-free) ─────────────────────────────────────────

  function extractName(card) {
    // img[alt] is the most reliable: LinkedIn sets it to the person's name
    for (const img of card.querySelectorAll('img[alt]')) {
      const alt = img.alt?.trim();
      if (alt && alt.length > 1 && alt.length < 80
        && !alt.toLowerCase().includes('linkedin')
        && !/^https?:/.test(alt)
        && alt !== 'Photo'
        && alt !== 'View image'
        && alt !== 'Profile photo') {
        return alt;
      }
    }
    // aria-label on any child
    for (const el of card.querySelectorAll('[aria-label]')) {
      const label = (el.getAttribute('aria-label') || '').trim();
      if (label.length > 1 && label.length < 80 && !label.includes('\n')) return label;
    }
    // data-anonymize (Sales Nav)
    const anon = card.querySelector('[data-anonymize="person-name"]');
    if (anon?.textContent?.trim()) return anon.textContent.trim();

    // First bold leaf text
    for (const el of card.querySelectorAll('span, strong, p')) {
      if (el.children.length > 0) continue;
      const text = el.textContent?.trim();
      if (!text || text.length < 2 || text.length > 80) continue;
      if (parseInt(window.getComputedStyle(el).fontWeight) >= 600) return text;
    }
    return 'Unknown';
  }

  function extractSnippet(card) {
    const texts = [];
    for (const el of card.querySelectorAll('span, p, div')) {
      if (el.children.length > 0) continue;
      const text = el.textContent?.trim();
      if (!text || text.length < 3 || text.length > 200) continue;
      if (parseInt(window.getComputedStyle(el).fontWeight) <= 400) texts.push(text);
    }
    return texts.sort((a, b) => b.length - a.length)[0] || '';
  }

  function extractTimestamp(card) {
    const timeEl = card.querySelector('time');
    if (timeEl) return timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || '';
    for (const el of card.querySelectorAll('span, div')) {
      if (el.children.length > 0) continue;
      const text = (el.textContent || '').trim();
      if (/^(\d{1,2}(:\d{2})?\s*(am|pm)?|\d{1,2}[\/\-]\d{1,2}|yesterday|today|now|[a-z]{3}\s+\d{1,2}|\d+[mhd] ago)$/i.test(text)) {
        return text;
      }
    }
    return '';
  }

  function extractAvatar(card) {
    for (const img of card.querySelectorAll('img')) {
      const src = img.src || '';
      if (src.includes('licdn') || src.includes('media') || src.includes('profile')) return src;
    }
    return card.querySelector('img')?.src || '';
  }

  function detectUnread(card) {
    if (card.querySelector('[aria-label*="nread"]')) return true;
    const badge = card.querySelector('[data-control-name="notification_badge"]');
    if (badge?.textContent?.trim()) return true;
    return false;
  }

  // ─── DOM scraper: scoped to sidebar only ──────────────────────────────────

  function scrapeLinkedInConversations() {
    const sidebar = findConversationSidebar();
    const scope = sidebar || document;

    // Find thread links ONLY within the sidebar scope
    const threadLinks = Array.from(scope.querySelectorAll('a[href]')).filter(a => {
      const href = a.getAttribute('href') || '';
      return href.includes('/messaging/thread/');
    });

    const seen = new Set();
    const conversations = [];

    for (const link of threadLinks) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/messaging\/thread\/([^/?#]+)/);
      if (!match) continue;
      const id = decodeURIComponent(match[1]);
      if (seen.has(id)) continue;
      seen.add(id);

      const card = findConversationCard(link);
      conversations.push({
        id,
        name: extractName(card),
        snippet: extractSnippet(card),
        timestamp: extractTimestamp(card),
        avatarUrl: extractAvatar(card),
        isUnread: detectUnread(card),
        url: `https://www.linkedin.com/messaging/thread/${match[1]}/`,
        source: 'linkedin',
        scrapedAt: Date.now(),
      });
    }

    // If the sidebar finder didn't work, also try: look for LI items that
    // have profile images and are on the left side of the page
    if (conversations.length === 0) {
      conversations.push(...scrapeByListItems());
    }

    return conversations;
  }

  function scrapeByListItems() {
    const results = [];
    const seen = new Set();
    const halfWidth = window.innerWidth * 0.55;

    for (const li of document.querySelectorAll('li')) {
      const rect = li.getBoundingClientRect();
      // Must be on the left side and look like a conversation item
      if (rect.left > halfWidth || rect.height < 50 || rect.height > 200) continue;
      if (!li.querySelector('img')) continue;

      const link = li.querySelector('a[href*="/messaging/thread/"]');
      if (!link) continue;

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/messaging\/thread\/([^/?#]+)/);
      if (!match) continue;
      const id = decodeURIComponent(match[1]);
      if (seen.has(id)) continue;
      seen.add(id);

      results.push({
        id,
        name: extractName(li),
        snippet: extractSnippet(li),
        timestamp: extractTimestamp(li),
        avatarUrl: extractAvatar(li),
        isUnread: detectUnread(li),
        url: `https://www.linkedin.com/messaging/thread/${match[1]}/`,
        source: 'linkedin',
        scrapedAt: Date.now(),
      });
    }
    return results;
  }

  // ─── Sales Navigator scraper ──────────────────────────────────────────────

  function scrapeSalesNavConversations() {
    const halfWidth = window.innerWidth * 0.55;
    const seen = new Set();
    const conversations = [];

    for (const link of document.querySelectorAll('a[href*="/sales/inbox/"]')) {
      const rect = link.getBoundingClientRect();
      if (rect.left > halfWidth) continue; // skip right-side content

      const href = link.getAttribute('href') || '';
      const match = href.match(/\/sales\/inbox\/([^/?#]+)/);
      if (!match) continue;
      const id = match[1];
      if (seen.has(id)) continue;
      seen.add(id);

      const card = findConversationCard(link);
      conversations.push({
        id,
        name: extractName(card),
        snippet: extractSnippet(card),
        timestamp: extractTimestamp(card),
        avatarUrl: extractAvatar(card),
        isUnread: detectUnread(card),
        url: `https://www.linkedin.com/sales/inbox/${id}`,
        source: 'sales_nav',
        scrapedAt: Date.now(),
      });
    }
    return conversations;
  }

  function scrapeConversations() {
    const ctx = getPageContext();
    if (ctx === 'sales_nav') return scrapeSalesNavConversations();
    return scrapeLinkedInConversations();
  }

  // ─── Scheduled DOM scrape with retry ─────────────────────────────────────

  let syncTimeout = null;
  let retryCount = 0;

  function scheduleScrape(delay = 1200) {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      const convos = scrapeConversations();
      if (convos.length > 0) {
        retryCount = 0;
        chrome.runtime.sendMessage({ type: 'SYNC_CONVERSATIONS', conversations: convos }).catch(() => {});
      } else if (retryCount < 6) {
        retryCount++;
        scheduleScrape(1000 * Math.pow(1.6, retryCount)); // exponential backoff up to ~26s
      }
    }, delay);
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────

  let observer = null;
  let mutationTimer = null;

  function startObserving() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => scheduleScrape(500), 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Message input detection ──────────────────────────────────────────────

  function findMessageInput() {
    const selectors = [
      '.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="message" i]',
      'textarea[placeholder*="write" i]',
      'textarea[name*="message"]',
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el)) return el;
      }
    }
    return null;
  }

  function findSendButton() {
    // aria-label is the most stable attribute on LinkedIn's send button
    const byAria = Array.from(document.querySelectorAll('button[aria-label]')).find(btn => {
      const label = btn.getAttribute('aria-label')?.toLowerCase() || '';
      return (label.includes('send') || label === 'send message') && isVisible(btn) && !btn.disabled;
    });
    if (byAria) return byAria;

    // title attribute
    const byTitle = Array.from(document.querySelectorAll('button[title]')).find(btn =>
      btn.getAttribute('title')?.toLowerCase().includes('send') && isVisible(btn) && !btn.disabled
    );
    if (byTitle) return byTitle;

    // Traverse up from compose box to find nearby send button
    const input = findMessageInput();
    if (input) {
      let parent = input.parentElement;
      for (let i = 0; i < 6 && parent; i++) {
        const btns = Array.from(parent.querySelectorAll('button')).filter(b => isVisible(b) && !b.disabled);
        const send = btns.find(b => {
          const txt = b.textContent?.toLowerCase() || '';
          const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
          const ctrl = (b.getAttribute('data-control-name') || '').toLowerCase();
          return txt.includes('send') || lbl.includes('send') || ctrl.includes('send');
        });
        if (send) return send;
        parent = parent.parentElement;
      }
    }

    return null;
  }

  // ─── Type into contenteditable (React-compatible) ─────────────────────────

  function typeIntoInput(el, text) {
    el.focus();
    // Select all existing text
    document.execCommand('selectAll', false);
    // insertText fires React's synthetic onChange
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      // Fallback: InputEvent approach
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      el.textContent = text;
      // Move caret to end
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
  }

  async function typeAndSend(text) {
    const input = findMessageInput();
    if (!input) return { ok: false, error: 'Message input not found — make sure a LinkedIn conversation is open.' };

    typeIntoInput(input, text);
    await new Promise(r => setTimeout(r, 450));

    const sendBtn = findSendButton();
    if (!sendBtn) return { ok: false, error: 'Text typed but send button not found — click Send manually.' };

    sendBtn.click();
    return { ok: true };
  }

  // ─── Label injection into thread header ───────────────────────────────────

  const INJECTED_ATTR = 'data-lml-injected';

  async function injectLabelButton() {
    const ctx = getPageContext();
    if (ctx !== 'messaging' && ctx !== 'sales_nav') return;
    if (document.querySelector('.lml-btn-container')) return; // already injected

    // Find a stable container near the top of the conversation thread
    const threadHeader =
      document.querySelector('[data-control-name="view_conversation_header"]') ||
      document.querySelector('h1') ||
      (() => {
        const input = findMessageInput();
        if (!input) return null;
        let el = input.parentElement;
        for (let i = 0; i < 8 && el; i++) {
          if (el.getBoundingClientRect().height > 300) return el;
          el = el.parentElement;
        }
        return null;
      })();

    if (!threadHeader || threadHeader.hasAttribute(INJECTED_ATTR)) return;
    threadHeader.setAttribute(INJECTED_ATTR, '1');

    const container = document.createElement('div');
    container.className = 'lml-btn-container';

    const btn = document.createElement('button');
    btn.className = 'lml-label-btn';
    btn.innerHTML = '<span>🏷</span> Labels';
    btn.title = 'Assign labels to this conversation';
    btn.addEventListener('click', (e) => { e.stopPropagation(); showLabelDropdown(btn); });

    container.appendChild(btn);
    threadHeader.appendChild(container);
  }

  async function showLabelDropdown(anchor) {
    document.querySelector('.lml-label-dropdown')?.remove();

    const [{ labels = [] }, { conversations = [] }] = await Promise.all([
      chrome.storage.local.get('labels'),
      chrome.storage.local.get('conversations'),
    ]);

    const convId = getCurrentConversationId();
    const convo = conversations.find(c => c.id === convId);
    const convLabels = convo?.labels || [];

    const dropdown = document.createElement('div');
    dropdown.className = 'lml-label-dropdown';

    if (labels.length === 0) {
      dropdown.innerHTML = `<div class="lml-dropdown-empty">No labels yet.<br>Create them in the extension side panel.</div>`;
    } else {
      const hdr = document.createElement('div');
      hdr.className = 'lml-dropdown-header';
      hdr.textContent = 'Assign Labels';
      dropdown.appendChild(hdr);

      const list = document.createElement('div');
      list.className = 'lml-dropdown-list';

      for (const label of labels) {
        const item = document.createElement('label');
        item.className = 'lml-dropdown-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.labelId = label.id;
        cb.checked = convLabels.includes(label.id);

        const dot = document.createElement('span');
        dot.className = 'lml-color-dot';
        dot.style.background = label.color;

        const name = document.createElement('span');
        name.className = 'lml-label-name';
        name.textContent = label.name;

        cb.addEventListener('change', async () => {
          await toggleLabel(convId, label.id, cb.checked);
          chrome.runtime.sendMessage({ type: 'CONVERSATIONS_UPDATED' }).catch(() => {});
        });

        item.append(cb, dot, name);
        list.appendChild(item);
      }
      dropdown.appendChild(list);
    }

    document.body.appendChild(dropdown);
    const rect = anchor.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 6 + window.scrollY}px`;
    dropdown.style.left = `${Math.max(4, rect.left + window.scrollX)}px`;

    setTimeout(() => document.addEventListener('click', () => dropdown.remove(), { once: true }), 0);
  }

  function getCurrentConversationId() {
    const m1 = location.href.match(/\/messaging\/thread\/([^/?#]+)/);
    if (m1) return decodeURIComponent(m1[1]);
    const m2 = location.href.match(/\/sales\/inbox\/([^/?#]+)/);
    if (m2) return m2[1];
    return null;
  }

  async function toggleLabel(convId, labelId, add) {
    if (!convId || !labelId) return;
    const { conversations = [] } = await chrome.storage.local.get('conversations');
    let convo = conversations.find(c => c.id === convId);
    if (!convo) {
      convo = { id: convId, name: document.title || 'Conversation', snippet: '', url: location.href, labels: [], source: getPageContext() === 'sales_nav' ? 'sales_nav' : 'linkedin', scrapedAt: Date.now() };
      conversations.push(convo);
    }
    if (!convo.labels) convo.labels = [];
    if (add) { if (!convo.labels.includes(labelId)) convo.labels.push(labelId); }
    else { convo.labels = convo.labels.filter(id => id !== labelId); }
    await chrome.storage.local.set({ conversations });
  }

  // ─── Message listener (from background / sidepanel) ──────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'TYPE_AND_SEND') { typeAndSend(msg.text).then(sendResponse); return true; }
    if (msg.type === 'SCRAPE_NOW') { sendResponse({ conversations: scrapeConversations() }); return true; }
    if (msg.type === 'GET_CURRENT_CONVERSATION_ID') { sendResponse({ id: getCurrentConversationId() }); return true; }
    if (msg.type === 'PING') { sendResponse({ ok: true }); return true; }
  });

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    patchHistoryPushState();
    startObserving();

    // Staggered DOM scrapes for lazy-loaded content
    scheduleScrape(1500);

    window.addEventListener('lml:navigate', () => {
      retryCount = 0;
      scheduleScrape(800);
      setTimeout(injectLabelButton, 2000);
    });

    setTimeout(injectLabelButton, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
