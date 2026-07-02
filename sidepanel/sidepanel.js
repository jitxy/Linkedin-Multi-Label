import {
  getConversations, setConversations,
  getLabels, createLabel, updateLabel, deleteLabel,
  assignLabel, removeLabel,
  getOutreachAuth, setOutreachAuth,
  getOutreachConfig, setOutreachConfig,
} from '../utils/storage.js';
import {
  getSequences, getSequenceSteps, getPendingLinkedInTasks, completeTask,
} from '../utils/outreach.js';

// ─── State ─────────────────────────────────────────────────────────────────

let conversations = [];
let labels = [];
let activeTab = 'conversations';
let selectedLabelFilter = 'all';
let searchQuery = '';
let activeConversation = null;
let editingLabelId = null;
let selectedColor = '#0A66C2';
let outreachAuth = null;
let outreachSequences = [];
let pendingSteps = [];
let openSequenceIds = new Set();
let linkedInProfile = null;
let isSyncing = false;

const LABEL_COLORS = [
  '#0A66C2', '#6366f1', '#8b5cf6', '#ec4899',
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#3b82f6', '#64748b', '#78716c', '#374151',
];

// ─── Init ───────────────────────────────────────────────────────────────────

async function init() {
  const stored = await chrome.storage.local.get([
    'conversations', 'labels', 'outreachAuth', 'linkedInProfile',
    'lastSyncedAt', 'linkedInOAuth', 'passiveSyncEnabled', 'badgeEnabled',
  ]);
  conversations = stored.conversations || [];
  labels = stored.labels || [];
  outreachAuth = stored.outreachAuth || null;
  linkedInProfile = stored.linkedInProfile || null;

  renderAll();
  renderLinkedInAccountBar(stored.lastSyncedAt);
  setupEventListeners();
  initSettingsTab(stored);

  // Connect to background so it knows the panel is open (triggers auto-sync)
  const port = chrome.runtime.connect({ name: 'sidepanel' });
  port.onDisconnect.addListener(() => {});

  // Listen for conversation updates pushed from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'CONVERSATIONS_UPDATED') {
      reloadConversations();
    }
  });

  // Storage change listener for real-time label/conversation updates
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.conversations) {
      conversations = changes.conversations.newValue || [];
      renderConversationList();
      renderFilterChips();
    }
    if (changes.labels) {
      labels = changes.labels.newValue || [];
      renderConversationList();
      renderFilterChips();
      renderLabelsList();
      if (detailConv) {
        const updated = (changes.conversations?.newValue || conversations).find(c => c.id === detailConv.id);
        if (updated) { detailConv = updated; renderDetailLabelChips(updated); renderLabelModalList(updated); }
      }
    }
    if (changes.outreachAuth) {
      outreachAuth = changes.outreachAuth.newValue;
      renderOutreachTab();
    }
    if (changes.linkedInOAuth || changes.linkedInProfile) {
      const oAuth = changes.linkedInOAuth?.newValue;
      const profile = changes.linkedInProfile?.newValue;
      if (oAuth && profile) renderOAuthConnected(profile);
    }
  });
}

async function reloadConversations() {
  conversations = await getConversations();
  renderConversationList();
  renderFilterChips();
}

// ─── Render ─────────────────────────────────────────────────────────────────

function renderAll() {
  renderFilterChips();
  renderConversationList();
  renderLabelsList();
  renderOutreachTab();
  renderColorSwatches();
}

// ─── Tab switching ───────────────────────────────────────────────────────────

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('hidden', el.id !== `tab-${tab}`);
    el.classList.toggle('active', el.id === `tab-${tab}`);
  });
}

// ─── Filter chips ────────────────────────────────────────────────────────────

function renderFilterChips() {
  const container = document.getElementById('label-filters');
  container.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.className = `chip${selectedLabelFilter === 'all' ? ' active' : ''}`;
  allChip.dataset.labelId = 'all';
  allChip.textContent = 'All';
  allChip.addEventListener('click', () => setLabelFilter('all'));
  container.appendChild(allChip);

  for (const label of labels) {
    const chip = document.createElement('button');
    chip.className = `chip${selectedLabelFilter === label.id ? ' active' : ''}`;
    chip.dataset.labelId = label.id;

    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    dot.style.background = label.color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(label.name));
    chip.addEventListener('click', () => setLabelFilter(label.id));
    container.appendChild(chip);
  }
}

function setLabelFilter(labelId) {
  selectedLabelFilter = labelId;
  renderFilterChips();
  renderConversationList();
}

// ─── Conversations ───────────────────────────────────────────────────────────

function getFilteredConversations() {
  let list = [...conversations];

  if (selectedLabelFilter !== 'all') {
    list = list.filter(c => (c.labels || []).includes(selectedLabelFilter));
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(c =>
      c.name?.toLowerCase().includes(q) ||
      c.snippet?.toLowerCase().includes(q)
    );
  }

  list.sort((a, b) => (b.scrapedAt || 0) - (a.scrapedAt || 0));
  return list;
}

function renderConversationList() {
  const container = document.getElementById('conv-list');
  const emptyEl = document.getElementById('conv-empty');
  const filtered = getFilteredConversations();

  // Remove existing cards (preserve empty state)
  container.querySelectorAll('.conv-card').forEach(el => el.remove());

  if (filtered.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');

  for (const conv of filtered) {
    const card = buildConversationCard(conv);
    container.appendChild(card);
  }
}

function buildConversationCard(conv) {
  const card = document.createElement('div');
  card.className = `conv-card${conv.isUnread ? ' unread' : ''}${activeConversation?.id === conv.id ? ' selected' : ''}`;
  card.dataset.convId = conv.id;

  // Avatar
  const avatar = document.createElement('div');
  avatar.className = 'conv-avatar';
  if (conv.avatarUrl && !conv.avatarUrl.startsWith('data:')) {
    const img = document.createElement('img');
    img.src = conv.avatarUrl;
    img.alt = conv.name;
    img.onerror = () => { avatar.textContent = getInitials(conv.name); };
    avatar.appendChild(img);
  } else {
    avatar.textContent = getInitials(conv.name);
    avatar.style.background = stringToColor(conv.name);
  }

  // Body
  const body = document.createElement('div');
  body.className = 'conv-body';

  const top = document.createElement('div');
  top.className = 'conv-top';

  const name = document.createElement('span');
  name.className = 'conv-name';
  name.textContent = conv.name;

  const time = document.createElement('span');
  time.className = 'conv-time';
  time.textContent = formatTime(conv.timestamp);

  top.appendChild(name);
  top.appendChild(time);

  const snippet = document.createElement('div');
  snippet.className = 'conv-snippet';
  snippet.textContent = conv.snippet || 'No messages yet';

  const tags = document.createElement('div');
  tags.className = 'conv-tags';

  // Assigned labels
  const assignedLabels = (conv.labels || []).map(id => labels.find(l => l.id === id)).filter(Boolean);
  for (const label of assignedLabels) {
    const tag = document.createElement('span');
    tag.className = 'conv-tag';
    tag.style.background = label.color;
    tag.textContent = label.name;
    tag.title = `Click to remove ${label.name}`;
    tag.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeLabel(conv.id, label.id);
    });
    tags.appendChild(tag);
  }

  // Add label "+" button
  if (labels.length > 0) {
    const addBtn = document.createElement('button');
    addBtn.className = 'conv-add-label';
    addBtn.title = 'Add label';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showLabelAssignDropdown(addBtn, conv);
    });
    tags.appendChild(addBtn);
  }

  // Unread dot
  if (conv.isUnread) {
    const dot = document.createElement('div');
    dot.className = 'unread-dot';
    card.appendChild(dot);
  }

  body.appendChild(top);
  body.appendChild(snippet);
  body.appendChild(tags);
  card.appendChild(avatar);
  card.appendChild(body);

  // Click → open message composer
  card.addEventListener('click', () => selectConversation(conv));

  return card;
}

// ─── Conversation detail view ─────────────────────────────────────────────────

let detailConv = null;
let detailNoteDebounce = null;
let modalLabelSearch = '';

function selectConversation(conv) {
  activeConversation = conv;
  renderConversationList();
  openConversationDetail(conv);
}

async function openConversationDetail(conv) {
  detailConv = conv;

  // Show the detail overlay
  document.getElementById('conv-detail').classList.remove('hidden');

  // Header
  const avatarEl = document.getElementById('detail-avatar');
  avatarEl.innerHTML = '';
  if (conv.avatarUrl && !conv.avatarUrl.startsWith('data:')) {
    const img = document.createElement('img');
    img.src = conv.avatarUrl;
    img.alt = conv.name;
    img.onerror = () => { avatarEl.textContent = getInitials(conv.name); };
    avatarEl.appendChild(img);
  } else {
    avatarEl.textContent = getInitials(conv.name);
    avatarEl.style.background = stringToColor(conv.name);
  }

  const nameEl = document.getElementById('detail-name');
  nameEl.textContent = conv.name;
  nameEl.href = `https://www.linkedin.com/messaging/thread/${encodeURIComponent(conv.id)}/`;

  document.getElementById('detail-company').textContent = conv.company || '';

  // Note
  const stored = await chrome.storage.local.get('notes');
  const notes = stored.notes || {};
  document.getElementById('detail-note').value = notes[conv.id] || '';

  // Label chips
  renderDetailLabelChips(conv);

  // Messages
  await loadConversationMessages(conv);
}

function renderDetailLabelChips(conv) {
  let chipsEl = document.getElementById('detail-label-chips');
  if (!chipsEl) {
    chipsEl = document.createElement('div');
    chipsEl.id = 'detail-label-chips';
    chipsEl.className = 'detail-label-chips';
    const noteWrap = document.getElementById('detail-note-wrap') || document.querySelector('.detail-note-wrap');
    if (noteWrap) noteWrap.after(chipsEl);
  }
  chipsEl.innerHTML = '';
  const assigned = (conv.labels || []).map(id => labels.find(l => l.id === id)).filter(Boolean);
  for (const label of assigned) {
    const chip = document.createElement('span');
    chip.className = 'detail-label-chip';
    chip.style.background = label.color;
    chip.textContent = label.name;
    chip.title = 'Click to remove';
    chip.addEventListener('click', async () => {
      await removeLabel(conv.id, label.id);
      const updated = conversations.find(c => c.id === conv.id);
      if (updated) { detailConv = updated; renderDetailLabelChips(updated); }
    });
    chipsEl.appendChild(chip);
  }
}

function closeConversationDetail() {
  detailConv = null;
  activeConversation = null;
  document.getElementById('conv-detail').classList.add('hidden');
  document.getElementById('detail-msg-input').value = '';
  renderConversationList();
}

async function loadConversationMessages(conv) {
  const thread = document.getElementById('message-thread');
  const loadingEl = document.getElementById('msg-loading');
  const emptyEl = document.getElementById('msg-empty');

  // Clear previous messages (keep loading/empty els)
  thread.querySelectorAll('.msg-date-sep, .msg-row').forEach(el => el.remove());
  loadingEl.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'FETCH_CONVERSATION_MESSAGES',
      convId: conv.id,
    });

    loadingEl.classList.add('hidden');

    if (!result?.ok || !result.messages?.length) {
      emptyEl.classList.remove('hidden');
      return;
    }

    renderMessageThread(result.messages);
  } catch (err) {
    loadingEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
  }
}

function renderMessageThread(messages) {
  const thread = document.getElementById('message-thread');
  thread.querySelectorAll('.msg-date-sep, .msg-row').forEach(el => el.remove());

  const myName = linkedInProfile?.name || '';
  let lastDateStr = '';

  for (const msg of messages) {
    const dateStr = formatDateSep(msg.sentAt);
    if (dateStr !== lastDateStr) {
      const sep = document.createElement('div');
      sep.className = 'msg-date-sep';
      sep.textContent = dateStr;
      thread.appendChild(sep);
      lastDateStr = dateStr;
    }

    const isSent = myName && msg.senderName && msg.senderName === myName;
    const row = document.createElement('div');
    row.className = `msg-row ${isSent ? 'sent' : 'received'}`;

    // Avatar (only for received)
    if (!isSent) {
      const av = document.createElement('div');
      av.className = 'msg-row-avatar';
      if (msg.senderAvatar) {
        const img = document.createElement('img');
        img.src = msg.senderAvatar;
        img.onerror = () => { av.textContent = getInitials(msg.senderName); };
        av.appendChild(img);
      } else {
        av.textContent = getInitials(msg.senderName);
      }
      row.appendChild(av);
    }

    const wrap = document.createElement('div');
    wrap.className = 'msg-bubble-wrap';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = msg.text;
    wrap.appendChild(bubble);

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = formatMsgTime(msg.sentAt);
    wrap.appendChild(meta);

    row.appendChild(wrap);
    thread.appendChild(row);
  }

  // Scroll to bottom
  thread.scrollTop = thread.scrollHeight;
}

async function sendMessage() {
  const conv = detailConv || activeConversation;
  if (!conv) return;
  const textarea = document.getElementById('detail-msg-input');
  const text = textarea.value.trim();
  if (!text) return;

  const btn = document.getElementById('btn-detail-send');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'SEND_MESSAGE',
      conversationUrl: conv.url,
      text,
    });

    if (result?.ok) {
      textarea.value = '';
      showToast('Message sent!', 'success');
      // Optimistically add message to thread
      renderMessageThread([{
        id: 'tmp-' + Date.now(),
        text,
        sentAt: Date.now(),
        senderName: linkedInProfile?.name || 'You',
        senderUrn: '',
        senderAvatar: '',
      }].concat([]));
      await loadConversationMessages(conv);
    } else {
      showToast(result?.error || 'Send failed', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send';
  }
}

// ─── Label modal ──────────────────────────────────────────────────────────────

function showLabelModal() {
  const conv = detailConv;
  if (!conv) return;
  modalLabelSearch = '';
  document.getElementById('label-modal-search').value = '';
  renderLabelModalList(conv);
  document.getElementById('label-modal').classList.remove('hidden');
  document.getElementById('label-modal-search').focus();
}

function hideLabelModal() {
  document.getElementById('label-modal').classList.add('hidden');
}

function renderLabelModalList(conv) {
  const container = document.getElementById('label-modal-list');
  container.innerHTML = '';
  const assigned = conv.labels || [];
  const q = modalLabelSearch.toLowerCase();
  const filtered = labels.filter(l => !q || l.name.toLowerCase().includes(q));

  for (const label of filtered) {
    const item = document.createElement('label');
    item.className = 'label-modal-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = assigned.includes(label.id);
    cb.addEventListener('change', async () => {
      if (cb.checked) {
        await assignLabel(conv.id, label.id);
      } else {
        await removeLabel(conv.id, label.id);
      }
      const updated = conversations.find(c => c.id === conv.id);
      if (updated) {
        detailConv = updated;
        renderDetailLabelChips(updated);
      }
    });

    const dot = document.createElement('span');
    dot.className = 'label-modal-dot';
    dot.style.background = label.color;

    const name = document.createElement('span');
    name.className = 'label-modal-name';
    name.textContent = label.name;

    item.append(cb, dot, name);
    container.appendChild(item);
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding:16px;text-align:center;font-size:13px;color:#888">No labels found</div>';
  }
}

// Keep existing label dropdown for backward compat (will be unused)
function showLabelAssignDropdown(anchor, conv) {
  showLabelModal();
}

// ─── Labels tab ─────────────────────────────────────────────────────────────

function renderColorSwatches() {
  const container = document.getElementById('color-swatches');
  container.innerHTML = '';

  for (const color of LABEL_COLORS) {
    const swatch = document.createElement('div');
    swatch.className = `color-swatch${color === selectedColor ? ' selected' : ''}`;
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.title = color;
    swatch.addEventListener('click', () => {
      selectedColor = color;
      renderColorSwatches();
    });
    container.appendChild(swatch);
  }
}

function renderLabelsList() {
  const container = document.getElementById('labels-list');
  const emptyEl = document.getElementById('labels-empty');

  container.querySelectorAll('.label-row, .label-delete-confirm').forEach(el => el.remove());

  if (labels.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');

  for (const label of labels) {
    const count = conversations.filter(c => (c.labels || []).includes(label.id)).length;
    const row = buildLabelRow(label, count);
    container.appendChild(row);
  }
}

function buildLabelRow(label, count) {
  const row = document.createElement('div');
  row.className = 'label-row';
  row.dataset.labelId = label.id;

  const dot = document.createElement('div');
  dot.className = 'label-color-dot';
  dot.style.background = label.color;

  const name = document.createElement('span');
  name.className = 'label-row-name';
  name.textContent = label.name;

  const badge = document.createElement('span');
  badge.className = 'label-count';
  badge.textContent = count;

  const actions = document.createElement('div');
  actions.className = 'label-row-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'label-action-btn';
  editBtn.title = 'Edit label';
  editBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  editBtn.addEventListener('click', () => startEditLabel(label));

  const delBtn = document.createElement('button');
  delBtn.className = 'label-action-btn danger';
  delBtn.title = 'Delete label';
  delBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
  delBtn.addEventListener('click', () => confirmDeleteLabel(label, row));

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  row.appendChild(dot);
  row.appendChild(name);
  row.appendChild(badge);
  row.appendChild(actions);

  return row;
}

function confirmDeleteLabel(label, row) {
  const existing = document.querySelector('.label-delete-confirm');
  if (existing) existing.remove();

  const confirm = document.createElement('div');
  confirm.className = 'label-delete-confirm';
  confirm.innerHTML = `<span>Delete "${escapeHtml(label.name)}"?</span>`;

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-ghost btn-sm';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => confirm.remove());

  const delBtn = document.createElement('button');
  delBtn.style.cssText = 'padding:4px 10px;background:#ef4444;color:#fff;border:none;border-radius:5px;font-size:12px;font-weight:600;cursor:pointer;';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', async () => {
    await deleteLabel(label.id);
    confirm.remove();
    showToast(`Deleted "${label.name}"`, 'success');
  });

  confirm.appendChild(cancelBtn);
  confirm.appendChild(delBtn);
  row.insertAdjacentElement('afterend', confirm);
}

function startEditLabel(label) {
  editingLabelId = label.id;
  selectedColor = label.color;

  const form = document.getElementById('label-form');
  const nameInput = document.getElementById('label-name-input');
  nameInput.value = label.name;

  form.classList.remove('hidden');
  renderColorSwatches();
  nameInput.focus();
  nameInput.select();

  document.getElementById('btn-new-label').textContent = 'Editing…';
}

function showNewLabelForm() {
  editingLabelId = null;
  selectedColor = LABEL_COLORS[0];
  const form = document.getElementById('label-form');
  const nameInput = document.getElementById('label-name-input');
  nameInput.value = '';
  form.classList.remove('hidden');
  renderColorSwatches();
  nameInput.focus();
}

function hideLabelForm() {
  editingLabelId = null;
  document.getElementById('label-form').classList.add('hidden');
  document.getElementById('label-name-input').value = '';
  document.getElementById('btn-new-label').innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg> New Label`;
}

async function saveLabel() {
  const name = document.getElementById('label-name-input').value.trim();
  if (!name) {
    document.getElementById('label-name-input').focus();
    return;
  }

  if (editingLabelId) {
    await updateLabel(editingLabelId, { name, color: selectedColor });
    showToast('Label updated', 'success');
  } else {
    await createLabel(name, selectedColor);
    showToast(`Label "${name}" created`, 'success');
  }

  hideLabelForm();
}

// ─── Outreach tab ────────────────────────────────────────────────────────────

function renderOutreachTab() {
  const disconnectedEl = document.getElementById('outreach-disconnected');
  const connectedEl = document.getElementById('outreach-connected');

  if (outreachAuth?.accessToken) {
    disconnectedEl.classList.add('hidden');
    connectedEl.classList.remove('hidden');
  } else {
    disconnectedEl.classList.remove('hidden');
    connectedEl.classList.add('hidden');
  }
}

async function connectOutreach() {
  const clientId = document.getElementById('outreach-client-id').value.trim();
  const clientSecret = document.getElementById('outreach-client-secret').value.trim();
  const errorEl = document.getElementById('outreach-connect-error');
  const btn = document.getElementById('btn-outreach-connect');

  if (!clientId || !clientSecret) {
    errorEl.textContent = 'Please enter both Client ID and Client Secret.';
    errorEl.classList.remove('hidden');
    return;
  }

  errorEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Connecting…';

  // Save config first
  await setOutreachConfig({ clientId, clientSecret });

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'OUTREACH_CONNECT',
      clientId,
      clientSecret,
    });

    if (result.ok) {
      outreachAuth = result.auth;
      renderOutreachTab();
      showToast('Outreach connected!', 'success');
      await loadOutreachSequences();
    } else {
      errorEl.textContent = result.error || 'Connection failed';
      errorEl.classList.remove('hidden');
    }
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect with Outreach';
  }
}

async function disconnectOutreach() {
  await chrome.runtime.sendMessage({ type: 'OUTREACH_DISCONNECT' });
  outreachAuth = null;
  outreachSequences = [];
  pendingSteps = [];
  renderOutreachTab();
  renderSequencesList();
  showToast('Outreach disconnected', 'success');
}

async function loadOutreachSequences() {
  if (!outreachAuth?.accessToken) return;

  const loadingEl = document.getElementById('sequences-loading');
  const listEl = document.getElementById('sequences-list');
  const emptyEl = document.getElementById('sequences-empty');

  loadingEl.classList.remove('hidden');
  listEl.querySelectorAll('.sequence-group').forEach(el => el.remove());
  emptyEl.classList.add('hidden');

  try {
    const [sequences, tasks] = await Promise.all([
      getSequences(outreachAuth),
      getPendingLinkedInTasks(outreachAuth),
    ]);

    outreachSequences = sequences;
    pendingSteps = tasks;

    loadingEl.classList.add('hidden');
    renderSequencesList();
  } catch (err) {
    loadingEl.classList.add('hidden');
    showToast('Failed to load Outreach data: ' + err.message, 'error');
    emptyEl.classList.remove('hidden');
  }
}

function renderSequencesList() {
  const listEl = document.getElementById('sequences-list');
  const emptyEl = document.getElementById('sequences-empty');

  listEl.querySelectorAll('.sequence-group').forEach(el => el.remove());

  if (pendingSteps.length === 0) {
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');

  // Group tasks by sequence
  const grouped = new Map();
  for (const task of pendingSteps) {
    const key = task.sequence.id;
    if (!grouped.has(key)) {
      grouped.set(key, { sequence: task.sequence, tasks: [] });
    }
    grouped.get(key).tasks.push(task);
  }

  for (const [seqId, { sequence, tasks }] of grouped) {
    const group = buildSequenceGroup(seqId, sequence, tasks);
    listEl.appendChild(group);
  }
}

function buildSequenceGroup(seqId, sequence, tasks) {
  const group = document.createElement('div');
  group.className = `sequence-group${openSequenceIds.has(seqId) ? ' open' : ''}`;

  const header = document.createElement('div');
  header.className = 'sequence-group-header';

  const seqName = document.createElement('span');
  seqName.className = 'sequence-group-name';
  seqName.textContent = sequence.name;

  const count = document.createElement('span');
  count.className = 'sequence-step-count';
  count.textContent = `${tasks.length} step${tasks.length !== 1 ? 's' : ''}`;

  const chevron = document.createElement('svg');
  chevron.setAttribute('width', '14');
  chevron.setAttribute('height', '14');
  chevron.setAttribute('viewBox', '0 0 24 24');
  chevron.setAttribute('fill', 'none');
  chevron.setAttribute('stroke', 'currentColor');
  chevron.setAttribute('stroke-width', '2');
  chevron.className = 'chevron';
  chevron.innerHTML = '<polyline points="9 18 15 12 9 6"/>';

  header.appendChild(seqName);
  header.appendChild(count);
  header.appendChild(chevron);

  header.addEventListener('click', () => {
    group.classList.toggle('open');
    if (group.classList.contains('open')) {
      openSequenceIds.add(seqId);
    } else {
      openSequenceIds.delete(seqId);
    }
  });

  const steps = document.createElement('div');
  steps.className = 'sequence-steps';

  for (const task of tasks) {
    steps.appendChild(buildStepCard(task, seqId));
  }

  group.appendChild(header);
  group.appendChild(steps);
  return group;
}

function buildStepCard(task, seqId) {
  const card = document.createElement('div');
  card.className = 'step-card';

  const header = document.createElement('div');
  header.className = 'step-card-header';

  const prospectName = document.createElement('div');
  prospectName.className = 'step-prospect-name';
  prospectName.textContent = task.prospect.name || 'Unknown Prospect';

  const badge = document.createElement('span');
  badge.className = 'step-badge';
  badge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14zm-7 3.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zm1 4h-2v6h2v-6z"/></svg> LinkedIn`;

  header.appendChild(prospectName);
  header.appendChild(badge);

  const company = document.createElement('div');
  company.className = 'step-company';
  company.textContent = [task.prospect.title, task.prospect.company].filter(Boolean).join(' · ') || 'No details';

  const actions = document.createElement('div');
  actions.className = 'step-actions';

  if (task.prospect.linkedinUrl) {
    const openBtn = document.createElement('button');
    openBtn.className = 'btn-open-profile';
    openBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Open Profile`;
    openBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_LINKEDIN' });
      chrome.tabs.create({ url: task.prospect.linkedinUrl });
    });
    actions.appendChild(openBtn);
  }

  const execBtn = document.createElement('button');
  execBtn.className = 'btn-execute';
  execBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg> Send via LinkedIn`;
  execBtn.addEventListener('click', () => executeOutreachStep(task, execBtn, card));
  actions.appendChild(execBtn);

  card.appendChild(header);
  card.appendChild(company);
  card.appendChild(actions);

  return card;
}

async function executeOutreachStep(task, btn, card) {
  const message = `Hi ${task.prospect.name?.split(' ')[0] || 'there'},\n\nI wanted to reach out regarding ${task.sequence.name}. Would you be open to connecting?\n\nBest regards`;

  // Open a quick message composer pre-filled
  const composer = document.getElementById('message-composer');
  const nameEl = document.getElementById('composer-name');
  const textarea = document.getElementById('composer-text');

  // Switch to conversations tab to show composer
  switchTab('conversations');

  // Create a virtual conversation object for the prospect
  const virtualConv = {
    id: `outreach_${task.id}`,
    name: task.prospect.name,
    url: task.prospect.linkedinUrl || LINKEDIN_URL,
    labels: [],
    isOutreachTask: true,
    outreachTaskId: task.id,
    outreachStateId: task.id,
  };

  activeConversation = virtualConv;
  nameEl.textContent = `Message to ${task.prospect.name} (Outreach Step ${task.stepNumber})`;
  textarea.value = message;
  composer.classList.remove('hidden');
  textarea.focus();
}

const LINKEDIN_URL = 'https://www.linkedin.com/messaging/';

// ─── LinkedIn Account Bar ─────────────────────────────────────────────────

function renderLinkedInAccountBar(lastSyncedAt) {
  const notSynced = document.getElementById('li-not-synced');
  const synced = document.getElementById('li-synced');
  const nameEl = document.getElementById('li-account-name');
  const statusEl = document.getElementById('li-sync-status');
  const avatarEl = document.getElementById('li-avatar');

  if (linkedInProfile || conversations.length > 0) {
    notSynced.classList.add('hidden');
    synced.classList.remove('hidden');

    const name = linkedInProfile?.name || 'LinkedIn Account';
    nameEl.textContent = name;

    if (lastSyncedAt) {
      const mins = Math.round((Date.now() - lastSyncedAt) / 60000);
      statusEl.textContent = mins < 1 ? 'Synced just now' : `Synced ${mins}m ago · ${conversations.length} conversations`;
    } else {
      statusEl.textContent = `${conversations.length} conversations`;
    }

    // Avatar
    avatarEl.innerHTML = '';
    if (linkedInProfile?.avatarUrl) {
      const img = document.createElement('img');
      img.src = linkedInProfile.avatarUrl;
      img.alt = name;
      img.onerror = () => { avatarEl.textContent = getInitials(name); };
      avatarEl.appendChild(img);
    } else {
      avatarEl.textContent = getInitials(name);
    }
  } else {
    notSynced.classList.remove('hidden');
    synced.classList.add('hidden');
  }
}

async function syncLinkedIn(source = 'linkedin') {
  if (isSyncing) return;
  isSyncing = true;

  const syncBtn = document.getElementById('btn-li-sync');
  const resyncBtn = document.getElementById('btn-li-resync');
  const statusEl = document.getElementById('li-sync-status');

  const setLoading = (loading) => {
    if (syncBtn) { syncBtn.disabled = loading; syncBtn.textContent = loading ? 'Importing…' : 'Import'; }
    if (resyncBtn) resyncBtn.classList.toggle('spinning', loading);
    if (statusEl && loading) statusEl.textContent = 'Syncing…';
  };

  setLoading(true);

  try {
    // Fetch messages
    const result = await chrome.runtime.sendMessage({ type: 'FETCH_LINKEDIN_MESSAGES', source });

    if (!result?.ok) {
      if (result?.error === 'NOT_LOGGED_IN') {
        showToast('Please log into LinkedIn in your browser first', 'error');
        chrome.runtime.sendMessage({ type: 'OPEN_LINKEDIN' });
      } else {
        // Voyager failed — fall back to Plan B passive mode
        const passiveEl = document.getElementById('li-passive-mode');
        passiveEl?.classList.remove('hidden');
        const badge = document.getElementById('sync-method-badge');
        if (badge) { badge.textContent = 'Plan B'; badge.style.background = '#fef3c7'; badge.style.color = '#b45309'; }
        showToast('Voyager unavailable — browse LinkedIn inbox to sync passively', 'error');
      }
      setLoading(false);
      isSyncing = false;
      return;
    }

    // Success — hide passive notice, update badge
    document.getElementById('li-passive-mode')?.classList.add('hidden');
    const badge = document.getElementById('sync-method-badge');
    if (badge) { badge.textContent = 'Plan A'; badge.style.background = ''; badge.style.color = ''; }

    const count = result.count || 0;
    showToast(`Imported ${count} conversation${count !== 1 ? 's' : ''}`, 'success');

    // Reload conversations from storage
    conversations = await getConversations();

    // Fetch profile if not already stored
    if (!linkedInProfile) {
      const profileResult = await chrome.runtime.sendMessage({ type: 'FETCH_LINKEDIN_PROFILE' });
      if (profileResult?.profile) {
        linkedInProfile = profileResult.profile;
        await chrome.storage.local.set({ linkedInProfile });
      }
    }

    const now = Date.now();
    await chrome.storage.local.set({ lastSyncedAt: now });

    renderLinkedInAccountBar(now);
    renderConversationList();
    renderFilterChips();

  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    setLoading(false);
    isSyncing = false;
  }
}

// ─── Sync ────────────────────────────────────────────────────────────────────

async function findLinkedInTab() {
  const tabs = await chrome.tabs.query({});
  // Prefer messaging/inbox tabs (already have content loaded)
  return (
    tabs.find(t => t.url && (t.url.includes('linkedin.com/messaging') || t.url.includes('linkedin.com/sales/inbox'))) ||
    tabs.find(t => t.url && t.url.includes('linkedin.com'))
  );
}

async function pingContentScript(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return res?.ok === true;
  } catch {
    return false;
  }
}

async function syncConversations() {
  const btn = document.getElementById('btn-sync');
  btn.classList.add('spinning');

  try {
    let linkedInTab = await findLinkedInTab();

    if (!linkedInTab) {
      // Open LinkedIn messaging and wait for it to load
      showToast('Opening LinkedIn Messaging…', '');
      linkedInTab = await chrome.tabs.create({ url: 'https://www.linkedin.com/messaging/' });
      // Wait for page load + React hydration
      await new Promise(r => setTimeout(r, 5000));
    } else if (!linkedInTab.url?.includes('/messaging') && !linkedInTab.url?.includes('/sales/inbox')) {
      // Navigate existing tab to messaging
      await chrome.tabs.update(linkedInTab.id, { url: 'https://www.linkedin.com/messaging/' });
      await new Promise(r => setTimeout(r, 5000));
    }

    // Check if content script is alive
    const alive = await pingContentScript(linkedInTab.id);
    if (!alive) {
      // Inject it manually
      try {
        await chrome.scripting.executeScript({ target: { tabId: linkedInTab.id }, files: ['content/content.js'] });
        await chrome.scripting.insertCSS({ target: { tabId: linkedInTab.id }, files: ['content/content.css'] });
        await new Promise(r => setTimeout(r, 1500));
      } catch { /* scripting may not have permission on this URL */ }
    }

    const result = await chrome.tabs.sendMessage(linkedInTab.id, { type: 'SCRAPE_NOW' });
    if (result?.conversations?.length > 0) {
      await chrome.runtime.sendMessage({
        type: 'SYNC_CONVERSATIONS',
        conversations: result.conversations,
      });
      showToast(`Synced ${result.conversations.length} conversations`, 'success');
    } else {
      showToast('Scroll the LinkedIn inbox to load conversations, then sync again', 'error');
    }
  } catch (err) {
    showToast('Sync failed: ' + err.message, 'error');
  } finally {
    btn.classList.remove('spinning');
  }
}

// ─── Event listeners ─────────────────────────────────────────────────────────

function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Search
  document.getElementById('conv-search').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderConversationList();
  });

  // LinkedIn sync buttons
  document.getElementById('btn-li-sync').addEventListener('click', () => syncLinkedIn('linkedin'));
  document.getElementById('btn-li-resync').addEventListener('click', () => syncLinkedIn('linkedin'));

  // Header sync button
  document.getElementById('btn-sync').addEventListener('click', syncConversations);

  // Detail view
  document.getElementById('btn-detail-back').addEventListener('click', closeConversationDetail);
  document.getElementById('btn-detail-send').addEventListener('click', sendMessage);
  document.getElementById('btn-detail-li').addEventListener('click', () => {
    if (detailConv?.url) chrome.tabs.create({ url: detailConv.url });
  });
  document.getElementById('detail-msg-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
    }
  });
  document.getElementById('detail-note').addEventListener('input', (e) => {
    clearTimeout(detailNoteDebounce);
    detailNoteDebounce = setTimeout(async () => {
      if (!detailConv) return;
      const stored = await chrome.storage.local.get('notes');
      const notes = stored.notes || {};
      notes[detailConv.id] = e.target.value;
      await chrome.storage.local.set({ notes });
    }, 600);
  });

  // Label modal
  document.getElementById('btn-label-float').addEventListener('click', showLabelModal);
  document.getElementById('btn-modal-done').addEventListener('click', hideLabelModal);
  document.getElementById('label-modal-backdrop').addEventListener('click', hideLabelModal);
  document.getElementById('label-modal-search').addEventListener('input', (e) => {
    modalLabelSearch = e.target.value;
    if (detailConv) renderLabelModalList(detailConv);
  });
  document.getElementById('btn-modal-create-label').addEventListener('click', () => {
    hideLabelModal();
    switchTab('labels');
    document.getElementById('btn-new-label')?.click();
  });

  // Labels
  document.getElementById('btn-new-label').addEventListener('click', showNewLabelForm);
  document.getElementById('btn-label-cancel').addEventListener('click', hideLabelForm);
  document.getElementById('btn-label-save').addEventListener('click', saveLabel);
  document.getElementById('label-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveLabel();
    if (e.key === 'Escape') hideLabelForm();
  });

  // Outreach
  document.getElementById('btn-outreach-connect').addEventListener('click', connectOutreach);
  document.getElementById('btn-outreach-disconnect').addEventListener('click', disconnectOutreach);
  document.getElementById('btn-refresh-sequences').addEventListener('click', loadOutreachSequences);

  // Quick actions
  document.getElementById('btn-open-linkedin').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_LINKEDIN' });
  });
  document.getElementById('btn-open-salesnav').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_SALES_NAV' });
  });
}

// ─── Settings tab ────────────────────────────────────────────────────────────

function initSettingsTab(stored) {
  // Populate redirect URI field
  const redirectInput = document.getElementById('li-redirect-uri');
  if (redirectInput) {
    redirectInput.value = `https://${chrome.runtime.id}.chromiumapp.org/linkedin`;
  }

  // Unread badge toggle
  const badgeToggle = document.getElementById('toggle-badge');
  if (badgeToggle) {
    badgeToggle.checked = stored.badgeEnabled !== false; // default on
    badgeToggle.addEventListener('change', () => {
      chrome.storage.local.set({ badgeEnabled: badgeToggle.checked });
      const statusEl = document.getElementById('badge-status');
      if (statusEl) statusEl.textContent = badgeToggle.checked ? 'On' : 'Off';
    });
    const statusEl = document.getElementById('badge-status');
    if (statusEl) statusEl.textContent = badgeToggle.checked ? 'On' : 'Off';
  }

  // Passive sync toggle
  const passiveToggle = document.getElementById('toggle-passive');
  if (passiveToggle) {
    passiveToggle.checked = stored.passiveSyncEnabled !== false; // default on
    passiveToggle.addEventListener('change', () => {
      chrome.storage.local.set({ passiveSyncEnabled: passiveToggle.checked });
      updatePlanBStatus(passiveToggle.checked);
    });
    updatePlanBStatus(passiveToggle.checked !== false);
  }

  // Render Plan C state from stored OAuth
  if (stored.linkedInOAuth && stored.linkedInProfile) {
    renderOAuthConnected(stored.linkedInProfile);
  }

  // Copy redirect URI button
  document.getElementById('btn-copy-redirect')?.addEventListener('click', () => {
    const val = document.getElementById('li-redirect-uri')?.value;
    if (val) {
      navigator.clipboard.writeText(val).then(() => showToast('Redirect URI copied', 'success'));
    }
  });

  // Plan A: Test Voyager connection
  document.getElementById('btn-test-voyager')?.addEventListener('click', testVoyagerConnection);

  // Plan C: OAuth connect
  document.getElementById('btn-li-oauth-connect')?.addEventListener('click', connectLinkedInOAuth);

  // Plan C: Complete exchange (after user enters client secret)
  document.getElementById('btn-li-oauth-exchange')?.addEventListener('click', exchangeLinkedInOAuth);

  // Plan C: Disconnect
  document.getElementById('btn-li-oauth-disconnect')?.addEventListener('click', disconnectLinkedInOAuth);
}

function updatePlanBStatus(enabled) {
  const statusEl = document.getElementById('plan-b-status');
  if (!statusEl) return;
  if (enabled) {
    statusEl.textContent = 'Active';
    statusEl.className = 'plan-status';
  } else {
    statusEl.textContent = 'Disabled';
    statusEl.className = 'plan-status inactive';
  }
}

async function testVoyagerConnection() {
  const btn = document.getElementById('btn-test-voyager');
  const resultEl = document.getElementById('voyager-test-result');
  if (!btn || !resultEl) return;

  btn.disabled = true;
  btn.textContent = 'Testing…';
  resultEl.className = 'settings-result hidden';

  try {
    const result = await chrome.runtime.sendMessage({ type: 'FETCH_LINKEDIN_MESSAGES', source: 'linkedin' });
    if (result?.ok) {
      resultEl.className = 'settings-result success';
      resultEl.textContent = `Connected! ${result.count || 0} conversation(s) fetched via Voyager API.`;
      document.getElementById('plan-a-status').textContent = 'Active';
    } else {
      resultEl.className = 'settings-result error';
      const errMsg = result?.error || 'Unknown error';
      resultEl.textContent = errMsg === 'NOT_LOGGED_IN'
        ? 'Not logged into LinkedIn. Open LinkedIn in your browser and log in first.'
        : `Voyager unavailable: ${errMsg}`;
      document.getElementById('plan-a-status').textContent = 'Unavailable';
    }
  } catch (err) {
    resultEl.className = 'settings-result error';
    resultEl.textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Connection';
  }
}

// Pending OAuth state (between Connect click and Exchange click)
let _pendingOAuthCode = null;
let _pendingRedirectUri = null;

async function connectLinkedInOAuth() {
  const btn = document.getElementById('btn-li-oauth-connect');
  const clientId = document.getElementById('li-oauth-client-id')?.value?.trim();
  const errorEl = document.getElementById('li-oauth-error');

  if (!clientId) {
    showOAuthError('Please enter your LinkedIn App Client ID.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Opening LinkedIn…';
  errorEl?.classList.add('hidden');

  try {
    const result = await chrome.runtime.sendMessage({ type: 'LINKEDIN_OAUTH_CONNECT', clientId });

    if (result?.requiresSecret) {
      // Step 1 done — show exchange panel
      _pendingOAuthCode = result.code;
      _pendingRedirectUri = result.redirectUri;
      document.getElementById('li-oauth-exchange')?.classList.remove('hidden');
      btn.textContent = 'Re-authorize';
    } else if (result?.ok) {
      renderOAuthConnected(result.profile);
      showToast('LinkedIn connected!', 'success');
    } else {
      showOAuthError(result?.error || 'OAuth failed');
    }
  } catch (err) {
    showOAuthError(err.message);
  } finally {
    btn.disabled = false;
    if (!_pendingOAuthCode) btn.textContent = 'Connect with LinkedIn';
  }
}

async function exchangeLinkedInOAuth() {
  const btn = document.getElementById('btn-li-oauth-exchange');
  const clientId = document.getElementById('li-oauth-client-id')?.value?.trim();
  const clientSecret = document.getElementById('li-oauth-client-secret')?.value?.trim();

  if (!clientSecret) {
    showOAuthError('Enter your LinkedIn App Client Secret to complete the connection.');
    return;
  }
  if (!_pendingOAuthCode) {
    showOAuthError('No pending authorization code. Click "Connect with LinkedIn" first.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Connecting…';

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'LINKEDIN_OAUTH_EXCHANGE',
      clientId,
      clientSecret,
      code: _pendingOAuthCode,
      redirectUri: _pendingRedirectUri,
    });

    if (result?.ok) {
      _pendingOAuthCode = null;
      _pendingRedirectUri = null;
      renderOAuthConnected(result.profile);
      showToast('LinkedIn API connected!', 'success');
    } else {
      showOAuthError(result?.error || 'Exchange failed');
    }
  } catch (err) {
    showOAuthError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Complete Connection';
  }
}

async function disconnectLinkedInOAuth() {
  await chrome.runtime.sendMessage({ type: 'LINKEDIN_OAUTH_DISCONNECT' });
  document.getElementById('li-oauth-connected')?.classList.add('hidden');
  document.getElementById('li-oauth-disconnected')?.classList.remove('hidden');
  document.getElementById('li-oauth-exchange')?.classList.add('hidden');
  document.getElementById('plan-c-status').textContent = 'Not connected';
  document.getElementById('plan-c-status').dataset.connected = 'false';
  _pendingOAuthCode = null;
  _pendingRedirectUri = null;
  showToast('LinkedIn API disconnected', '');
}

function renderOAuthConnected(profile) {
  document.getElementById('li-oauth-disconnected')?.classList.add('hidden');
  document.getElementById('li-oauth-connected')?.classList.remove('hidden');

  const nameEl = document.getElementById('oauth-name');
  const emailEl = document.getElementById('oauth-email');
  const avatarEl = document.getElementById('oauth-avatar');
  const statusEl = document.getElementById('plan-c-status');

  if (nameEl) nameEl.textContent = profile?.name || 'LinkedIn User';
  if (emailEl) emailEl.textContent = profile?.email || '';
  if (statusEl) { statusEl.textContent = 'Connected'; statusEl.dataset.connected = 'true'; }

  if (avatarEl) {
    avatarEl.innerHTML = '';
    if (profile?.avatarUrl) {
      const img = document.createElement('img');
      img.src = profile.avatarUrl;
      img.alt = profile.name || '';
      img.onerror = () => { avatarEl.textContent = getInitials(profile.name); };
      avatarEl.appendChild(img);
    } else {
      avatarEl.textContent = getInitials(profile?.name);
    }
  }
}

function showOAuthError(msg) {
  const el = document.getElementById('li-oauth-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ─── Toast ───────────────────────────────────────────────────────────────────

let toastTimeout = null;

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast${type ? ' ' + type : ''}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2800);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function stringToColor(str) {
  if (!str) return '#0A66C2';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#22c55e', '#0A66C2'];
  return colors[Math.abs(hash) % colors.length];
}

function formatDateSep(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now - date) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined });
}

function formatMsgTime(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return timestamp;
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Boot ────────────────────────────────────────────────────────────────────

init().catch(console.error);
