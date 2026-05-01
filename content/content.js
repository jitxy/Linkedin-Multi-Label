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
    window.addEventListener('popstate', () => {
      window.dispatchEvent(new Event('lml:navigate'));
    });
  }

  // ─── DOM helpers ──────────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /** Walk up the DOM from `linkEl` until we hit a container that looks like a conversation card. */
  function findConversationCard(linkEl) {
    let el = linkEl.parentElement;
    for (let depth = 0; depth < 12 && el && el !== document.body; depth++) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'li' || tag === 'article') return el;
      // A container with multiple sibling-children and at least 55px tall is likely a card
      if (el.children.length >= 2) {
        const h = el.getBoundingClientRect().height;
        if (h >= 55 && h <= 200) return el;
      }
      el = el.parentElement;
    }
    return linkEl.parentElement || linkEl;
  }

  // ─── Extract name from a conversation card ────────────────────────────────

  function extractName(card) {
    // 1. img[alt] — profile photos have alt=person name
    const imgs = card.querySelectorAll('img[alt]');
    for (const img of imgs) {
      const alt = img.alt?.trim();
      if (alt && alt.length > 1 && alt.length < 80 && !alt.toLowerCase().includes('linkedin') && !/^https?:/.test(alt)) {
        return alt;
      }
    }

    // 2. aria-label on spans or links inside the card
    const ariaEls = card.querySelectorAll('[aria-label]');
    for (const el of ariaEls) {
      const label = (el.getAttribute('aria-label') || '').trim();
      if (label.length > 1 && label.length < 80 && !label.includes('\n')) return label;
    }

    // 3. data-anonymize or data-control-name attributes (LinkedIn uses these for accessibility)
    const anonEl = card.querySelector('[data-anonymize="person-name"]');
    if (anonEl?.textContent?.trim()) return anonEl.textContent.trim();

    // 4. First bold/semibold leaf text element
    const allSpans = card.querySelectorAll('span, strong, p');
    for (const el of allSpans) {
      if (el.children.length > 0) continue;
      const text = el.textContent?.trim();
      if (!text || text.length < 2 || text.length > 80) continue;
      const fw = parseInt(window.getComputedStyle(el).fontWeight) || 400;
      if (fw >= 600) return text;
    }

    // 5. Longest short text in card
    for (const el of allSpans) {
      if (el.children.length > 0) continue;
      const text = el.textContent?.trim();
      if (text && text.length >= 2 && text.length <= 60) return text;
    }

    return 'Unknown';
  }

  function extractSnippet(card) {
    // Look for a lighter-weight or smaller text after the name
    const candidates = card.querySelectorAll('span, p, div');
    const texts = [];
    for (const el of candidates) {
      if (el.children.length > 0) continue;
      const text = el.textContent?.trim();
      if (!text || text.length < 3 || text.length > 200) continue;
      const fw = parseInt(window.getComputedStyle(el).fontWeight) || 400;
      if (fw <= 400) texts.push(text);
    }
    // Return the longest light-weight text (most likely the message preview)
    return texts.sort((a, b) => b.length - a.length)[0] || '';
  }

  function extractTimestamp(card) {
    const timeEl = card.querySelector('time');
    if (timeEl) return timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || '';
    // fallback: look for short text that looks like a time/date
    const els = card.querySelectorAll('span, div');
    for (const el of els) {
      if (el.children.length > 0) continue;
      const text = (el.textContent || '').trim();
      if (/^(\d{1,2}(:\d{2})?\s*(am|pm)?|\d{1,2}[\/\-]\d{1,2}|yesterday|today|now|[a-z]{3}\s+\d{1,2})$/i.test(text)) {
        return text;
      }
    }
    return '';
  }

  function extractAvatar(card) {
    const img = card.querySelector('img[src*="licdn"], img[src*="media"], img[src*="profile"]');
    return img?.src || card.querySelector('img')?.src || '';
  }

  function detectUnread(card) {
    // aria-label "unread" or a notification badge with content
    if (card.querySelector('[aria-label*="nread"]')) return true;
    const badge = card.querySelector('.notification-badge, [data-control-name="notification_badge"]');
    if (badge && badge.textContent?.trim()) return true;
    // Elements with a blue dot (small rounded elements with blue bg)
    const dots = card.querySelectorAll('*');
    for (const el of dots) {
      if (el.children.length > 0) continue;
      const style = window.getComputedStyle(el);
      const w = parseFloat(style.width);
      const h = parseFloat(style.height);
      if (w >= 6 && w <= 14 && Math.abs(w - h) <= 2) {
        const bg = style.backgroundColor;
        if (bg.includes('10, 102, 194') || bg.includes('0, 115, 177') || bg.includes('0, 97, 175')) return true;
      }
    }
    return false;
  }

  // ─── LinkedIn messaging scraper ───────────────────────────────────────────

  function scrapeLinkedInConversations() {
    // Anchor: find ALL links to /messaging/thread/ — these are reliable
    const threadLinks = Array.from(document.querySelectorAll('a[href*="/messaging/thread/"]'));
    const seen = new Set();
    const conversations = [];

    for (const link of threadLinks) {
      const match = link.href.match(/\/messaging\/thread\/([^/?#]+)/);
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
        url: `https://www.linkedin.com/messaging/thread/${id}/`,
        source: 'linkedin',
        scrapedAt: Date.now(),
      });
    }
    return conversations;
  }

  // ─── Sales Navigator scraper ──────────────────────────────────────────────

  function scrapeSalesNavConversations() {
    // Sales Nav inbox thread links
    const threadLinks = Array.from(
      document.querySelectorAll('a[href*="/sales/inbox/"], a[href*="/sales/lead/"]')
    );
    const seen = new Set();
    const conversations = [];

    for (const link of threadLinks) {
      let id, url;
      const inboxMatch = link.href.match(/\/sales\/inbox\/([^/?#]+)/);
      const leadMatch = link.href.match(/\/sales\/lead\/([^/?#]+)/);
      if (inboxMatch) {
        id = inboxMatch[1];
        url = `https://www.linkedin.com/sales/inbox/${id}`;
      } else if (leadMatch) {
        id = 'lead_' + leadMatch[1];
        url = link.href;
      } else continue;

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
        url,
        source: 'sales_nav',
        scrapedAt: Date.now(),
      });
    }
    return conversations;
  }

  function scrapeConversations() {
    const ctx = getPageContext();
    if (ctx === 'messaging') return scrapeLinkedInConversations();
    if (ctx === 'sales_nav') return scrapeSalesNavConversations();
    // On any LinkedIn page, still try messaging links
    const all = scrapeLinkedInConversations();
    return all;
  }

  // ─── Sync to background ───────────────────────────────────────────────────

  let syncTimeout = null;
  let syncAttempts = 0;

  function scheduleScrape(delay = 800) {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
      const convos = scrapeConversations();
      if (convos.length > 0) {
        syncAttempts = 0;
        chrome.runtime.sendMessage({ type: 'SYNC_CONVERSATIONS', conversations: convos }).catch(() => {});
      } else if (syncAttempts < 5) {
        // LinkedIn loads content lazily — retry with exponential backoff
        syncAttempts++;
        scheduleScrape(800 * Math.pow(1.8, syncAttempts));
      }
    }, delay);
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────

  let observer = null;
  let mutationDebounce = null;

  function startObserving() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(mutationDebounce);
      mutationDebounce = setTimeout(() => scheduleScrape(400), 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Label button injection ───────────────────────────────────────────────

  const INJECTED_ATTR = 'data-lml-injected';

  async function injectLabelButtons() {
    const ctx = getPageContext();
    if (ctx !== 'messaging' && ctx !== 'sales_nav') return;

    // Find the messaging thread header — look for a stable container near messages
    // LinkedIn's header is above the message list; use role/landmark selectors first
    const headerCandidates = [
      document.querySelector('[data-control-name="view_conversation_header"]'),
      document.querySelector('header[class*="msg"]'),
      document.querySelector('[role="banner"]'),
      document.querySelector('h1'),  // thread title h1
      document.querySelector('[aria-label*="Conversation"]'),
      // fallback: find the compose area and go up
      (() => {
        const compose = findMessageInput();
        if (!compose) return null;
        let el = compose.parentElement;
        for (let i = 0; i < 8 && el; i++) {
          if (el.getBoundingClientRect().height > 200) return el;
          el = el.parentElement;
        }
        return null;
      })(),
    ].filter(Boolean);

    let headerEl = headerCandidates[0];
    if (!headerEl || headerEl.hasAttribute(INJECTED_ATTR)) return;
    headerEl.setAttribute(INJECTED_ATTR, '1');

    const container = document.createElement('div');
    container.className = 'lml-btn-container';

    const btn = document.createElement('button');
    btn.className = 'lml-label-btn';
    btn.innerHTML = '<span>🏷</span> Labels';
    btn.title = 'Assign labels to this conversation (LinkedIn Multi-Label)';
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await showLabelDropdown(btn);
    });

    container.appendChild(btn);
    headerEl.appendChild(container);
  }

  async function showLabelDropdown(anchor) {
    const existing = document.querySelector('.lml-label-dropdown');
    if (existing) { existing.remove(); return; }

    const [labelsResult, convosResult] = await Promise.all([
      chrome.storage.local.get('labels'),
      chrome.storage.local.get('conversations'),
    ]);
    const labels = labelsResult.labels || [];
    const convId = getCurrentConversationId();
    const convos = convosResult.conversations || [];
    const convo = convos.find(c => c.id === convId);
    const convLabels = convo?.labels || [];

    const dropdown = document.createElement('div');
    dropdown.className = 'lml-label-dropdown';

    if (labels.length === 0) {
      dropdown.innerHTML = `<div class="lml-dropdown-empty">No labels yet.<br>Create labels in the extension side panel.</div>`;
    } else {
      const header = document.createElement('div');
      header.className = 'lml-dropdown-header';
      header.textContent = 'Assign Labels';
      dropdown.appendChild(header);

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
          if (cb.checked) {
            await addLabelToConversation(convId, label.id);
          } else {
            await removeLabelFromConversation(convId, label.id);
          }
          chrome.runtime.sendMessage({ type: 'CONVERSATIONS_UPDATED' }).catch(() => {});
        });

        item.appendChild(cb);
        item.appendChild(dot);
        item.appendChild(name);
        list.appendChild(item);
      }
      dropdown.appendChild(list);
    }

    document.body.appendChild(dropdown);
    const rect = anchor.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 6 + window.scrollY}px`;
    dropdown.style.left = `${Math.max(4, rect.left + window.scrollX)}px`;

    setTimeout(() => {
      document.addEventListener('click', () => dropdown.remove(), { once: true });
    }, 0);
  }

  function getCurrentConversationId() {
    const url = location.href;
    const m1 = url.match(/\/messaging\/thread\/([^/?#]+)/);
    if (m1) return m1[1];
    const m2 = url.match(/\/sales\/inbox\/([^/?#]+)/);
    if (m2) return m2[1];
    return null;
  }

  async function addLabelToConversation(convId, labelId) {
    if (!convId || !labelId) return;
    const result = await chrome.storage.local.get('conversations');
    const convos = result.conversations || [];
    let convo = convos.find(c => c.id === convId);
    if (!convo) {
      // Create a stub for this conversation if not yet scraped
      convo = {
        id: convId,
        name: document.title || 'LinkedIn Conversation',
        snippet: '',
        url: location.href,
        labels: [],
        source: getPageContext() === 'sales_nav' ? 'sales_nav' : 'linkedin',
        scrapedAt: Date.now(),
      };
      convos.push(convo);
    }
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

  // ─── Message input detection ──────────────────────────────────────────────

  function findMessageInput() {
    const selectors = [
      // Quill-based editor (LinkedIn uses Quill or similar)
      '.ql-editor[contenteditable="true"]',
      // Generic contenteditable textbox (ARIA role is most stable)
      'div[contenteditable="true"][role="textbox"]',
      // Sales Navigator compose
      'div[contenteditable="true"][data-placeholder]',
      // Any visible contenteditable
      'div[contenteditable="true"]',
      // Textarea fallback
      'textarea[name*="message"], textarea[placeholder*="message" i], textarea[placeholder*="write" i]',
    ];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (isVisible(el)) return el;
      }
    }
    return null;
  }

  function findSendButton() {
    // Prefer aria-label containing "send" — most stable across LinkedIn updates
    const byAria = Array.from(document.querySelectorAll('button[aria-label]')).find(btn => {
      const label = btn.getAttribute('aria-label')?.toLowerCase() || '';
      return label.includes('send') && isVisible(btn) && !btn.disabled;
    });
    if (byAria) return byAria;

    const byTitle = Array.from(document.querySelectorAll('button[title]')).find(btn => {
      const title = btn.getAttribute('title')?.toLowerCase() || '';
      return title.includes('send') && isVisible(btn) && !btn.disabled;
    });
    if (byTitle) return byTitle;

    // Find button near the compose area that looks like send
    const input = findMessageInput();
    if (input) {
      let parent = input.parentElement;
      for (let depth = 0; depth < 6 && parent; depth++) {
        const btns = Array.from(parent.querySelectorAll('button'));
        // Take last visible button in the compose area (usually send is the rightmost/last)
        const visible = btns.filter(b => isVisible(b) && !b.disabled);
        if (visible.length > 0) {
          // Check button text content
          const sendBtn = visible.find(b =>
            (b.textContent?.toLowerCase().includes('send')) ||
            (b.getAttribute('data-control-name') || '').toLowerCase().includes('send')
          );
          if (sendBtn) return sendBtn;
        }
        parent = parent.parentElement;
      }
    }

    // Last resort: type="submit"
    return Array.from(document.querySelectorAll('button[type="submit"]'))
      .find(b => isVisible(b) && !b.disabled) || null;
  }

  // ─── Type text into contenteditable (React-compatible) ────────────────────

  function typeIntoInput(el, text) {
    el.focus();

    // Clear existing content
    document.execCommand('selectAll', false);

    // insertText is the React-friendly way — triggers synthetic onChange
    const inserted = document.execCommand('insertText', false, text);

    if (!inserted) {
      // Fallback for browsers where execCommand is deprecated
      // Use InputEvent with inputType which React's SyntheticEvent system listens to
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        sel.getRangeAt(0).deleteContents();
      }
      el.textContent = '';
      el.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text,
      }));
      el.textContent = text;
      // Move cursor to end
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      if (selection) { selection.removeAllRanges(); selection.addRange(range); }
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: 'insertText', data: text,
      }));
    }
  }

  async function typeAndSend(text) {
    const input = findMessageInput();
    if (!input) {
      return { ok: false, error: 'Message input not found. Make sure a conversation is open in LinkedIn.' };
    }

    typeIntoInput(input, text);

    // Wait for LinkedIn's React state to update
    await new Promise(r => setTimeout(r, 400));

    const sendBtn = findSendButton();
    if (!sendBtn) {
      return { ok: false, error: 'Text typed but send button not found — click Send manually.' };
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
      const conversations = scrapeConversations();
      sendResponse({ conversations });
      return true;
    }
    if (message.type === 'GET_CURRENT_CONVERSATION_ID') {
      sendResponse({ id: getCurrentConversationId() });
      return true;
    }
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return true;
    }
  });

  // ─── Init ─────────────────────────────────────────────────────────────────

  function init() {
    patchHistoryPushState();
    startObserving();

    // First scrape: staggered attempts to handle lazy-loaded content
    scheduleScrape(1000);
    scheduleScrape(3000);

    window.addEventListener('lml:navigate', () => {
      syncAttempts = 0;
      scheduleScrape(800);
      setTimeout(injectLabelButtons, 2000);
    });

    setTimeout(injectLabelButtons, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
