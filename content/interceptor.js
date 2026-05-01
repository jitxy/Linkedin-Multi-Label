/**
 * Runs in the PAGE's JavaScript context (world: MAIN) at document_start.
 * Patches window.fetch and XHR to intercept LinkedIn's Voyager / GraphQL API
 * responses and extract conversation data without any DOM scraping.
 *
 * Sends data to the isolated content script via a CustomEvent on window.
 */
(function () {
  'use strict';

  // ── Voyager API URL patterns to watch ──────────────────────────────────────
  const MESSAGING_PATTERNS = [
    '/voyager/api/messaging/conversations',
    '/voyager/api/voyagerMessagingDashMessagingThreads',
    '/voyager/api/voyagerMessagingGraphQL/graphql',
    '/voyager/api/graphql',
    'messagingThread',
    'messengerConversation',
    'messagingConversation',
  ];

  function isMessagingUrl(url) {
    if (!url) return false;
    return MESSAGING_PATTERNS.some(p => url.includes(p));
  }

  // ── Parse LinkedIn's various API response formats ──────────────────────────

  function parseResponse(data, url) {
    try {
      // GraphQL format (newer)
      if (data?.data) {
        return parseGraphQL(data.data);
      }
      // REST Voyager format
      if (data?.elements) {
        return parseVoyagerElements(data.elements);
      }
      // Paging wrapper
      if (data?.value?.elements) {
        return parseVoyagerElements(data.value.elements);
      }
    } catch {}
    return [];
  }

  function parseGraphQL(data) {
    const conversations = [];
    // Try known GraphQL response shapes
    const sources = [
      data?.messengerConversationsBySyncToken?.elements,
      data?.messengerConversations?.elements,
      data?.messagingConversations?.elements,
      data?.threads?.elements,
    ].filter(Array.isArray);

    for (const elements of sources) {
      for (const el of elements) {
        const conv = extractConversation(el);
        if (conv) conversations.push(conv);
      }
    }
    return conversations;
  }

  function parseVoyagerElements(elements) {
    const conversations = [];
    for (const el of elements) {
      const conv = extractConversation(el);
      if (conv) conversations.push(conv);
    }
    return conversations;
  }

  function extractConversation(el) {
    try {
      // ── Thread ID ─────────────────────────────────────────────────────────
      let id = null;

      // From entityUrn: "urn:li:fs_conversation:2-xxxx" or "urn:li:msg_conversation:(xxxx)"
      const urn = el.entityUrn || el.backendConversationUrn || el['*conversation'] || '';
      const urnMatch = urn.match(/(?:conversation:|msg_conversation:\()([^,)]+)/);
      if (urnMatch) id = urnMatch[1];

      // From id field directly
      if (!id && el.id) id = String(el.id);

      // From dashConversationId
      if (!id && el.dashConversationId) {
        const m = el.dashConversationId.match(/\(([^)]+)\)/);
        id = m ? m[1] : el.dashConversationId;
      }

      if (!id) return null;

      // ── Participant name ──────────────────────────────────────────────────
      let name = 'Unknown';
      let avatarUrl = '';

      const participantSources = [
        el.participants?.elements,
        el['*participants'],
        el.conversationParticipants,
        el.members?.elements,
      ].filter(Array.isArray);

      for (const participants of participantSources) {
        for (const p of participants) {
          const member =
            p['com.linkedin.messaging.MessagingMember'] ||
            p['com.linkedin.voyager.messaging.MessagingMember'] ||
            p;

          const profile =
            member?.miniProfile ||
            member?.profile ||
            member?.participant?.['com.linkedin.voyager.messaging.MessagingMember']?.miniProfile;

          if (profile) {
            const first = profile.firstName || profile.localizedFirstName || '';
            const last = profile.lastName || profile.localizedLastName || '';
            const fullName = `${first} ${last}`.trim();
            if (fullName && fullName !== 'Unknown') {
              name = fullName;
              // Avatar
              const pic = profile.picture || profile.profilePicture;
              const artifacts = pic?.['com.linkedin.common.VectorImage']?.artifacts ||
                                pic?.rootUrl ? [{ fileIdentifyingUrlPathSegment: '' }] : [];
              if (pic?.rootUrl && artifacts.length > 0) {
                avatarUrl = pic.rootUrl + (artifacts[0].fileIdentifyingUrlPathSegment || '');
              }
              break;
            }
          }
          // GraphQL format
          if (p.firstName || p.profileUrl) {
            const first = p.firstName || '';
            const last = p.lastName || '';
            name = `${first} ${last}`.trim() || name;
            avatarUrl = p.profilePicture?.rootUrl || avatarUrl;
            if (name !== 'Unknown') break;
          }
        }
        if (name !== 'Unknown') break;
      }

      // ── Last message snippet ──────────────────────────────────────────────
      let snippet = '';
      let timestamp = '';
      let isUnread = false;

      const eventSources = [
        el.events?.elements,
        el.messages?.elements,
        el.lastMessages,
      ].filter(Array.isArray);

      for (const events of eventSources) {
        const last = events[0];
        if (!last) continue;

        const msgEvent =
          last?.eventContent?.['com.linkedin.messaging.event.content.MessageEvent'] ||
          last?.eventContent?.['com.linkedin.voyager.messaging.event.content.MessageEvent'] ||
          last?.body;

        snippet = msgEvent?.attributedBody?.text || msgEvent?.text || last?.body?.text || '';
        if (snippet) { snippet = snippet.slice(0, 120); break; }
      }

      // Fallback snippet from lastActivity
      if (!snippet && el.lastActivity) {
        snippet = el.lastActivity?.text || '';
      }

      // Timestamp
      timestamp = el.lastActivityAt || el.lastActivityAtMilliseconds ||
                  el.events?.elements?.[0]?.createdAt || '';
      if (typeof timestamp === 'number') {
        timestamp = new Date(timestamp).toISOString();
      }

      // Unread
      isUnread = !!(el.unread || el.unreadCount > 0 || el['*unread']);

      return {
        id,
        name,
        snippet,
        timestamp,
        avatarUrl,
        isUnread,
        url: `https://www.linkedin.com/messaging/thread/${encodeURIComponent(id)}/`,
        source: 'linkedin',
        scrapedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  // ── Dispatch to isolated world content script ──────────────────────────────

  function dispatch(conversations) {
    if (!conversations.length) return;
    window.dispatchEvent(new CustomEvent('lml:conversations', {
      detail: conversations,
    }));
  }

  // ── Patch fetch ────────────────────────────────────────────────────────────

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const req = args[0];
      const url = typeof req === 'string' ? req : (req instanceof Request ? req.url : String(req));

      if (isMessagingUrl(url)) {
        response.clone().json().then(data => {
          const convos = parseResponse(data, url);
          dispatch(convos);
        }).catch(() => {});
      }
    } catch {}

    return response;
  };

  // ── Patch XMLHttpRequest ────────────────────────────────────────────────────

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._lmlUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (isMessagingUrl(this._lmlUrl)) {
      this.addEventListener('load', () => {
        try {
          const data = JSON.parse(this.responseText);
          const convos = parseResponse(data, this._lmlUrl);
          dispatch(convos);
        } catch {}
      });
    }
    return origSend.apply(this, args);
  };
})();
