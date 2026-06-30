import { getConversations, setConversations, getOutreachAuth, setOutreachAuth } from '../utils/storage.js';

const LINKEDIN_URL = 'https://www.linkedin.com/messaging/';
const SALES_NAV_URL = 'https://www.linkedin.com/sales/inbox/';

// Outreach OAuth config — user fills in their app credentials in Outreach settings
// These are stored per-user in chrome.storage so they can enter their own app credentials
const OUTREACH_AUTH_URL = 'https://api.outreach.io/oauth/authorize';
const OUTREACH_TOKEN_URL = 'https://api.outreach.io/oauth/token';

// Open side panel when toolbar icon is clicked (works because no default_popup)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Enable side panel globally — works on any tab so clicking the icon always works
chrome.sidePanel.setOptions({ path: 'sidepanel/sidepanel.html', enabled: true }).catch(() => {});

// Set badge color once on startup
chrome.action.setBadgeBackgroundColor({ color: '#e53e3e' }).catch(() => {});

// Update unread badge whenever storage changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.conversations || changes.badgeEnabled) {
    updateUnreadBadge();
  }
});

async function updateUnreadBadge() {
  const { conversations = [], badgeEnabled = true } = await chrome.storage.local.get(['conversations', 'badgeEnabled']);
  if (!badgeEnabled) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const unread = conversations.filter(c => c.isUnread).length;
  chrome.action.setBadgeText({ text: unread > 0 ? String(unread > 99 ? '99+' : unread) : '' });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // keep channel open for async responses
});

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case 'OPEN_LINKEDIN':
        await openOrFocusTab(LINKEDIN_URL);
        sendResponse({ ok: true });
        break;

      case 'OPEN_SALES_NAV':
        await openOrFocusTab(SALES_NAV_URL);
        sendResponse({ ok: true });
        break;

      case 'OPEN_SIDE_PANEL': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel/sidepanel.html', enabled: true });
          await chrome.sidePanel.open({ tabId: tab.id });
        }
        sendResponse({ ok: true });
        break;
      }

      case 'SYNC_CONVERSATIONS': {
        await mergeConversations(message.conversations);
        chrome.runtime.sendMessage({ type: 'CONVERSATIONS_UPDATED' }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      // Sidepanel asks background to fetch all LinkedIn messages via the
      // content script (which has access to the user's LinkedIn session cookies)
      case 'FETCH_LINKEDIN_MESSAGES': {
        const result = await fetchLinkedInMessages(message.source || 'linkedin');
        sendResponse(result);
        break;
      }

      case 'FETCH_LINKEDIN_PROFILE': {
        const profile = await fetchLinkedInProfile();
        sendResponse({ ok: true, profile });
        break;
      }

      // Plan C — LinkedIn OAuth using user's registered Developer App
      case 'LINKEDIN_OAUTH_CONNECT': {
        const result = await startLinkedInOAuth(message.clientId);
        sendResponse(result);
        break;
      }

      case 'LINKEDIN_OAUTH_EXCHANGE': {
        const result = await exchangeLinkedInCode(message.clientId, message.clientSecret, message.code, message.redirectUri);
        sendResponse(result);
        break;
      }

      case 'LINKEDIN_OAUTH_DISCONNECT': {
        await chrome.storage.local.remove(['linkedInOAuth', 'linkedInProfile']);
        sendResponse({ ok: true });
        break;
      }

      case 'FETCH_CONVERSATION_MESSAGES': {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find(t => t.url?.includes('linkedin.com'));
        if (!tab) { sendResponse({ ok: false, error: 'No LinkedIn tab open', messages: [] }); break; }
        try {
          const result = await chrome.tabs.sendMessage(tab.id, { type: 'FETCH_CONVERSATION_MESSAGES', convId: message.convId });
          sendResponse(result || { ok: false, error: 'No response', messages: [] });
        } catch (err) {
          sendResponse({ ok: false, error: err.message, messages: [] });
        }
        break;
      }

      case 'SEND_MESSAGE': {
        const result = await sendLinkedInMessage(message.conversationUrl, message.text);
        sendResponse(result);
        break;
      }

      case 'OUTREACH_CONNECT': {
        const result = await startOutreachOAuth(message.clientId, message.clientSecret);
        sendResponse(result);
        break;
      }

      case 'OUTREACH_DISCONNECT': {
        await setOutreachAuth(null);
        sendResponse({ ok: true });
        break;
      }

      case 'OUTREACH_REFRESH_TOKEN': {
        const result = await refreshOutreachToken(message.clientId, message.clientSecret);
        sendResponse(result);
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ─── LinkedIn message fetching via content script ─────────────────────────

async function getOrOpenLinkedInTab(url) {
  const tabs = await chrome.tabs.query({});
  // Prefer a tab that's already on the right page
  let tab = tabs.find(t => t.url?.includes(url.split('linkedin.com')[1]));
  // Otherwise any LinkedIn tab
  if (!tab) tab = tabs.find(t => t.url?.includes('linkedin.com'));
  if (tab) return tab;
  // Open a new one and wait for it
  const newTab = await chrome.tabs.create({ url });
  await waitForTabLoad(newTab.id);
  return newTab;
}

async function pingTab(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return r?.ok === true;
  } catch { return false; }
}

async function fetchLinkedInMessages(source) {
  const targetUrl = source === 'sales_nav'
    ? 'https://www.linkedin.com/sales/inbox/'
    : 'https://www.linkedin.com/messaging/';

  let tab;
  try {
    tab = await getOrOpenLinkedInTab(targetUrl);
  } catch (err) {
    return { ok: false, error: 'Could not open LinkedIn: ' + err.message };
  }

  // Make sure content script is running
  const alive = await pingTab(tab.id);
  if (!alive) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/interceptor.js'], world: 'MAIN' });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content/content.css'] });
      await new Promise(r => setTimeout(r, 1000));
    } catch { /* scripting may fail on restricted URLs */ }
  }

  const msgType = source === 'sales_nav' ? 'FETCH_SALESNAV_CONVERSATIONS' : 'FETCH_VOYAGER_CONVERSATIONS';

  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: msgType, count: 50, start: 0 });
    if (!result?.ok) return result || { ok: false, error: 'No response from content script' };

    // Merge into storage
    if (result.conversations?.length > 0) {
      await mergeConversations(result.conversations);
      chrome.runtime.sendMessage({ type: 'CONVERSATIONS_UPDATED' }).catch(() => {});
    }
    return { ok: true, count: result.conversations?.length || 0, total: result.total };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function fetchLinkedInProfile() {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find(t => t.url?.includes('linkedin.com'));
  if (!tab) return null;
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'FETCH_VOYAGER_PROFILE' });
    return result || null;
  } catch { return null; }
}

// ─── Plan C: LinkedIn OAuth ────────────────────────────────────────────────
// Uses LinkedIn's official OAuth 2.0 with openid + profile scopes.
// Messaging requires LinkedIn Partner API access — this sets up the auth
// infrastructure and fetches profile/basic data available to any app.

const LI_AUTH_URL  = 'https://www.linkedin.com/oauth/v2/authorization';
const LI_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LI_API_BASE  = 'https://api.linkedin.com/v2';

async function startLinkedInOAuth(clientId) {
  if (!clientId) return { ok: false, error: 'Client ID is required' };

  const extensionId = chrome.runtime.id;
  const redirectUri = `https://${extensionId}.chromiumapp.org/linkedin`;
  const state = crypto.randomUUID();

  const authUrl = new URL(LI_AUTH_URL);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  // openid + profile = name/photo; email = email address.
  // r_messaging_member = messaging (requires LinkedIn Partner approval)
  authUrl.searchParams.set('scope', 'openid profile email');

  let callbackUrl;
  try {
    callbackUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });
  } catch (err) {
    return { ok: false, error: 'OAuth cancelled: ' + err.message };
  }

  const params = new URL(callbackUrl).searchParams;
  if (params.get('error')) return { ok: false, error: params.get('error_description') || params.get('error') };
  const code = params.get('code');
  if (!code) return { ok: false, error: 'No authorization code received' };

  // Exchange code for tokens — requires a backend proxy because the client_secret
  // must not be in the extension. For demo/testing we support a simple proxy URL
  // or a direct exchange if the user provides their client_secret.
  return {
    ok: false,
    requiresSecret: true,
    code,
    redirectUri,
    message: 'Code received. Enter your app client_secret to complete the exchange, or set up a backend proxy.',
  };
}

// Exchange auth code → access token (called after user provides client_secret)
async function exchangeLinkedInCode(clientId, clientSecret, code, redirectUri) {
  const tokenRes = await fetch(LI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }),
  });

  if (!tokenRes.ok) return { ok: false, error: `Token exchange failed: ${tokenRes.status}` };
  const tokens = await tokenRes.json();

  const oauth = {
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
    scope: tokens.scope || 'openid profile email',
    clientId,
  };

  // Fetch profile via OpenID Connect userinfo endpoint
  const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${oauth.accessToken}` },
  });

  let profile = { name: 'LinkedIn User', avatarUrl: '', email: '' };
  if (profileRes.ok) {
    const p = await profileRes.json();
    profile = {
      name: `${p.given_name || ''} ${p.family_name || ''}`.trim() || p.name || 'LinkedIn User',
      avatarUrl: p.picture || '',
      email: p.email || '',
      sub: p.sub,
      source: 'oauth',
    };
  }

  await chrome.storage.local.set({ linkedInOAuth: oauth, linkedInProfile: profile });
  return { ok: true, oauth, profile };
}

async function openOrFocusTab(url) {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find(t => t.url && t.url.startsWith(url));
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function mergeConversations(incoming) {
  const existing = await getConversations();
  const map = Object.fromEntries(existing.map(c => [c.id, c]));
  for (const c of incoming) {
    if (map[c.id]) {
      // Preserve labels, update messaging fields
      map[c.id] = { ...map[c.id], ...c, labels: map[c.id].labels || [] };
    } else {
      map[c.id] = { ...c, labels: [] };
    }
  }
  await setConversations(Object.values(map));
}

async function sendLinkedInMessage(conversationUrl, text) {
  // Find an existing LinkedIn tab or open a new one
  const tabs = await chrome.tabs.query({});
  let linkedInTab = tabs.find(t => t.url && t.url.startsWith('https://www.linkedin.com'));

  if (!linkedInTab) {
    linkedInTab = await chrome.tabs.create({ url: conversationUrl });
    // Wait for page to load
    await waitForTabLoad(linkedInTab.id);
  } else if (conversationUrl) {
    await chrome.tabs.update(linkedInTab.id, { url: conversationUrl });
    await waitForTabLoad(linkedInTab.id);
  }

  // Send message via content script
  try {
    const result = await chrome.tabs.sendMessage(linkedInTab.id, {
      type: 'TYPE_AND_SEND',
      text,
    });
    return result;
  } catch {
    // Content script might not be ready, inject it
    await chrome.scripting.executeScript({
      target: { tabId: linkedInTab.id },
      files: ['content/content.js'],
    });
    await new Promise(r => setTimeout(r, 800));
    const result = await chrome.tabs.sendMessage(linkedInTab.id, {
      type: 'TYPE_AND_SEND',
      text,
    });
    return result;
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 500); // extra wait for React hydration
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(resolve, 8000); // fallback timeout
  });
}

async function startOutreachOAuth(clientId, clientSecret) {
  const extensionId = chrome.runtime.id;
  const redirectUri = `https://${extensionId}.chromiumapp.org/outreach`;
  const state = Math.random().toString(36).slice(2);

  const authUrl = new URL(OUTREACH_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'accounts.all prospects.all sequenceStates.all sequences.all sequenceSteps.all tasks.all');
  authUrl.searchParams.set('state', state);

  let callbackUrl;
  try {
    callbackUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true,
    });
  } catch (err) {
    return { ok: false, error: 'OAuth cancelled or failed: ' + err.message };
  }

  const params = new URL(callbackUrl).searchParams;
  const code = params.get('code');
  if (!code) return { ok: false, error: 'No auth code received' };

  // Exchange code for tokens
  const tokenRes = await fetch(OUTREACH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return { ok: false, error: 'Token exchange failed: ' + err };
  }

  const tokens = await tokenRes.json();
  const auth = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    clientId,
    clientSecret,
  };
  await setOutreachAuth(auth);
  return { ok: true, auth };
}

async function refreshOutreachToken(clientId, clientSecret) {
  const auth = await getOutreachAuth();
  if (!auth?.refreshToken) return { ok: false, error: 'No refresh token' };

  const extensionId = chrome.runtime.id;
  const redirectUri = `https://${extensionId}.chromiumapp.org/outreach`;

  const tokenRes = await fetch(OUTREACH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId || auth.clientId,
      client_secret: clientSecret || auth.clientSecret,
      refresh_token: auth.refreshToken,
      redirect_uri: redirectUri,
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenRes.ok) return { ok: false, error: 'Refresh failed' };

  const tokens = await tokenRes.json();
  const updated = {
    ...auth,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || auth.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  await setOutreachAuth(updated);
  return { ok: true, auth: updated };
}
