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
    history.pushState = (...args) => { orig(...args); window.dispatchEvent(new Event('lml:navigate')); };
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('lml:navigate')));
  }

  // ─── Listen for interceptor.js API data (MAIN world → isolated) ───────────

  window.addEventListener('lml:conversations', (e) => {
    const conversations = e.detail;
    if (Array.isArray(conversations) && conversations.length > 0) {
      chrome.runtime.sendMessage({ type: 'SYNC_CONVERSATIONS', conversations }).catch(() => {});
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VOYAGER API — Direct authenticated calls using the browser's LinkedIn session
  // ═══════════════════════════════════════════════════════════════════════════

  /** Extract LinkedIn's CSRF token from the JSESSIONID cookie. */
  function getCsrfToken() {
    const match = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
    if (match) return decodeURIComponent(match[1].replace(/"/g, ''));
    // Fallback: look for csrf-token meta tag
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) return meta.getAttribute('content');
    return null;
  }

  function buildVoyagerHeaders(csrfToken) {
    return {
      'csrf-token': csrfToken,
      'x-restli-protocol-version': '2.0.0',
      'accept': 'application/vnd.linkedin.normalized+json+2.1',
      'x-li-lang': navigator.language?.replace('-', '_') || 'en_US',
      'x-li-track': JSON.stringify({
        clientVersion: '1.13.9', mpVersion: '1.13.9',
        osName: 'web', timezoneOffset: new Date().getTimezoneOffset() / -60,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        deviceFormFactor: 'DESKTOP', mpName: 'voyager-web',
      }),
      'x-li-page-instance': 'urn:li:page:d_flagship3_messaging;',
    };
  }

  async function voyagerFetch(path, csrfToken) {
    const res = await fetch(path, {
      method: 'GET',
      credentials: 'include',
      headers: buildVoyagerHeaders(csrfToken),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  // ─── Parse Voyager conversations response ─────────────────────────────────

  function parseVoyagerConversations(data) {
    // Handle both normalized and non-normalized response formats
    const elements = data.elements || data.value?.elements || [];
    // Normalized format has a lookup map in "included"
    const included = data.included || [];
    const entityMap = {};
    for (const item of included) {
      if (item.entityUrn) entityMap[item.entityUrn] = item;
    }

    const conversations = [];
    for (const el of elements) {
      try {
        // ── Thread ID ──────────────────────────────────────────────────────
        const urn = el.entityUrn || '';
        const idMatch = urn.match(/(?:fs_conversation|msg_conversation):([^,)]+)/);
        if (!idMatch) continue;
        const id = idMatch[1];

        // ── Participant name + avatar ──────────────────────────────────────
        let name = 'Unknown';
        let avatarUrl = '';

        const participantUrns = el['*participants'] || [];
        const participantElements = el.participants?.elements || [];

        // Try *participants (normalized) first
        for (const pUrn of participantUrns) {
          const member = entityMap[pUrn];
          if (!member) continue;
          const mini = member.miniProfile || entityMap[member['*miniProfile']];
          if (mini) {
            name = `${mini.firstName || ''} ${mini.lastName || ''}`.trim() || name;
            avatarUrl = resolveAvatar(mini.picture, entityMap);
            if (name !== 'Unknown') break;
          }
        }

        // Then try inline participants array
        if (name === 'Unknown') {
          for (const p of participantElements) {
            const member =
              p['com.linkedin.messaging.MessagingMember'] ||
              p['com.linkedin.voyager.messaging.MessagingMember'] || p;
            const mini = member?.miniProfile || entityMap[member?.['*miniProfile']];
            if (mini) {
              name = `${mini.firstName || ''} ${mini.lastName || ''}`.trim() || name;
              avatarUrl = avatarUrl || resolveAvatar(mini.picture, entityMap);
              if (name !== 'Unknown') break;
            }
          }
        }

        // ── Last message snippet ───────────────────────────────────────────
        let snippet = '';
        const eventUrns = el['*events'] || [];
        const eventElements = el.events?.elements || [];

        for (const eUrn of eventUrns) {
          const event = entityMap[eUrn];
          const text = extractMessageText(event, entityMap);
          if (text) { snippet = text; break; }
        }
        if (!snippet) {
          for (const event of eventElements) {
            const text = extractMessageText(event, entityMap);
            if (text) { snippet = text; break; }
          }
        }

        // ── Timestamp + unread ────────────────────────────────────────────
        const ts = el.lastActivityAt || el.lastActivityAtMilliseconds || 0;
        const timestamp = ts ? new Date(ts).toISOString() : '';
        const isUnread = !!(el.unread || el.unreadCount > 0 || el['*unread']);

        conversations.push({
          id, name,
          snippet: snippet.slice(0, 150),
          timestamp, avatarUrl, isUnread,
          url: `https://www.linkedin.com/messaging/thread/${encodeURIComponent(id)}/`,
          source: 'linkedin',
          scrapedAt: Date.now(),
        });
      } catch { /* skip malformed */ }
    }
    return conversations;
  }

  function extractMessageText(event, entityMap) {
    if (!event) return '';
    const content =
      event.eventContent?.['com.linkedin.messaging.event.content.MessageEvent'] ||
      event.eventContent?.['com.linkedin.voyager.messaging.event.content.MessageEvent'] ||
      event.eventContent;
    return content?.attributedBody?.text || content?.body?.text || '';
  }

  function resolveAvatar(pictureField, entityMap) {
    if (!pictureField) return '';
    const vec =
      pictureField['com.linkedin.common.VectorImage'] ||
      (typeof pictureField === 'string' ? entityMap[pictureField] : null) ||
      pictureField;
    if (vec?.rootUrl && Array.isArray(vec.artifacts) && vec.artifacts.length) {
      const art = vec.artifacts[vec.artifacts.length - 1];
      return vec.rootUrl + (art.fileIdentifyingUrlPathSegment || '');
    }
    return '';
  }

  // ─── Fetch conversations from Voyager API ─────────────────────────────────

  async function fetchVoyagerConversations(count = 50, start = 0) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) return { ok: false, error: 'NOT_LOGGED_IN', conversations: [] };

    try {
      // q=fokusListByFolder returns the default "Focused" inbox
      // Try both the newer and older endpoint paths
      let data = null;
      const paths = [
        `/voyager/api/messaging/conversations?count=${count}&q=fokusListByFolder&start=${start}`,
        `/voyager/api/messaging/conversations?count=${count}&start=${start}`,
      ];

      for (const path of paths) {
        try {
          data = await voyagerFetch(path, csrfToken);
          if (data?.elements || data?.value?.elements) break;
        } catch { /* try next */ }
      }

      if (!data) return { ok: false, error: 'API_UNAVAILABLE', conversations: [] };

      const conversations = parseVoyagerConversations(data);
      const total = data.paging?.total || conversations.length;
      return { ok: true, conversations, total };
    } catch (err) {
      const isAuth = err.message?.includes('401') || err.message?.includes('403');
      return { ok: false, error: isAuth ? 'NOT_LOGGED_IN' : err.message, conversations: [] };
    }
  }

  // ─── Fetch Sales Navigator conversations ─────────────────────────────────

  async function fetchSalesNavConversations(count = 50, start = 0) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) return { ok: false, error: 'NOT_LOGGED_IN', conversations: [] };

    try {
      const data = await voyagerFetch(
        `/voyager/api/salesApiConversations?count=${count}&start=${start}&q=conversations`,
        csrfToken
      );
      // Sales Nav uses similar but slightly different schema
      const elements = data.elements || [];
      const conversations = elements.map(el => {
        try {
          const urn = el.entityUrn || '';
          const id = urn.split(':').pop() || el.id || '';
          const participants = el.participants?.elements || [];
          let name = 'Unknown', avatarUrl = '';
          for (const p of participants) {
            const mini = p.miniProfile || p;
            name = `${mini.firstName || ''} ${mini.lastName || ''}`.trim() || name;
            if (name !== 'Unknown') break;
          }
          return {
            id, name,
            snippet: el.lastMessage?.body?.text?.slice(0, 150) || '',
            timestamp: el.lastActivityAt ? new Date(el.lastActivityAt).toISOString() : '',
            avatarUrl,
            isUnread: !!el.unread,
            url: `https://www.linkedin.com/sales/inbox/${encodeURIComponent(id)}`,
            source: 'sales_nav',
            scrapedAt: Date.now(),
          };
        } catch { return null; }
      }).filter(Boolean);
      return { ok: true, conversations };
    } catch (err) {
      return { ok: false, error: err.message, conversations: [] };
    }
  }

  // ─── Fetch conversation messages ─────────────────────────────────────────

  async function fetchConversationMessages(convId) {
    const csrfToken = getCsrfToken();
    if (!csrfToken) return { ok: false, error: 'NOT_LOGGED_IN', messages: [] };
    try {
      // Try multiple URL patterns for the events endpoint
      const paths = [
        `/voyager/api/messaging/conversations/${encodeURIComponent(convId)}/events?count=20&q=conversation`,
        `/voyager/api/messaging/conversations/${encodeURIComponent('urn:li:msg_conversation:' + convId)}/events?count=20`,
      ];
      let data = null;
      for (const path of paths) {
        try {
          data = await voyagerFetch(path, csrfToken);
          if (data?.elements?.length > 0 || data?.paging) break;
        } catch { }
      }
      if (!data) return { ok: false, error: 'Could not fetch messages', messages: [] };
      const included = data.included || [];
      const entityMap = {};
      for (const item of included) { if (item.entityUrn) entityMap[item.entityUrn] = item; }
      const elements = data.elements || [];
      const messages = elements.map(el => {
        try {
          const content =
            el.eventContent?.['com.linkedin.messaging.event.content.MessageEvent'] ||
            el.eventContent?.['com.linkedin.voyager.messaging.event.content.MessageEvent'] ||
            el.eventContent;
          const text = content?.attributedBody?.text || content?.body?.text || '';
          if (!text) return null;
          const senderUrn = el['*from'] || el.from?.entityUrn || '';
          const sender = entityMap[senderUrn] || {};
          const mini = sender.miniProfile || entityMap[sender['*miniProfile']] || {};
          const senderName = `${mini.firstName || ''} ${mini.lastName || ''}`.trim() || 'Unknown';
          const senderAvatar = resolveAvatar(mini.picture, entityMap);
          return { id: el.entityUrn || '', text, sentAt: el.createdAt || 0, senderName, senderUrn, senderAvatar };
        } catch { return null; }
      }).filter(Boolean).reverse();
      return { ok: true, messages };
    } catch (err) {
      return { ok: false, error: err.message, messages: [] };
    }
  }

  // ─── Fetch current user profile ───────────────────────────────────────────

  async function fetchLinkedInProfile() {
    const csrfToken = getCsrfToken();
    if (!csrfToken) return null;

    try {
      const data = await voyagerFetch('/voyager/api/me', csrfToken);
      // Profile is in included or miniProfile
      const included = data.included || [];
      const mini = included.find(i => i.$type?.includes('MiniProfile') || i.firstName) || data;
      if (!mini?.firstName && !mini?.lastName) return { name: 'LinkedIn User', avatarUrl: '' };

      return {
        name: `${mini.firstName || ''} ${mini.lastName || ''}`.trim() || 'LinkedIn User',
        avatarUrl: resolveAvatar(mini.picture, {}),
        publicIdentifier: mini.publicIdentifier || '',
      };
    } catch {
      return { name: 'LinkedIn User', avatarUrl: '' };
    }
  }

  // ─── DOM helpers ──────────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // ─── Message input + send button detection ────────────────────────────────

  function findMessageInput() {
    const selectors = [
      '.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-placeholder]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="message" i]',
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el)) return el;
      }
    }
    return null;
  }

  function findSendButton() {
    const byAria = Array.from(document.querySelectorAll('button[aria-label]')).find(b =>
      b.getAttribute('aria-label')?.toLowerCase().includes('send') && isVisible(b) && !b.disabled
    );
    if (byAria) return byAria;

    const byTitle = Array.from(document.querySelectorAll('button[title]')).find(b =>
      b.getAttribute('title')?.toLowerCase().includes('send') && isVisible(b) && !b.disabled
    );
    if (byTitle) return byTitle;

    const input = findMessageInput();
    if (input) {
      let parent = input.parentElement;
      for (let i = 0; i < 7 && parent; i++) {
        for (const btn of parent.querySelectorAll('button')) {
          if (!isVisible(btn) || btn.disabled) continue;
          const lbl = (btn.getAttribute('aria-label') || btn.textContent || '').toLowerCase();
          if (lbl.includes('send')) return btn;
        }
        parent = parent.parentElement;
      }
    }
    return null;
  }

  function typeIntoInput(el, text) {
    el.focus();
    document.execCommand('selectAll', false);
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      el.textContent = text;
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
    if (!input) return { ok: false, error: 'Message input not found — make sure a conversation is open.' };
    typeIntoInput(input, text);
    await new Promise(r => setTimeout(r, 450));
    const btn = findSendButton();
    if (!btn) return { ok: false, error: 'Text typed — click Send manually.' };
    btn.click();
    return { ok: true };
  }

  // ─── Label button injection ───────────────────────────────────────────────

  const INJECTED_ATTR = 'data-lml-injected';

  async function injectLabelButton() {
    const ctx = getPageContext();
    if (ctx !== 'messaging' && ctx !== 'sales_nav') return;
    if (document.querySelector('.lml-btn-container')) return;

    const anchor =
      document.querySelector('h1') ||
      document.querySelector('[role="banner"]') ||
      (() => {
        const inp = findMessageInput();
        if (!inp) return null;
        let el = inp.parentElement;
        for (let i = 0; i < 8 && el; i++) {
          if (el.getBoundingClientRect().height > 300) return el;
          el = el.parentElement;
        }
        return null;
      })();

    if (!anchor || anchor.hasAttribute(INJECTED_ATTR)) return;
    anchor.setAttribute(INJECTED_ATTR, '1');

    const container = document.createElement('div');
    container.className = 'lml-btn-container';
    const btn = document.createElement('button');
    btn.className = 'lml-label-btn';
    btn.innerHTML = '<span>🏷</span> Labels';
    btn.title = 'Assign labels to this conversation';
    btn.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); showLabelDropdown(btn); });
    container.appendChild(btn);
    // Insert AFTER the anchor, not inside it — avoids LinkedIn's click handlers on h1/banner
    anchor.insertAdjacentElement('afterend', container);
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
      dropdown.innerHTML = `<div class="lml-dropdown-empty">No labels yet.<br>Create them in the extension panel.</div>`;
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
        cb.type = 'checkbox'; cb.dataset.labelId = label.id; cb.checked = convLabels.includes(label.id);
        const dot = document.createElement('span');
        dot.className = 'lml-color-dot'; dot.style.background = label.color;
        const name = document.createElement('span');
        name.className = 'lml-label-name'; name.textContent = label.name;
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
    dropdown.style.top = `${rect.bottom + 6 + scrollY}px`;
    dropdown.style.left = `${Math.max(4, rect.left + scrollX)}px`;
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

  // ─── Message handlers ────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'FETCH_VOYAGER_CONVERSATIONS':
        fetchVoyagerConversations(msg.count || 50, msg.start || 0).then(sendResponse);
        return true;

      case 'FETCH_VOYAGER_PROFILE':
        fetchLinkedInProfile().then(sendResponse);
        return true;

      case 'FETCH_SALESNAV_CONVERSATIONS':
        fetchSalesNavConversations(msg.count || 50, msg.start || 0).then(sendResponse);
        return true;

      case 'TYPE_AND_SEND':
        typeAndSend(msg.text).then(sendResponse);
        return true;

      case 'SCRAPE_NOW':
        // Prefer Voyager API over DOM scraping
        fetchVoyagerConversations(50, 0).then(result => {
          sendResponse({ conversations: result.conversations || [] });
        });
        return true;

      case 'GET_CURRENT_CONVERSATION_ID':
        sendResponse({ id: getCurrentConversationId() });
        return true;

      case 'FETCH_CONVERSATION_MESSAGES': {
        fetchConversationMessages(msg.convId).then(sendResponse);
        return true;
      }

      case 'PING':
        sendResponse({ ok: true });
        return true;
    }
  });

  // ─── SPA navigation ───────────────────────────────────────────────────────

  patchHistoryPushState();
  window.addEventListener('lml:navigate', () => setTimeout(injectLabelButton, 2000));
  setTimeout(injectLabelButton, 2500);
})();
