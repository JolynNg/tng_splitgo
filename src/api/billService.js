/**
 * Bill session service — talks to the AWS backend that hosts the live bill
 * session so the payer's dashboard and each participant's claim view stay in
 * sync across devices.
 *
 * Architecture:
 *   React Native client
 *      │
 *      ▼
 *   AWS API Gateway (HTTP API)
 *      │
 *      ▼
 *   AWS Lambda (Node.js 20)
 *      │
 *      ▼
 *   Amazon DynamoDB (table: SplitGoBills)
 *
 * Endpoints (defined in BACKEND_SETUP.md):
 *   POST   /bills              create a new bill group
 *   GET    /bills/{billId}     fetch live state (poll for updates)
 *   POST   /bills/{billId}/claim   participant claims/unclaims an item
 *   POST   /bills/{billId}/close   payer locks the bill
 *
 * For the hackathon demo, if EXPO_PUBLIC_AWS_API_URL is not set we fall
 * back to local in-app state (FlowContext) so the demo still works
 * end-to-end on a single device.
 */

const AWS_API_URL = process.env.EXPO_PUBLIC_AWS_API_URL;

const isCloudEnabled = () => Boolean(AWS_API_URL);

async function callApi(path, opts = {}) {
  if (!isCloudEnabled()) {
    throw new Error('AWS backend not configured — running in local demo mode.');
  }
  const base = AWS_API_URL.replace(/\/$/, '');
  const url = `${base}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    const msg = e?.message || String(e);
    if (/network request failed/i.test(msg)) {
      throw new Error(
        `${msg} — cannot reach ${base}. Re-run \`cd infra && ./deploy.sh\`, then \`npx expo start --clear\`.`,
      );
    }
    throw e;
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AWS API ${path} ${response.status}: ${text}`);
  }
  return response.json();
}

/**
 * Create a new bill group on the backend.
 * @param {Object} payload { creator, items, participants, receiptMeta }
 * @returns {Promise<{billId: string, shareLink: string, createdAt: number}>}
 */
export async function createBill(payload) {
  if (!isCloudEnabled()) {
    return { billId: null, shareLink: null, createdAt: Date.now(), local: true };
  }
  return callApi('/bills', { method: 'POST', body: payload });
}

/**
 * Fetch current bill state. Used for polling the live dashboard.
 * @param {string} billId
 */
export async function getBill(billId) {
  if (!isCloudEnabled()) {
    return { local: true };
  }
  return callApi(`/bills/${billId}`);
}

/**
 * Submit (or update) a participant's claim selection.
 * @param {string} billId
 * @param {Object} payload { participant, claimedItemIds: number[] }
 */
export async function submitClaim(billId, payload) {
  if (!isCloudEnabled()) {
    return { local: true };
  }
  return callApi(`/bills/${billId}/claim`, { method: 'POST', body: payload });
}

/**
 * Payer closes the bill, locking the claim window.
 * @param {string} billId
 */
export async function closeBill(billId) {
  if (!isCloudEnabled()) {
    return { local: true };
  }
  return callApi(`/bills/${billId}/close`, { method: 'POST', body: {} });
}

/** Participant opts out — removed from `participants` and all `claims` arrays. */
export async function leaveBill(billId, body) {
  if (!isCloudEnabled()) return { local: true };
  return callApi(`/bills/${billId}/leave`, { method: 'POST', body });
}

/** Creator-only: add/remove names on an open bill. */
export async function updateBillParticipants(billId, body) {
  if (!isCloudEnabled()) return { local: true };
  return callApi(`/bills/${billId}/participants`, { method: 'POST', body });
}

/** Mark a participant as done picking (or un-ready them with ready: false). */
export async function setReady(billId, body) {
  if (!isCloudEnabled()) return { local: true };
  return callApi(`/bills/${billId}/ready`, { method: 'POST', body });
}

/** Mark a participant as paid (or un-pay them with paid: false). */
export async function setPaid(billId, body) {
  if (!isCloudEnabled()) return { local: true };
  return callApi(`/bills/${billId}/paid`, { method: 'POST', body });
}

/** Creator-only: cancel a bill that was created in error. */
export async function cancelBill(billId, body) {
  if (!isCloudEnabled()) return { local: true };
  return callApi(`/bills/${billId}/cancel`, { method: 'POST', body });
}

/**
 * Delete a cancelled bill permanently.
 * Intended for travel hub cleanup after a bill has been cancelled.
 */
export async function deleteCancelledBill(billId, body) {
  if (!isCloudEnabled()) return { local: true };
  try {
    return await callApi(`/bills/${billId}/delete`, { method: 'POST', body });
  } catch (e) {
    const msg = String(e?.message || '');
    if (/route not found/i.test(msg) || /\s404:/.test(msg)) {
      throw new Error('Delete endpoint not deployed yet. Please run: cd infra && ./deploy.sh');
    }
    throw e;
  }
}

/**
 * List bills created by a given user (used for the History screen).
 * Server returns lightweight summaries — items/claims are not included.
 * @param {string} creator — exact contact name of the bill's creator
 * @returns {Promise<{creator: string, bills: Array<BillSummary>}>}
 */
export async function listBills(creator) {
  if (!isCloudEnabled()) {
    return { creator, bills: [], local: true };
  }
  return callApi(`/bills?creator=${encodeURIComponent(creator)}`);
}

/**
 * List all bills the user is involved in (creator OR participant).
 * Powers the SplitGoHomeScreen's "Active bills" cockpit so users can see and
 * resume any in-flight bill they're part of, no matter who created it.
 * @param {string} user — the current device's logged-in name
 */
export async function listBillsForUser(user) {
  if (!isCloudEnabled()) {
    return { user, bills: [], local: true };
  }
  return callApi(`/bills?user=${encodeURIComponent(user)}`);
}

export async function getTripInsights({ travelGroupId, user }) {
  if (!isCloudEnabled()) {
    return {
      travelGroupId,
      user,
      currency: 'MYR',
      totalTripSpend: 0,
      categoryBreakdown: [],
      perPersonSpend: [],
      mySpend: 0,
      groupAverage: 0,
      topSpender: null,
      advice: 'Backend not configured.',
      comparison: 'No comparison available in local mode.',
      local: true,
    };
  }
  return callApi('/ai/trip-insights', { method: 'POST', body: { travelGroupId, user } });
}

export const BACKEND_PROVIDER = isCloudEnabled()
  ? `AWS · ${AWS_API_URL}`
  : 'local demo mode';
