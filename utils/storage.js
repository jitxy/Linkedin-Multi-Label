// chrome.storage.local wrappers

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Conversations ──────────────────────────────────────────────────────────

export async function getConversations() {
  const result = await chrome.storage.local.get('conversations');
  return result.conversations || [];
}

export async function setConversations(conversations) {
  await chrome.storage.local.set({ conversations });
}

export async function assignLabel(conversationId, labelId) {
  const convos = await getConversations();
  const convo = convos.find(c => c.id === conversationId);
  if (!convo) return;
  if (!convo.labels) convo.labels = [];
  if (!convo.labels.includes(labelId)) {
    convo.labels.push(labelId);
    await setConversations(convos);
  }
}

export async function removeLabel(conversationId, labelId) {
  const convos = await getConversations();
  const convo = convos.find(c => c.id === conversationId);
  if (!convo) return;
  convo.labels = (convo.labels || []).filter(id => id !== labelId);
  await setConversations(convos);
}

// ─── Labels ─────────────────────────────────────────────────────────────────

export async function getLabels() {
  const result = await chrome.storage.local.get('labels');
  return result.labels || [];
}

export async function setLabels(labels) {
  await chrome.storage.local.set({ labels });
}

export async function createLabel(name, color) {
  const labels = await getLabels();
  const label = { id: uuid(), name, color, createdAt: Date.now() };
  labels.push(label);
  await setLabels(labels);
  return label;
}

export async function updateLabel(id, updates) {
  const labels = await getLabels();
  const idx = labels.findIndex(l => l.id === id);
  if (idx === -1) return null;
  labels[idx] = { ...labels[idx], ...updates };
  await setLabels(labels);
  return labels[idx];
}

export async function deleteLabel(id) {
  // Remove from all conversations
  const convos = await getConversations();
  for (const convo of convos) {
    convo.labels = (convo.labels || []).filter(lid => lid !== id);
  }
  await setConversations(convos);

  const labels = await getLabels();
  await setLabels(labels.filter(l => l.id !== id));
}

// ─── Outreach ────────────────────────────────────────────────────────────────

export async function getOutreachAuth() {
  const result = await chrome.storage.local.get('outreachAuth');
  return result.outreachAuth || null;
}

export async function setOutreachAuth(auth) {
  await chrome.storage.local.set({ outreachAuth: auth });
}

export async function getOutreachConfig() {
  const result = await chrome.storage.local.get('outreachConfig');
  return result.outreachConfig || { clientId: '', clientSecret: '' };
}

export async function setOutreachConfig(config) {
  await chrome.storage.local.set({ outreachConfig: config });
}
