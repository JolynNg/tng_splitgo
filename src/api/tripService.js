/**
 * Travel-trip service — AWS-backed.
 *
 * Trips are first-class records on the server (not just a per-device cache),
 * so every member of a trip sees the same name + roster regardless of which
 * device they signed in on.
 *
 *   GET   /trips?user=NAME                     → { user, trips: [...] }
 *   POST  /trips      {creator, travelGroupId?, travelGroupName, participantNames}
 *                                              → { trip: {...} }
 *   POST  /trips/{id}/leave  {participant}     → { travelGroupId, participantNames? }
 *   POST  /trips/clear       {user}            → { user, deleted, trimmed }
 *
 * Falls back to throwing a clear error if EXPO_PUBLIC_AWS_API_URL is not
 * configured — the trip flow is cloud-only because it is multi-device.
 */

const AWS_API_URL = process.env.EXPO_PUBLIC_AWS_API_URL;
const isCloudEnabled = () => Boolean(AWS_API_URL);

async function callApi(path, opts = {}) {
  if (!isCloudEnabled()) {
    throw new Error('AWS backend not configured — run `cd infra && ./deploy.sh`, then restart Metro.');
  }
  const base = AWS_API_URL.replace(/\/$/, '');
  const url = `${base}${path}`;
  let r;
  try {
    r = await fetch(url, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    const msg = e?.message || String(e);
    if (/network request failed/i.test(msg)) {
      throw new Error(
        `${msg} — cannot reach ${base}. Re-run \`cd infra && ./deploy.sh\` (it updates .env), confirm Wi-Fi/VPN, then \`npx expo start --clear\`.`,
      );
    }
    throw e;
  }
  if (!r.ok) throw new Error(`AWS API ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

/**
 * List trips the user is a member of (creator OR roster).
 * @param {string} user — exact contact name of the signed-in user
 * @returns {Promise<{user: string, trips: Array}>}
 */
export async function listTripsForUser(user) {
  if (!user) return { user: '', trips: [] };
  return callApi(`/trips?user=${encodeURIComponent(user)}`);
}

/**
 * Upsert a trip on the server.
 * Pass `travelGroupId` to update an existing record, or omit it to let the
 * server mint a fresh id.
 * @param {{ creator: string, travelGroupId?: string, travelGroupName: string, participantNames: string[] }} payload
 */
export async function upsertTrip(payload) {
  return callApi('/trips', { method: 'POST', body: payload });
}

/**
 * Remove a participant from a trip. If the last member leaves, the trip is
 * deleted server-side. Bills already created on the trip are kept.
 */
export async function leaveTrip(travelGroupId, participant) {
  return callApi(`/trips/${encodeURIComponent(travelGroupId)}/leave`, {
    method: 'POST',
    body: { participant },
  });
}

/**
 * Clear the user's trip history:
 *   - trips they created → deleted entirely (no longer visible to anyone)
 *   - trips they're a member of → they're removed from the roster
 */
export async function clearMyTrips(user) {
  return callApi('/trips/clear', { method: 'POST', body: { user } });
}

export const TRIPS_BACKEND_PROVIDER = isCloudEnabled()
  ? `AWS · ${AWS_API_URL}`
  : 'local demo mode';
