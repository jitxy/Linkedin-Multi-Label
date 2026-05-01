import { getOutreachAuth, setOutreachAuth } from './storage.js';

const BASE = 'https://api.outreach.io/api/v2';

// Auto-refreshes token if expired before making a request
async function apiFetch(path, auth, options = {}) {
  let token = auth.accessToken;

  // Refresh if within 5 minutes of expiry
  if (auth.expiresAt && Date.now() > auth.expiresAt - 5 * 60 * 1000) {
    const refreshed = await refreshToken(auth);
    if (refreshed.ok) {
      token = refreshed.auth.accessToken;
    }
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.api+json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Outreach API error ${res.status}: ${body}`);
  }

  return res.json();
}

async function refreshToken(auth) {
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'OUTREACH_REFRESH_TOKEN',
      clientId: auth.clientId,
      clientSecret: auth.clientSecret,
    });
    if (result.ok) {
      return { ok: true, auth: result.auth };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

// ─── Sequences ───────────────────────────────────────────────────────────────

export async function getSequences(auth) {
  const data = await apiFetch('/sequences?page[size]=50&sort=-updatedAt', auth);
  return (data.data || []).map(seq => ({
    id: seq.id,
    name: seq.attributes.name,
    enabled: seq.attributes.enabled,
    stepCount: seq.attributes.stepCount,
    updatedAt: seq.attributes.updatedAt,
  }));
}

export async function getSequenceSteps(sequenceId, auth) {
  const data = await apiFetch(
    `/sequenceSteps?filter[sequence][id]=${sequenceId}&page[size]=100`,
    auth
  );
  return (data.data || [])
    .filter(step => {
      const type = (step.attributes.stepType || '').toLowerCase();
      return type === 'linkedin' || type === 'linkedin_message' || type === 'linkedin_connection';
    })
    .map(step => ({
      id: step.id,
      stepNumber: step.attributes.order,
      stepType: step.attributes.stepType,
      displayName: step.attributes.displayName || `Step ${step.attributes.order}`,
      taskNote: step.attributes.taskNote || '',
      sequenceId,
    }));
}

// ─── Sequence States (pending LinkedIn steps for prospects) ──────────────────

export async function getPendingLinkedInTasks(auth) {
  // Get active sequence states with LinkedIn step type
  const data = await apiFetch(
    '/sequenceStates?filter[state]=active&page[size]=50&include=prospect,sequence',
    auth
  );

  const prospects = {};
  const sequences = {};

  for (const inc of data.included || []) {
    if (inc.type === 'prospect') {
      prospects[inc.id] = {
        id: inc.id,
        name: `${inc.attributes.firstName || ''} ${inc.attributes.lastName || ''}`.trim(),
        email: inc.attributes.emails?.[0]?.email || '',
        linkedinUrl: inc.attributes.linkedInUrl || '',
        company: inc.attributes.company || '',
        title: inc.attributes.title || '',
      };
    }
    if (inc.type === 'sequence') {
      sequences[inc.id] = {
        id: inc.id,
        name: inc.attributes.name,
      };
    }
  }

  const tasks = [];
  for (const state of data.data || []) {
    const prospectId = state.relationships?.prospect?.data?.id;
    const sequenceId = state.relationships?.sequence?.data?.id;
    const prospect = prospects[prospectId];
    const sequence = sequences[sequenceId];
    if (!prospect || !sequence) continue;

    tasks.push({
      id: state.id,
      prospect,
      sequence,
      stepNumber: state.attributes.activeStepOrder,
      updatedAt: state.attributes.updatedAt,
    });
  }

  return tasks;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function createLinkedInTask(prospectId, sequenceStateId, note, auth) {
  const body = {
    data: {
      type: 'task',
      attributes: {
        taskType: 'linkedin',
        note,
        dueAt: new Date().toISOString(),
      },
      relationships: {
        prospect: { data: { type: 'prospect', id: String(prospectId) } },
        sequenceState: { data: { type: 'sequenceState', id: String(sequenceStateId) } },
      },
    },
  };

  const data = await apiFetch('/tasks', auth, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data.data;
}

export async function completeTask(taskId, auth) {
  const body = {
    data: {
      type: 'task',
      id: String(taskId),
      attributes: { state: 'complete' },
    },
  };
  const data = await apiFetch(`/tasks/${taskId}`, auth, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return data.data;
}
