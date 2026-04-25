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

// Hardcoded fallback used when the cloud isn't configured. Mirrors the seed
// contacts in deploy.sh so the offline experience matches "live mode".
const STARTING_BALANCE = 1000;
const FALLBACK_CONTACTS = [
  { contactId: 'CT-local-aisyah', name: 'Aisyah Rahman', phone: '+60123456789', color: '#0070BA', balance: STARTING_BALANCE, createdAt: 0 },
  { contactId: 'CT-local-marcus', name: 'Marcus Tan',    phone: '+60173456789', color: '#7AC74F', balance: STARTING_BALANCE, createdAt: 0 },
  { contactId: 'CT-local-priya',  name: 'Priya Nair',    phone: '+60195501234', color: '#F5A623', balance: STARTING_BALANCE, createdAt: 0 },
  { contactId: 'CT-local-daniel', name: 'Daniel Lim',    phone: '+60167008822', color: '#E63946', balance: STARTING_BALANCE, createdAt: 0 },
  { contactId: 'CT-local-jolynn', name: 'Jolynn Tan',    phone: '+60112345678', color: '#9B5DE5', balance: STARTING_BALANCE, createdAt: 0 },
];

async function callApi(path, opts = {}) {
  const url = `${AWS_API_URL.replace(/\/$/, '')}${path}`;
  const r = await fetch(url, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
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
