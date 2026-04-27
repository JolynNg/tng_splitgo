/**
 * Contact directory service — AWS-backed.
 *
 * The directory is one shared list of "people you can add to a bill".
 * Anyone using SplitGo can add a new contact and everyone else picks them
 * up on the next refresh.
 *
 *   GET   /contacts                  → { contacts: [{contactId,name,phone,color,createdAt}] }
 *   POST  /contacts {name,phone}     → { contact: {...} }
 *
 * Falls back to a static seed list when EXPO_PUBLIC_AWS_API_URL isn't set
 * so the demo still works fully offline.
 */

const AWS_API_URL = process.env.EXPO_PUBLIC_AWS_API_URL;
const isCloudEnabled = () => Boolean(AWS_API_URL);

// Hardcoded fallback when the cloud isn't configured. Keep in sync with
// deploy.sh seed contacts (first deploy of an empty SplitGoContacts table).
const STARTING_BALANCE = 1000;
const FALLBACK_CONTACTS = [
  { contactId: 'CT-local-javon',     name: 'Javon',     phone: '+60145246924', color: '#0070BA', balance: STARTING_BALANCE, createdAt: 0 },
  { contactId: 'CT-local-bc',        name: 'BC',        phone: '+60124523653', color: '#7AC74F', balance: STARTING_BALANCE, createdAt: 0 },
  { contactId: 'CT-local-kenny',     name: 'Kenny',     phone: '+60167745723', color: '#F5A623', balance: STARTING_BALANCE, createdAt: 0 },
  { contactId: 'CT-local-ashley',    name: 'Ashley',    phone: '+60172346924', color: '#E63946', balance: STARTING_BALANCE, createdAt: 0 },
  { contactId: 'CT-local-christina', name: 'Christina', phone: '+60119482529', color: '#9B5DE5', balance: STARTING_BALANCE, createdAt: 0 },
  { contactId: 'CT-local-yen',       name: 'Yen',       phone: '+60182463561', color: '#00B4D8', balance: STARTING_BALANCE, createdAt: 0 },
].sort((a, b) => a.name.localeCompare(b.name));

async function callApi(path, opts = {}) {
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
        `${msg} — cannot reach ${base}. Re-run \`cd infra && ./deploy.sh\` (it updates .env), confirm Wi‑Fi/VPN, then \`npx expo start --clear\`.`,
      );
    }
    throw e;
  }
  if (!r.ok) throw new Error(`AWS API ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function listContacts() {
  if (!isCloudEnabled()) return { contacts: FALLBACK_CONTACTS, local: true };
  return callApi('/contacts');
}

export async function createContact({ name, phone }) {
  if (!isCloudEnabled()) {
    const c = {
      contactId: `CT-local-${Date.now().toString(36)}`,
      name: name.trim(),
      phone: (phone || '').trim() || null,
      color: '#00B4D8',
      balance: STARTING_BALANCE,
      createdAt: Date.now(),
    };
    return { contact: c, local: true };
  }
  return callApi('/contacts', { method: 'POST', body: { name, phone } });
}

// Refresh a single contact (used to pull the latest wallet balance after a
// payment without re-listing every contact).
export async function getMe(phone) {
  if (!isCloudEnabled()) {
    const norm = (phone || '').replace(/\D+/g, '');
    const c = FALLBACK_CONTACTS.find((x) => (x.phone || '').replace(/\D+/g, '') === norm);
    if (!c) throw new Error('not found');
    return { contact: c, local: true };
  }
  return callApi(`/me?phone=${encodeURIComponent(phone)}`);
}
