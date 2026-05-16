/**
 * SplitGo backend — single Lambda that fronts every API Gateway route.
 *
 * Touches AWS plus Qwen AI services:
 *   - DynamoDB        → bill + claim state (system of record)
 *   - S3              → receipt photo storage (pre-signed PUT URLs)
 *   - SES             → emails final settlement breakdown
 *   - CloudWatch Logs → automatic via Lambda runtime
 *   - IAM             → execution role grants the above
 *   - Qwen-VL-Max     → receipt OCR
 *   - Qwen-Plus       → item translation, categorisation, summaries, insights
 *
 * Routes:
 *   POST   /bills                     create a new bill
 *   GET    /bills?creator=NAME        list bills by creator (history)
 *   GET    /bills?user=NAME           list bills where NAME is creator or participant
 *   GET    /bills/{billId}            fetch full bill state (poll)
 *   POST   /bills/{billId}/claim      participant claims/un-claims items
 *   POST   /bills/{billId}/leave      participant opts out — removed from group + claims (real-time)
 *   POST   /bills/{billId}/participants  creator edits who is on the bill (add/remove names)
 *   POST   /bills/{billId}/ready      participant marks themselves done picking (or un-readies)
 *   POST   /bills/{billId}/paid       participant marks themselves as paid (or un-pays)
 *   POST   /bills/{billId}/cancel     creator cancels the bill (status → cancelled)
 *   POST   /bills/{billId}/close      payer closes bill (auto-distributes leftovers, emails recap)
 *   POST   /upload-url                returns a pre-signed S3 PUT URL for a receipt photo
 *   POST   /fx/convert                convert source-currency amounts to MYR by receipt date
 *   POST   /ai/extract-receipt        Qwen-VL-Max extracts receipt rows
 *   POST   /ai/categorize-items       Qwen-Plus labels receipt item categories
 *   POST   /ai/translate-items        Qwen-Plus translates item names
 *   POST   /ai/summary                Qwen-Plus generates a friendly WhatsApp-ready settlement message
 *   GET    /contacts                  list every contact in the directory
 *   POST   /contacts                  add a new contact { name, phone }
 *   GET    /me?phone=PHONE            fetch single contact by phone (incl. balance)
 *   GET    /trips?user=NAME           list travel groups the user is a member of
 *   POST   /trips                     upsert a travel group (creator + roster)
 *   POST   /trips/{id}/leave          remove a participant from a trip (deletes the trip if empty)
 *   POST   /trips/clear               clear all trips for a user (creator-owned deleted, others remove user)
 *
 * Wallet: every contact has a balance (defaults to RM 1000). When a
 * participant marks themselves "paid" we atomically debit their balance
 * and credit the bill creator's balance, recording a transaction on the
 * bill so the creator sees a live "payments received" feed.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const REGION         = process.env.AWS_REGION || 'ap-southeast-1';
const TABLE          = process.env.BILLS_TABLE || 'SplitGoBills';
const CONTACTS_TABLE = process.env.CONTACTS_TABLE || 'SplitGoContacts';
const TRIPS_TABLE    = process.env.TRIPS_TABLE || 'SplitGoTrips';
const RECEIPT_BUCKET = process.env.RECEIPT_BUCKET || 'splitgo-receipts';
const SES_SENDER     = process.env.SES_SENDER || '';
const DASHSCOPE_KEY  = process.env.DASHSCOPE_API_KEY || '';
const DASHSCOPE_URL  = process.env.DASHSCOPE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
const QWEN_TEXT_MODEL = process.env.QWEN_TEXT_MODEL || 'qwen-plus';
const QWEN_VL_MODEL   = process.env.QWEN_VL_MODEL || 'qwen-vl-max';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const s3  = new S3Client({ region: REGION });
const ses = new SESv2Client({ region: REGION });

// ---------- helpers ----------

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

const ok  = (body)            => ({ statusCode: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }, body: JSON.stringify(body) });
const bad = (msg, code = 400) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', ...corsHeaders }, body: JSON.stringify({ error: msg }) });

const genBillId = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let id = 'SG-';
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

const RECEIPT_OCR_PROMPT = `You are a careful receipt-parsing expert. The image is a real-world restaurant receipt. It can be printed thermal paper, handwritten, bilingual English/Chinese/Malay, or a mix.

Output one JSON object only:
{
  "restaurant": "string or null",
  "date": "string formatted 'D MMM YYYY, HH:MM' or null if not printed",
  "currency": "MYR | SGD | THB | IDR | USD | EUR | CNY",
  "items": [
    { "id": 1, "name": "string", "qty": number, "lineTotal": number }
  ],
  "sst": number or null,
  "serviceCharge": number or null
}

Rules:
- Include every dish, drink, side, or take-away charge that has a price written next to it.
- Skip subtotal, grand total, SST, service charge, and empty template/category rows.
- qty is the unit count. If absent, use 1.
- lineTotal is the printed total for that row. Do not divide it by qty.
- Preserve the item name language as written, including Chinese characters.
- Currency: RM/MYR -> MYR, S$/SGD -> SGD, THB/baht -> THB, Rp/IDR -> IDR, $ -> USD, EUR -> EUR, RMB/CNY/¥ -> CNY. Default MYR.
- If unreadable, return {"restaurant":null,"date":null,"currency":"MYR","items":[],"sst":null,"serviceCharge":null}.`;

const SUPPORTED_CURRENCIES = ['MYR', 'SGD', 'THB', 'IDR', 'USD', 'EUR', 'CNY'];
const ITEM_CATEGORIES = ['mains', 'drinks', 'sides', 'dessert', 'other'];
const LANG_LABEL = { en: 'English', ms: 'Malay', zh: 'Simplified Chinese' };

async function callQwen(messages, { model = QWEN_TEXT_MODEL, temperature = 0.1, maxTokens = 1200 } = {}) {
  if (!DASHSCOPE_KEY) throw new Error('DASHSCOPE_API_KEY not configured');
  const response = await fetch(DASHSCOPE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DASHSCOPE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
      ...(model === QWEN_VL_MODEL ? { vl_high_resolution_images: true } : {}),
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qwen ${model} ${response.status}: ${text.slice(0, 500)}`);
  }
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';
  return typeof raw === 'string' ? raw.trim() : String(raw?.[0]?.text || '').trim();
}

async function invokeQwenText(systemText, userText, opts = {}) {
  return callQwen([
    { role: 'system', content: systemText },
    { role: 'user', content: userText },
  ], { model: QWEN_TEXT_MODEL, ...opts });
}

async function invokeQwenVision(systemText, userText, base64Image, mimeType = 'image/jpeg') {
  return callQwen([
    { role: 'system', content: systemText },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
        { type: 'text', text: userText },
      ],
    },
  ], { model: QWEN_VL_MODEL, temperature: 0, maxTokens: 1400 });
}

function categorizeFoodItem(name) {
  const s = String(name || '').toLowerCase();
  if (/\b(water|tea|teh|kopi|coffee|milo|juice|soda|cola|beer|drink|ais|iced|latte)\b/.test(s)) return 'drinks';
  if (/\b(cake|ice cream|cendol|dessert|pudding|brownie|waffle|sweet)\b/.test(s)) return 'dessert';
  if (/\b(fries|roti|salad|sambal|soup|side|snack|kerabu|bread)\b/.test(s)) return 'sides';
  if (/\b(nasi|rice|noodle|mee|kuey|burger|chicken|fish|beef|pasta|rendang|lemak|kandar|western)\b/.test(s)) return 'mains';
  return 'other';
}

function parseJsonObject(rawText) {
  const text = String(rawText || '').trim();
  const clean = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('AI response did not contain JSON object');
  return JSON.parse(clean.slice(start, end + 1));
}

function parseJsonArray(rawText) {
  const text = String(rawText || '').trim();
  const clean = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();
  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) throw new Error('AI response did not contain JSON array');
  return JSON.parse(clean.slice(start, end + 1));
}

function inferCurrencyFallback(parsed, currentCurrency) {
  if (currentCurrency !== 'MYR') return currentCurrency;
  const haystack = [
    parsed?.restaurant || '',
    ...(Array.isArray(parsed?.items) ? parsed.items.map((it) => it?.name || '') : []),
  ].join(' ');
  if (/[\u0E00-\u0E7F]/.test(haystack) || /บาท/i.test(haystack)) return 'THB';
  return currentCurrency;
}

function normalizeReceiptExtraction(parsed) {
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error('No items could be extracted from the receipt.');
  }
  const ccyRaw = String(parsed.currency || 'MYR').toUpperCase().trim();
  const normalized = SUPPORTED_CURRENCIES.includes(ccyRaw) ? ccyRaw : 'MYR';
  const currency = inferCurrencyFallback(parsed, normalized);
  const items = parsed.items.map((it, idx) => {
    const qty = Number(it.qty) || 1;
    let unit = 0;
    if (typeof it.lineTotal === 'number') unit = qty > 0 ? +(it.lineTotal / qty).toFixed(4) : it.lineTotal;
    else if (typeof it.unit === 'number') unit = it.unit;
    return {
      id: typeof it.id === 'number' ? it.id : idx + 1,
      name: it.name || '',
      qty,
      unit,
    };
  });
  return {
    restaurant: parsed.restaurant ?? null,
    date: typeof parsed.date === 'string' ? parsed.date : null,
    currency,
    items,
    sst: typeof parsed.sst === 'number' ? parsed.sst : null,
    serviceCharge: typeof parsed.serviceCharge === 'number' ? parsed.serviceCharge : null,
  };
}

// Avatar palette assigned cyclically to contacts so each one gets a distinct
// colour without forcing the client to manage the colour map.
const CONTACT_PALETTE = ['#0070BA', '#7AC74F', '#F5A623', '#E63946', '#9B5DE5', '#00B4D8', '#FB8500', '#06D6A0'];

const STARTING_BALANCE = 1000; // every wallet starts with RM 1,000
const RECEIPT_CATEGORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // warm-lambda in-memory cache
const receiptCategoryCache = new Map();
const DASH_REGEX = /[-\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;

const genContactId = () => {
  return 'CT-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
};

const genTravelGroupId = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let id = 'TG-';
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

// Normalise a phone number for lookup — strip all non-digits so "+60 12-345 6789"
// matches "0123456789" matches "60123456789". Forgiving on whitespace + symbols.
const normalisePhone = (raw) => (raw || '').replace(/\D+/g, '');

// Lookup helpers for the contacts table. There's no GSI yet; at hackathon
// scale (a handful of contacts) a Scan with FilterExpression is fine.
const findContactByName = async (name) => {
  if (!name) return null;
  const r = await ddb.send(new ScanCommand({
    TableName: CONTACTS_TABLE,
    FilterExpression: '#n = :n',
    ExpressionAttributeNames:  { '#n': 'name' },
    ExpressionAttributeValues: { ':n': name },
  }));
  return r.Items?.[0] || null;
};

const findContactByPhone = async (phone) => {
  const norm = normalisePhone(phone);
  if (!norm) return null;
  const r = await ddb.send(new ScanCommand({ TableName: CONTACTS_TABLE }));
  return (r.Items || []).find((c) => normalisePhone(c.phone) === norm) || null;
};

// Default balance to RM 1000 when the field is missing on legacy contacts.
const withDefaults = (contact) => contact && {
  ...contact,
  balance: typeof contact.balance === 'number' ? contact.balance : STARTING_BALANCE,
};

// The receipts bucket has Block Public Access enabled, so a plain
// https://bucket.s3.region.amazonaws.com/key URL would 403. Every response that
// surfaces a receipt swaps `receiptUrl` for a freshly signed GET URL (1h TTL),
// which both web and React Native <Image> can load directly.
const signReceiptUrl = async (key) => {
  if (!key) return null;
  try {
    const cmd = new GetObjectCommand({ Bucket: RECEIPT_BUCKET, Key: key });
    return await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  } catch (e) {
    console.warn('signReceiptUrl failed', e);
    return null;
  }
};

// Mutates `obj.receiptUrl` in-place when `obj.receiptKey` is set. Falls back to
// whatever was on the record (legacy bills uploaded before signed reads landed).
const attachReceiptUrl = async (obj) => {
  if (!obj) return obj;
  if (obj.receiptKey) {
    const signed = await signReceiptUrl(obj.receiptKey);
    if (signed) obj.receiptUrl = signed;
  }
  return obj;
};

// ---------- FX helpers (historical -> RM) ----------
//
// Provider chain (all are no-API-key):
//   1) Frankfurter historical at receipt date
//   2) Frankfurter latest (today's rate) — used when historical is unavailable
//   3) open.er-api.com latest (different host, survives single-provider outages)
//
// We deliberately do NOT silently fall back to 1:1, because that would render
// foreign-currency bills as "RM <native amount>" which is wrong. If every
// provider fails we throw and surface the error; callers (e.g. computeTotalsInMyr)
// degrade gracefully to native-currency totals so the UI still renders.
const FX_PRIMARY_BASE = process.env.FX_API_BASE || 'https://api.frankfurter.dev/v1';
const fxRateCache = new Map();

function parseReceiptDateToISO(raw, fallbackMs) {
  if (!raw) {
    return new Date(fallbackMs || Date.now()).toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  const d1 = new Date(s);
  if (!Number.isNaN(d1.getTime())) return d1.toISOString().slice(0, 10);
  // dd/mm/yyyy or dd-mm-yyyy
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const dd = String(parseInt(m[1], 10)).padStart(2, '0');
    const mm = String(parseInt(m[2], 10)).padStart(2, '0');
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  return new Date(fallbackMs || Date.now()).toISOString().slice(0, 10);
}

async function fetchJsonWithTimeout(url, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getFxRateToMyr(currencyRaw, receiptDateRaw, fallbackMs) {
  const from = String(currencyRaw || 'MYR').trim().toUpperCase();
  if (!from || from === 'MYR') return 1;
  const day = parseReceiptDateToISO(receiptDateRaw, fallbackMs);
  const key = `${from}|${day}`;
  if (fxRateCache.has(key)) return fxRateCache.get(key);

  // 1) Frankfurter historical at receipt date.
  try {
    const j = await fetchJsonWithTimeout(`${FX_PRIMARY_BASE}/${day}?from=${encodeURIComponent(from)}&to=MYR`);
    const rate = Number(j?.rates?.MYR);
    if (Number.isFinite(rate) && rate > 0) {
      fxRateCache.set(key, rate);
      return rate;
    }
  } catch (err) {
    console.warn('Frankfurter historical FX failed:', err?.message || err, { from, day });
  }

  // 2) Frankfurter latest (today's rate).
  try {
    const j2 = await fetchJsonWithTimeout(`${FX_PRIMARY_BASE}/latest?from=${encodeURIComponent(from)}&to=MYR`);
    const rate2 = Number(j2?.rates?.MYR);
    if (Number.isFinite(rate2) && rate2 > 0) {
      fxRateCache.set(key, rate2);
      return rate2;
    }
  } catch (err) {
    console.warn('Frankfurter latest FX failed:', err?.message || err, { from, day });
  }

  // 3) er-api latest (different host) as a last redundancy.
  try {
    const j3 = await fetchJsonWithTimeout(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`);
    const rate3 = Number(j3?.rates?.MYR);
    if (Number.isFinite(rate3) && rate3 > 0) {
      fxRateCache.set(key, rate3);
      return rate3;
    }
  } catch (err) {
    console.warn('er-api latest FX failed:', err?.message || err, { from, day });
  }

  // Surface the failure rather than silently using 1:1.
  throw new Error(`FX rate unavailable for ${from} -> MYR (tried historical and today's rate from multiple providers).`);
}

async function computeTotalsInMyr(bill) {
  const totalsNative = computeTotals(bill);
  const billCurrency = String(bill?.receiptMeta?.currency || 'MYR').toUpperCase();

  const stampedRate = Number(bill?.receiptMeta?.fxRateToMyr) || null;
  const stampedSource = bill?.receiptMeta?.sourceCurrency
    ? String(bill.receiptMeta.sourceCurrency).toUpperCase()
    : null;

  // Detect the legacy "buggy 1:1" state from earlier scan-time fallbacks:
  //   - bill.currency stamped as MYR
  //   - sourceCurrency stamped as something non-MYR
  //   - fxRateToMyr stamped as 1 (the silent 1:1 fallback we used to do)
  // In that case the unit prices are actually in `sourceCurrency`, so we must
  // re-do FX from sourceCurrency -> MYR before reporting totals.
  const looksLikeBuggy11 =
    billCurrency === 'MYR' &&
    stampedSource &&
    stampedSource !== 'MYR' &&
    (!stampedRate || stampedRate === 1);

  // Pick the currency the unit prices are actually denominated in.
  const fromCurrency = looksLikeBuggy11 ? stampedSource : billCurrency;
  const alreadyMyr = fromCurrency === 'MYR';

  let rate = 1;
  let fxDateUsed = bill?.receiptMeta?.fxDate
    || parseReceiptDateToISO(bill?.receiptMeta?.date, bill?.createdAt);
  let resolvedSource = stampedSource || billCurrency;
  let fxOk = alreadyMyr;

  if (alreadyMyr) {
    rate = 1;
    fxOk = true;
  } else if (!looksLikeBuggy11 && stampedRate && stampedRate > 0) {
    // Trust the rate the scan client stamped on the bill at creation time —
    // that is what the user saw and agreed to.
    rate = stampedRate;
    fxOk = true;
  } else {
    // Either no stamped rate, or stamped rate is the buggy 1:1 — fetch fresh.
    try {
      rate = await getFxRateToMyr(fromCurrency, bill?.receiptMeta?.date, bill?.createdAt);
      fxOk = true;
    } catch (err) {
      console.warn('computeTotalsInMyr: FX unavailable, returning native totals:', err?.message || err);
      rate = 1;
      fxOk = false;
    }
  }

  const totalsMyr = {};
  Object.entries(totalsNative).forEach(([name, amt]) => {
    totalsMyr[name] = +((Number(amt) || 0) * rate).toFixed(2);
  });
  const grandTotalMyr = +Object.values(totalsMyr).reduce((s, v) => s + v, 0).toFixed(2);
  return {
    totalsNative,
    totalsMyr,
    grandTotalMyr,
    fxRateToMyr: rate,
    sourceCurrency: resolvedSource,
    fxDate: fxDateUsed,
    fxOk,
  };
}

// ---------- main handler ----------

/** Normalise API Gateway path (HTTP API v2 can include a stage segment on some setups). */
function normaliseHttpPath(event) {
  let p = event.requestContext?.http?.path ?? event.rawPath ?? event.path ?? '/';
  if (typeof p !== 'string') p = '/';
  const q = p.indexOf('?');
  if (q !== -1) p = p.slice(0, q);
  const segs = p.split('/').filter(Boolean);
  if (segs.length && ['$default', 'prod', 'dev', 'staging'].includes(segs[0])) {
    p = `/${segs.slice(1).join('/')}`;
  }
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path   = normaliseHttpPath(event);

  if (method === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };

  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { return bad('invalid JSON body'); }

  try {
    // ---------- POST /bills ----------
    if (method === 'POST' && path === '/bills') {
      const billId = genBillId();
      const item = {
        billId,
        createdAt:    Date.now(),
        creator:      body.creator || 'unknown',
        creatorEmail: body.creatorEmail || null,
        status:       'open',
        items:        body.items || [],
        participants: body.participants || [],
        receiptMeta:  body.receiptMeta || {},
        receiptKey:   body.receiptKey || null,
        receiptUrl:   body.receiptUrl || null,
        claims:       {},
        // Two-phase settlement: each participant first marks themselves "ready"
        // (done picking items), then "paid" (they've sent money to the creator).
        ready:        [],
        paid:         [],
        // Wallet ledger for this bill — one entry per participant the moment
        // they confirm payment. Used by the creator's "Payments received"
        // dashboard. Reversed when the participant un-pays.
        transactions: [],
      };
      await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
      return ok({ billId, shareLink: `https://splitgo.app/b/${billId}`, createdAt: item.createdAt });
    }

    // ---------- GET /bills?creator=NAME or GET /bills?user=NAME ----------
    // - creator=NAME → bills the user created (used by HistoryScreen)
    // - user=NAME    → bills the user created OR is a participant in
    //                  (used by SplitGoHomeScreen for the active-bill cockpit)
    if (method === 'GET' && path === '/bills') {
      const qs = event.queryStringParameters || {};
      const creator = qs.creator
                   ?? event.rawQueryString?.match(/(?:^|&)creator=([^&]+)/)?.[1];
      const user    = qs.user
                   ?? event.rawQueryString?.match(/(?:^|&)user=([^&]+)/)?.[1];
      if (!creator && !user) return bad('missing creator or user query param');
      const name = decodeURIComponent(user || creator);

      // Scale-aware: at production volume we'd back this with a GSI. Hackathon
      // scale (≤ a few hundred rows) → a Scan with a FilterExpression is fine.
      const filter = user
        ? '#c = :n OR contains(#p, :n)'
        : '#c = :n';
      const names  = user
        ? { '#c': 'creator', '#p': 'participants' }
        : { '#c': 'creator' };
      const r = await ddb.send(new ScanCommand({
        TableName: TABLE,
        FilterExpression: filter,
        ExpressionAttributeNames:  names,
        ExpressionAttributeValues: { ':n': name },
      }));
      const sorted = (r.Items || [])
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const signedUrls = await Promise.all(sorted.map((b) => signReceiptUrl(b.receiptKey)));
      const bills = await Promise.all(sorted
        .map(async (b, i) => {
          const fx = await computeTotalsInMyr(b);
          const grand  = fx.grandTotalMyr;
          // Claim progress for the live "in-flight" view
          const claims = b.claims || {};
          const itemsArr = b.items || [];
          const claimedItems = itemsArr.filter(it => (claims[it.id] || []).length > 0).length;
          const claimerSet = new Set();
          Object.values(claims).forEach(arr => arr.forEach(n => claimerSet.add(n)));
          const others = (b.participants || []).filter(n => n !== b.creator);
          const claimedParticipants = others.filter(n => claimerSet.has(n)).length;
          return {
            billId:       b.billId,
            creator:      b.creator || null,
            createdAt:    b.createdAt,
            closedAt:     b.closedAt || null,
            status:       b.status,
            restaurant:   b.receiptMeta?.restaurant || null,
            currency:     b.receiptMeta?.currency || 'MYR',
            travelGroupId:   b.receiptMeta?.travelGroupId   || null,
            travelGroupName: b.receiptMeta?.travelGroupName || null,
            participants: b.participants || [],
            itemCount:    itemsArr.length,
            claimedItems,
            participantCount: (b.participants || []).length,
            claimedParticipants,
            grandTotal:   grand,
            sourceCurrency: fx.sourceCurrency,
            fxRateToMyr:  fx.fxRateToMyr,
            fxDate:       fx.fxDate,
            receiptKey:   b.receiptKey || null,
            receiptUrl:   signedUrls[i] || b.receiptUrl || null,
            ready:        b.ready || [],
            paid:         b.paid  || [],
          };
        }));
      return ok({ user: name, creator: user ? undefined : name, bills });
    }

    // ---------- GET /bills/{billId} ----------
    const getMatch = path.match(/^\/bills\/([^/]+)$/);
    if (method === 'GET' && getMatch) {
      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId: getMatch[1] } }));
      if (!r.Item) return bad('not found', 404);
      await attachReceiptUrl(r.Item);
      const fx = await computeTotalsInMyr(r.Item);

      // Heal the response for legacy bills that were stored with the silent
      // 1:1 fallback (currency stamped MYR, sourceCurrency stamped non-MYR,
      // fxRateToMyr=1) — re-bake item unit prices into MYR using a fresh
      // historical (or today's) rate so the live dashboard renders correctly.
      const stampedRate = Number(r.Item?.receiptMeta?.fxRateToMyr) || null;
      const stampedSource = r.Item?.receiptMeta?.sourceCurrency
        ? String(r.Item.receiptMeta.sourceCurrency).toUpperCase()
        : null;
      const billCurrency = String(r.Item?.receiptMeta?.currency || 'MYR').toUpperCase();
      const wasBuggy11 =
        billCurrency === 'MYR' &&
        stampedSource &&
        stampedSource !== 'MYR' &&
        (!stampedRate || stampedRate === 1);

      if (wasBuggy11 && fx.fxOk && fx.fxRateToMyr && fx.fxRateToMyr !== 1) {
        const m = fx.fxRateToMyr;
        r.Item.items = (r.Item.items || []).map((it) => ({
          ...it,
          sourceUnit: Number(it.sourceUnit ?? it.unit) || 0,
          unit: +((Number(it.unit) || 0) * m).toFixed(2),
        }));
        r.Item.receiptMeta = {
          ...(r.Item.receiptMeta || {}),
          currency: 'MYR',
          sourceCurrency: stampedSource,
          sourceSst: Number(r.Item.receiptMeta?.sourceSst ?? r.Item.receiptMeta?.sst) || 0,
          sourceServiceCharge: Number(
            r.Item.receiptMeta?.sourceServiceCharge ?? r.Item.receiptMeta?.serviceCharge
          ) || 0,
          sst: +((Number(r.Item.receiptMeta?.sst) || 0) * m).toFixed(2),
          serviceCharge: +((Number(r.Item.receiptMeta?.serviceCharge) || 0) * m).toFixed(2),
          fxRateToMyr: m,
          fxDate: fx.fxDate,
        };
      }

      r.Item.totalsRM = fx.totalsMyr;
      r.Item.fx = {
        sourceCurrency: fx.sourceCurrency,
        rateToMyr: fx.fxRateToMyr,
        date: fx.fxDate,
        ok: fx.fxOk,
      };
      return ok(r.Item);
    }

    // ---------- POST /bills/{billId}/claim ----------
    const claimMatch = path.match(/^\/bills\/([^/]+)\/claim$/);
    if (method === 'POST' && claimMatch) {
      const billId = claimMatch[1];
      const { participant, claimedItemIds } = body;
      if (!participant || !Array.isArray(claimedItemIds)) return bad('missing participant or claimedItemIds');

      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId } }));
      if (!r.Item) return bad('not found', 404);
      if (r.Item.status !== 'open') return bad('bill closed', 409);

      const claims = { ...(r.Item.claims || {}) };
      r.Item.items.forEach((it) => {
        const cur    = claims[it.id] || [];
        const has    = cur.includes(participant);
        const should = claimedItemIds.includes(it.id);
        if (should && !has)        claims[it.id] = [...cur, participant];
        else if (!should && has)   claims[it.id] = cur.filter((n) => n !== participant);
      });
      // Editing your picks invalidates a previous "I'm ready" — force the
      // participant to re-confirm so the rest of the table sees fresh data.
      const ready = (r.Item.ready || []).filter((n) => n !== participant);

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { billId },
        UpdateExpression: 'SET claims = :c, ready = :r',
        ExpressionAttributeValues: { ':c': claims, ':r': ready },
      }));
      return ok({ billId, claims, ready });
    }

    // ---------- POST /bills/{billId}/leave ----------
    // Removes a participant from the bill and strips them from every claim row.
    // Creator cannot leave (would orphan the bill). Bill stays open for everyone else.
    const leaveMatch = path.match(/^\/bills\/([^/]+)\/leave$/);
    if (method === 'POST' && leaveMatch) {
      const billId = leaveMatch[1];
      const participant = (body.participant || '').trim();
      if (!participant) return bad('missing participant');

      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId } }));
      if (!r.Item) return bad('not found', 404);
      if (r.Item.status !== 'open') return bad('bill closed', 409);
      if (participant === r.Item.creator) return bad('creator cannot leave this bill', 400);

      let par = [...(r.Item.participants || [])];
      if (!par.includes(participant)) return bad('not a participant', 400);
      par = par.filter((n) => n !== participant);

      const claims = { ...(r.Item.claims || {}) };
      Object.keys(claims).forEach((k) => {
        claims[k] = (claims[k] || []).filter((n) => n !== participant);
      });
      const ready = (r.Item.ready || []).filter((n) => n !== participant);
      const paid  = (r.Item.paid  || []).filter((n) => n !== participant);

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { billId },
        UpdateExpression: 'SET participants = :p, claims = :c, ready = :r, paid = :pd',
        ExpressionAttributeValues: { ':p': par, ':c': claims, ':r': ready, ':pd': paid },
      }));
      return ok({ billId, participants: par, claims, ready, paid });
    }

    // ---------- POST /bills/{billId}/participants ----------
    // Only the bill creator may add or remove people while the bill is open.
    const partEditMatch = path.match(/^\/bills\/([^/]+)\/participants$/);
    if (method === 'POST' && partEditMatch) {
      const billId = partEditMatch[1];
      const actor = (body.actor || '').trim();
      const add    = Array.isArray(body.add) ? body.add : [];
      const remove = Array.isArray(body.remove) ? body.remove : [];
      if (!actor) return bad('missing actor');

      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId } }));
      if (!r.Item) return bad('not found', 404);
      if (r.Item.status !== 'open') return bad('bill closed', 409);
      if (r.Item.creator !== actor) return bad('only the bill creator can edit participants', 403);

      let par = [...(r.Item.participants || [])];
      const claims = { ...(r.Item.claims || {}) };
      let ready = [...(r.Item.ready || [])];
      let paid  = [...(r.Item.paid  || [])];

      for (const raw of remove) {
        const name = (raw || '').trim();
        if (!name || name === r.Item.creator) continue;
        par = par.filter((n) => n !== name);
        Object.keys(claims).forEach((k) => {
          claims[k] = (claims[k] || []).filter((n) => n !== name);
        });
        ready = ready.filter((n) => n !== name);
        paid  = paid.filter((n) => n !== name);
      }
      for (const raw of add) {
        const name = (raw || '').trim();
        if (!name || par.includes(name)) continue;
        par.push(name);
      }

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { billId },
        UpdateExpression: 'SET participants = :p, claims = :c, ready = :r, paid = :pd',
        ExpressionAttributeValues: { ':p': par, ':c': claims, ':r': ready, ':pd': paid },
      }));
      return ok({ billId, participants: par, claims, ready, paid });
    }

    // ---------- POST /bills/{billId}/ready ----------
    // Participant flips their "done picking" flag. Sending ready: false un-readies.
    const readyMatch = path.match(/^\/bills\/([^/]+)\/ready$/);
    if (method === 'POST' && readyMatch) {
      const billId = readyMatch[1];
      const participant = (body.participant || '').trim();
      const isReady = body.ready !== false;
      if (!participant) return bad('missing participant');

      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId } }));
      if (!r.Item) return bad('not found', 404);
      if (r.Item.status !== 'open') return bad('bill closed', 409);
      if (!(r.Item.participants || []).includes(participant)) return bad('not a participant', 400);

      let ready = [...(r.Item.ready || [])].filter((n) => n !== participant);
      if (isReady) ready.push(participant);
      // If they're un-readying, they also can't be marked paid yet.
      let paid  = [...(r.Item.paid || [])];
      if (!isReady) paid = paid.filter((n) => n !== participant);

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { billId },
        UpdateExpression: 'SET ready = :r, paid = :pd',
        ExpressionAttributeValues: { ':r': ready, ':pd': paid },
      }));
      return ok({ billId, ready, paid });
    }

    // ---------- POST /bills/{billId}/paid ----------
    // Non-creator marks themselves as having transferred money to the
    // creator. We treat this as a *real wallet transaction*:
    //   - Compute the participant's share from their claims + tax/service.
    //   - Debit the participant's contact balance.
    //   - Credit the bill creator's contact balance.
    //   - Append a transaction record to the bill so the creator's
    //     dashboard can render a "payments received" feed.
    // Un-paying (paid: false) reverses the same amount on both sides.
    const paidMatch = path.match(/^\/bills\/([^/]+)\/paid$/);
    if (method === 'POST' && paidMatch) {
      const billId = paidMatch[1];
      const participant = (body.participant || '').trim();
      const isPaid = body.paid !== false;
      if (!participant) return bad('missing participant');

      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId } }));
      if (!r.Item) return bad('not found', 404);
      if (r.Item.status !== 'open') return bad('bill closed', 409);
      if (!(r.Item.participants || []).includes(participant)) return bad('not a participant', 400);
      if (participant === r.Item.creator)                     return bad('creator does not pay themselves', 400);
      if (isPaid && !(r.Item.ready || []).includes(participant)) {
        return bad('mark ready before paying', 400);
      }

      const payerContact   = await findContactByName(participant);
      const creatorContact = await findContactByName(r.Item.creator);
      if (!payerContact)   return bad(`payer contact "${participant}" not found`, 400);
      if (!creatorContact) return bad(`creator contact "${r.Item.creator}" not found`, 400);

      const sourceCurrency = (r.Item.receiptMeta?.sourceCurrency || r.Item.receiptMeta?.currency || 'MYR').toUpperCase();
      const txns = [...(r.Item.transactions || [])];
      const existingTxnIdx = txns.findIndex((t) => t.from === participant);
      let amount = 0;
      let payerBalance   = withDefaults(payerContact).balance;
      let creatorBalance = withDefaults(creatorContact).balance;

      if (isPaid) {
        // Pay → compute their share of the bill *now*, so editing claims
        // before pressing pay yields the correct number.
        const fx = await computeTotalsInMyr(r.Item);
        const nativeAmount = +(fx.totalsNative[participant] || 0).toFixed(2);
        amount = +(fx.totalsMyr[participant] || 0).toFixed(2);
        if (amount <= 0) return bad('nothing to pay (no claimed items)', 400);

        // If somehow already paid, no-op the wallet movement (idempotent).
        if (existingTxnIdx === -1) {
          await ddb.send(new UpdateCommand({
            TableName: CONTACTS_TABLE,
            Key: { contactId: payerContact.contactId },
            UpdateExpression: 'SET balance = if_not_exists(balance, :init) - :amt',
            ExpressionAttributeValues: { ':init': STARTING_BALANCE, ':amt': amount },
          }));
          await ddb.send(new UpdateCommand({
            TableName: CONTACTS_TABLE,
            Key: { contactId: creatorContact.contactId },
            UpdateExpression: 'SET balance = if_not_exists(balance, :init) + :amt',
            ExpressionAttributeValues: { ':init': STARTING_BALANCE, ':amt': amount },
          }));
          payerBalance   -= amount;
          creatorBalance += amount;
          txns.push({
            from:    participant,
            to:      r.Item.creator,
            amount,
            currency: 'MYR',
            sourceCurrency,
            sourceAmount: nativeAmount,
            fxRateToMyr: fx.fxRateToMyr,
            fxDate: fx.fxDate,
            at:      Date.now(),
          });
        } else {
          amount = txns[existingTxnIdx].amount;
        }
      } else if (existingTxnIdx !== -1) {
        // Un-pay → refund the payer + debit the creator using the *exact*
        // amount we charged them, even if their share has since changed.
        amount = txns[existingTxnIdx].amount;
        await ddb.send(new UpdateCommand({
          TableName: CONTACTS_TABLE,
          Key: { contactId: payerContact.contactId },
          UpdateExpression: 'SET balance = if_not_exists(balance, :init) + :amt',
          ExpressionAttributeValues: { ':init': STARTING_BALANCE, ':amt': amount },
        }));
        await ddb.send(new UpdateCommand({
          TableName: CONTACTS_TABLE,
          Key: { contactId: creatorContact.contactId },
          UpdateExpression: 'SET balance = if_not_exists(balance, :init) - :amt',
          ExpressionAttributeValues: { ':init': STARTING_BALANCE, ':amt': amount },
        }));
        payerBalance   += amount;
        creatorBalance -= amount;
        txns.splice(existingTxnIdx, 1);
      }

      let paid = [...(r.Item.paid || [])].filter((n) => n !== participant);
      if (isPaid) paid.push(participant);

      // Auto-close: once every non-creator participant has marked paid, seal
      // the bill and emit closedAt so the client can route to the summary
      // view. We also auto-distribute any unclaimed items so the math stays
      // self-consistent (matches what `/close` does manually).
      const nonCreator = (r.Item.participants || []).filter((n) => n !== r.Item.creator);
      const allPaid = nonCreator.length > 0 && nonCreator.every((n) => paid.includes(n));

      let claims  = r.Item.claims || {};
      let status  = r.Item.status;
      let closedAt = r.Item.closedAt || null;
      let updateExpr = 'SET paid = :pd, transactions = :tx';
      const exprValues = { ':pd': paid, ':tx': txns };
      const exprNames  = {};

      if (isPaid && allPaid) {
        // Replicate /close: auto-distribute leftovers across the group
        // (so totals reconcile if someone forgot to claim something).
        const merged = { ...claims };
        const everyone = r.Item.participants || [];
        (r.Item.items || []).forEach((it) => {
          if (!merged[it.id] || merged[it.id].length === 0) merged[it.id] = everyone;
        });
        claims  = merged;
        status  = 'closed';
        closedAt = Date.now();
        updateExpr += ', claims = :c, #s = :s, closedAt = :ca';
        exprValues[':c']  = claims;
        exprValues[':s']  = status;
        exprValues[':ca'] = closedAt;
        exprNames['#s']   = 'status';
      }

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { billId },
        UpdateExpression: updateExpr,
        ExpressionAttributeValues: exprValues,
        ...(Object.keys(exprNames).length ? { ExpressionAttributeNames: exprNames } : {}),
      }));
      return ok({
        billId,
        paid,
        status,
        closedAt,
        claims,
        transactions:  txns,
        amount:        +amount.toFixed(2),
        payerBalance:  +payerBalance.toFixed(2),
        creatorBalance: +creatorBalance.toFixed(2),
      });
    }

    // ---------- POST /bills/{billId}/cancel ----------
    // Creator-only: bill was created by mistake or aborted before settling.
    // Marks status='cancelled' so it shows up in History under that label.
    const cancelMatch = path.match(/^\/bills\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancelMatch) {
      const billId = cancelMatch[1];
      const actor  = (body.actor || '').trim();
      if (!actor) return bad('missing actor');

      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId } }));
      if (!r.Item) return bad('not found', 404);
      const members = Array.isArray(r.Item.participants) ? r.Item.participants : [];
      if (!members.includes(actor)) return bad('only bill members can cancel', 403);
      if (r.Item.creator !== actor) return bad('only the bill creator can cancel', 403);
      if (r.Item.status !== 'open') return bad('bill already closed/cancelled', 409);

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { billId },
        UpdateExpression: 'SET #s = :s, closedAt = :t',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': 'cancelled', ':t': Date.now() },
      }));
      return ok({ billId, status: 'cancelled' });
    }

    // ---------- POST /bills/{billId}/delete ----------
    // Permanently delete a cancelled bill from DynamoDB.
    // Allowed for bill creator or any participant on that bill.
    const deleteMatch = path.match(/^\/bills\/([^/]+)\/delete$/);
    if (method === 'POST' && deleteMatch) {
      const billId = deleteMatch[1];
      const actor  = (body.actor || '').trim();
      if (!actor) return bad('missing actor');

      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId } }));
      if (!r.Item) return bad('not found', 404);
      if (r.Item.status !== 'cancelled') {
        return bad('only cancelled bills can be deleted', 409);
      }
      const members = Array.isArray(r.Item.participants) ? r.Item.participants : [];
      const allowed = actor === r.Item.creator || members.includes(actor);
      if (!allowed) return bad('only trip members can delete this cancelled bill', 403);

      await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { billId } }));
      return ok({ billId, deleted: true });
    }

    // ---------- POST /bills/{billId}/close ----------
    const closeMatch = path.match(/^\/bills\/([^/]+)\/close$/);
    if (method === 'POST' && closeMatch) {
      const billId = closeMatch[1];
      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId } }));
      if (!r.Item) return bad('not found', 404);

      // Auto-distribute any unclaimed items equally amongst all participants
      const claims = { ...(r.Item.claims || {}) };
      const everyone = r.Item.participants;
      r.Item.items.forEach((it) => {
        if (!claims[it.id] || claims[it.id].length === 0) claims[it.id] = everyone;
      });

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { billId },
        UpdateExpression: 'SET #s = :s, claims = :c, closedAt = :t',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':s': 'closed', ':c': claims, ':t': Date.now() },
      }));

      // Optional: email final breakdown via SES
      let emailSent = false;
      if (SES_SENDER && body.recipients?.length) {
        try {
          const fx = await computeTotalsInMyr({ ...r.Item, claims });
          const totals = fx.totalsMyr;
          const html   = renderEmailHtml(billId, r.Item, claims, totals);
          await ses.send(new SendEmailCommand({
            FromEmailAddress: SES_SENDER,
            Destination: { ToAddresses: body.recipients },
            Content: {
              Simple: {
                Subject: { Data: `SplitGo · ${r.Item.receiptMeta?.restaurant || 'Bill'} settled (${billId})` },
                Body: { Html: { Data: html } },
              },
            },
          }));
          emailSent = true;
        } catch (e) {
          console.warn('SES send failed:', e.message);
        }
      }

      return ok({ billId, status: 'closed', claims, emailSent });
    }

    // ---------- GET /trips?user=NAME ----------
    // Returns every trip the user is a participant of. Used by the travel
    // lobby + hub so trips persist on the server, not just on the device that
    // created them. (Membership is by exact contact name match.)
    if (method === 'GET' && path === '/trips') {
      const qs   = event.queryStringParameters || {};
      const user = qs.user ?? event.rawQueryString?.match(/(?:^|&)user=([^&]+)/)?.[1];
      if (!user) return bad('missing user query param');
      const name = decodeURIComponent(user);
      const r = await ddb.send(new ScanCommand({
        TableName: TRIPS_TABLE,
        FilterExpression: 'contains(#p, :n)',
        ExpressionAttributeNames:  { '#p': 'participantNames' },
        ExpressionAttributeValues: { ':n': name },
      }));
      const trips = (r.Items || [])
        .map((t) => ({
          travelGroupId:    t.travelGroupId,
          travelGroupName:  t.travelGroupName || 'Trip',
          creator:          t.creator || null,
          participantNames: Array.isArray(t.participantNames) ? t.participantNames : [],
          createdAt:        t.createdAt || 0,
          updatedAt:        t.updatedAt || t.createdAt || 0,
        }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return ok({ user: name, trips });
    }

    // ---------- POST /trips ----------
    // Upsert: pass `travelGroupId` to update an existing trip, or omit it to
    // create a new one. Roster is replaced wholesale; creator is preserved.
    if (method === 'POST' && path === '/trips') {
      const creator = (body.creator || '').trim();
      const rawNames = Array.isArray(body.participantNames) ? body.participantNames : [];
      const participantNames = [...new Set(rawNames.map((n) => (n || '').trim()).filter(Boolean))];
      if (!creator) return bad('missing creator');
      if (!participantNames.length) return bad('participantNames must not be empty');
      if (!participantNames.includes(creator)) participantNames.unshift(creator);

      const now = Date.now();
      const incomingId = (body.travelGroupId || '').trim();
      let item;
      if (incomingId) {
        const existing = await ddb.send(new GetCommand({ TableName: TRIPS_TABLE, Key: { travelGroupId: incomingId } }));
        item = {
          travelGroupId:   incomingId,
          travelGroupName: (body.travelGroupName || existing.Item?.travelGroupName || 'Trip').slice(0, 80),
          creator:         existing.Item?.creator || creator,
          participantNames,
          createdAt:       existing.Item?.createdAt || now,
          updatedAt:       now,
        };
      } else {
        item = {
          travelGroupId:   genTravelGroupId(),
          travelGroupName: (body.travelGroupName || 'Trip').slice(0, 80),
          creator,
          participantNames,
          createdAt:       now,
          updatedAt:       now,
        };
      }
      await ddb.send(new PutCommand({ TableName: TRIPS_TABLE, Item: item }));
      return ok({ trip: item });
    }

    // ---------- POST /trips/{id}/leave ----------
    // Remove a participant from a trip. If the last member leaves, the trip
    // record is deleted entirely. Bills already created on the trip are NOT
    // touched (history stays intact).
    const tripLeaveMatch = path.match(/^\/trips\/([^/]+)\/leave$/);
    if (method === 'POST' && tripLeaveMatch) {
      const travelGroupId = tripLeaveMatch[1];
      const participant = (body.participant || '').trim();
      if (!participant) return bad('missing participant');
      const r = await ddb.send(new GetCommand({ TableName: TRIPS_TABLE, Key: { travelGroupId } }));
      if (!r.Item) return bad('not found', 404);
      const next = (r.Item.participantNames || []).filter((n) => n !== participant);
      if (next.length === 0) {
        await ddb.send(new DeleteCommand({ TableName: TRIPS_TABLE, Key: { travelGroupId } }));
        return ok({ travelGroupId, deleted: true });
      }
      await ddb.send(new UpdateCommand({
        TableName: TRIPS_TABLE,
        Key: { travelGroupId },
        UpdateExpression: 'SET participantNames = :p, updatedAt = :u',
        ExpressionAttributeValues: { ':p': next, ':u': Date.now() },
      }));
      return ok({ travelGroupId, participantNames: next });
    }

    // ---------- POST /trips/clear ----------
    // "Clear my trip history" — deletes every trip the user created and
    // removes them from every other trip's roster.
    if (method === 'POST' && path === '/trips/clear') {
      const user = (body.user || '').trim();
      if (!user) return bad('missing user');
      const r = await ddb.send(new ScanCommand({
        TableName: TRIPS_TABLE,
        FilterExpression: 'contains(#p, :n) OR #c = :n',
        ExpressionAttributeNames:  { '#p': 'participantNames', '#c': 'creator' },
        ExpressionAttributeValues: { ':n': user },
      }));
      const items = r.Items || [];
      let deleted = 0;
      let trimmed = 0;
      const now = Date.now();
      for (const t of items) {
        if (t.creator === user) {
          await ddb.send(new DeleteCommand({ TableName: TRIPS_TABLE, Key: { travelGroupId: t.travelGroupId } }));
          deleted += 1;
          continue;
        }
        const next = (t.participantNames || []).filter((n) => n !== user);
        if (!next.length) {
          await ddb.send(new DeleteCommand({ TableName: TRIPS_TABLE, Key: { travelGroupId: t.travelGroupId } }));
          deleted += 1;
        } else {
          await ddb.send(new UpdateCommand({
            TableName: TRIPS_TABLE,
            Key: { travelGroupId: t.travelGroupId },
            UpdateExpression: 'SET participantNames = :p, updatedAt = :u',
            ExpressionAttributeValues: { ':p': next, ':u': now },
          }));
          trimmed += 1;
        }
      }
      return ok({ user, deleted, trimmed });
    }

    // ---------- GET /contacts ----------
    // Returns every entry in the directory. Powers LoginScreen ("pick who you
    // are") and ParticipantsScreen (the people you can add to a bill).
    if (method === 'GET' && path === '/contacts') {
      const r = await ddb.send(new ScanCommand({ TableName: CONTACTS_TABLE }));
      const contacts = (r.Items || [])
        .map(withDefaults)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return ok({ contacts });
    }

    // ---------- GET /me?phone=PHONE ----------
    // Single-contact fetch used by the client to refresh wallet balance after
    // logging in or completing a payment.
    if (method === 'GET' && path === '/me') {
      const qs    = event.queryStringParameters || {};
      const phone = qs.phone ?? event.rawQueryString?.match(/(?:^|&)phone=([^&]+)/)?.[1];
      if (!phone) return bad('missing phone');
      const c = await findContactByPhone(decodeURIComponent(phone));
      if (!c) return bad('not found', 404);
      return ok({ contact: withDefaults(c) });
    }

    // ---------- POST /contacts ----------
    // Creates a new entry. Phone is optional. Auto-assigns a palette colour
    // so every contact has a distinct avatar tint without client coordination.
    // Every new contact also gets the starting wallet balance (RM 1000).
    if (method === 'POST' && path === '/contacts') {
      const name  = (body.name  || '').trim();
      const phone = (body.phone || '').trim();
      if (!name) return bad('name is required');
      const existing = await ddb.send(new ScanCommand({
        TableName: CONTACTS_TABLE,
        Select: 'COUNT',
      }));
      const color = body.color || CONTACT_PALETTE[(existing.Count || 0) % CONTACT_PALETTE.length];
      const item  = {
        contactId: body.contactId || genContactId(),
        name,
        phone:     phone || null,
        color,
        balance:   STARTING_BALANCE,
        createdAt: Date.now(),
      };
      await ddb.send(new PutCommand({ TableName: CONTACTS_TABLE, Item: item }));
      return ok({ contact: item });
    }

    // ---------- POST /upload-url ----------
    if (method === 'POST' && path === '/upload-url') {
      const ext      = (body.ext || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const key      = `receipts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const cmd      = new PutObjectCommand({
        Bucket: RECEIPT_BUCKET,
        Key: key,
        ContentType: body.contentType || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      });
      const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
      // Pre-sign the GET as well so the device can render the photo right after
      // the PUT — bucket has Block Public Access on, so no public URL works.
      const getCmd  = new GetObjectCommand({ Bucket: RECEIPT_BUCKET, Key: key });
      const getUrl  = await getSignedUrl(s3, getCmd, { expiresIn: 3600 });
      return ok({
        uploadUrl,
        key,
        getUrl,
        publicUrl: `https://${RECEIPT_BUCKET}.s3.${REGION}.amazonaws.com/${key}`,
      });
    }

    // ---------- POST /fx/convert ----------
    // Converts a list of source-currency amounts into MYR using historical FX
    // based on receipt date. Falls through provider chain (historical -> today's
    // rate from multiple hosts). If every provider fails we surface a 503 so
    // the device can fall back to its own provider chain (or surface an error)
    // rather than silently quoting a 1:1 conversion.
    if (method === 'POST' && path === '/fx/convert') {
      const sourceCurrency = String(body.currency || 'MYR').trim().toUpperCase();
      const date = body.date || null;
      const raw = Array.isArray(body.amounts) ? body.amounts : [];
      const amounts = raw.map((n) => Number(n) || 0);
      try {
        const rate = await getFxRateToMyr(sourceCurrency, date, Date.now());
        const converted = amounts.map((v) => +((v || 0) * rate).toFixed(2));
        return ok({
          sourceCurrency,
          targetCurrency: 'MYR',
          fxRateToMyr: rate,
          fxDate: parseReceiptDateToISO(date, Date.now()),
          amountsMyr: converted,
        });
      } catch (err) {
        return bad(err?.message || 'FX conversion failed', 503);
      }
    }

    // ---------- POST /ai/extract-receipt ----------
    if (method === 'POST' && path === '/ai/extract-receipt') {
      const imageBase64 = String(body.imageBase64 || body.base64Image || '').replace(/^data:image\/[a-z]+;base64,/i, '');
      if (!imageBase64) return bad('missing imageBase64');
      const raw = await invokeQwenVision(
        'You are a meticulous OCR and data extraction expert for Southeast Asian restaurant receipts in English, Malay, and Chinese. Return JSON only.',
        RECEIPT_OCR_PROMPT,
        imageBase64,
        body.mimeType || 'image/jpeg',
      );
      return ok({ ...normalizeReceiptExtraction(parseJsonObject(raw)), provider: QWEN_VL_MODEL });
    }

    // ---------- POST /ai/categorize-items ----------
    if (method === 'POST' && path === '/ai/categorize-items') {
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return ok({ categories: {}, model: QWEN_TEXT_MODEL });
      const names = items.map((it) => it.name || '');
      let arr = [];
      try {
        const raw = await invokeQwenText(
          'Categorise food and drink item names. Output ONLY a JSON array of strings. Allowed values: mains, drinks, sides, dessert, other.',
          `Categorise each item into one of mains, drinks, sides, dessert, other. Return one category per input item in order.\n${JSON.stringify(names)}`,
        );
        arr = parseJsonArray(raw);
      } catch (err) {
        console.warn('item categorisation fallback:', err?.message || err);
      }
      const categories = {};
      items.forEach((it, i) => {
        const cat = String(arr[i] || categorizeFoodItem(it.name)).toLowerCase();
        categories[it.id] = ITEM_CATEGORIES.includes(cat) ? cat : 'other';
      });
      return ok({ categories, model: QWEN_TEXT_MODEL });
    }

    // ---------- POST /ai/translate-items ----------
    if (method === 'POST' && path === '/ai/translate-items') {
      const items = Array.isArray(body.items) ? body.items : [];
      const targetLang = String(body.targetLang || '').trim();
      if (!items.length || !LANG_LABEL[targetLang]) return ok({ translations: {}, model: QWEN_TEXT_MODEL });
      const names = items.map((it) => it.name || '');
      const translations = {};
      try {
        const raw = await invokeQwenText(
          `Translate food and drink item names to ${LANG_LABEL[targetLang]}. Output ONLY a JSON array of strings in the same order. Keep names short and natural. Preserve well-known proper names when appropriate.`,
          JSON.stringify(names),
        );
        const arr = parseJsonArray(raw);
        items.forEach((it, i) => {
          const text = typeof arr[i] === 'string' ? arr[i].trim() : '';
          if (text) translations[it.id] = text;
        });
      } catch (err) {
        console.warn('Qwen translation fallback:', err?.message || err);
        items.forEach((it) => {
          if (it?.name) translations[it.id] = it.name;
        });
      }
      return ok({ translations, model: QWEN_TEXT_MODEL });
    }

    // ---------- POST /ai/summary ----------
    if (method === 'POST' && path === '/ai/summary') {
      const { billId } = body;
      if (!billId) return bad('missing billId');

      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId } }));
      if (!r.Item) return bad('not found', 404);

      const fx      = await computeTotalsInMyr(r.Item);
      const totals  = fx.totalsMyr;
      const lines   = Object.entries(totals).map(([n, v]) => `- ${n}: RM ${v.toFixed(2)}`).join('\n');
      const restaurant = r.Item.receiptMeta?.restaurant || 'our meal';

      const text = await invokeQwenText(
        'You write short, friendly WhatsApp messages in mixed English and Bahasa Malaysia with light Malaysian casual phrasing. 60 words max. Plain text.',
        `Write a short WhatsApp message from "${r.Item.creator}" to friends, summarising the split for ${restaurant}.\n\nBreakdown:\n${lines}\n\nTotal: RM ${Object.values(totals).reduce((a,b)=>a+b,0).toFixed(2)}\nBill code: ${billId}\n\nKeep it casual but clear. Mention each person's amount. End with "Thanks!"`,
      );
      return ok({ billId, message: text || 'Could not generate message.', model: QWEN_TEXT_MODEL });
    }

    // ---------- POST /ai/trip-insights ----------
    // PFM insights for a travel group: category split, per-member spend, and
    // AI-generated advice/comparison text for the current user.
    if (method === 'POST' && path === '/ai/trip-insights') {
      const travelGroupId = (body.travelGroupId || '').trim();
      const user = (body.user || '').trim();
      if (!travelGroupId) return bad('missing travelGroupId');
      if (!user) return bad('missing user');

      const r = await ddb.send(new ScanCommand({ TableName: TABLE }));
      const bills = (r.Items || []).filter(
        (b) => b?.receiptMeta?.travelGroupId === travelGroupId && b?.status !== 'cancelled',
      );
      if (!bills.length) {
        return ok({
          travelGroupId,
          user,
          currency: 'MYR',
          totalTripSpend: 0,
          categoryBreakdown: [],
          perPersonSpend: [],
          mySpend: 0,
          groupAverage: 0,
          topSpender: null,
          advice: 'No completed or active receipts yet. Scan the first receipt to start your trip insights.',
          comparison: 'There is not enough data to compare spending yet.',
        });
      }

      const categoryTotals = {
        food: 0, fashion: 0, amusement: 0, transport: 0, shopping: 0, lodging: 0, cosmetics: 0, other: 0,
      };
      const personTotals = {};
      let totalTripSpend = 0;

      // Speed up insights by processing bills in small batches instead of fully
      // sequentially. This lowers total latency without overloading upstream APIs.
      const BATCH_SIZE = 3;
      for (let i = 0; i < bills.length; i += BATCH_SIZE) {
        const batch = bills.slice(i, i + BATCH_SIZE);
        const batchRows = await Promise.all(batch.map(async (b) => {
          const fx = await computeTotalsInMyr(b);
          const billMyr = Number(fx.grandTotalMyr || 0);
          const receiptCategory = billMyr > 0
            ? await classifyReceiptCategoryWithAI(b)
            : 'other';
          return { totals: fx.totalsMyr || {}, billMyr, receiptCategory };
        }));

        batchRows.forEach((row) => {
          Object.entries(row.totals).forEach(([name, amt]) => {
            personTotals[name] = (personTotals[name] || 0) + (Number(amt) || 0);
          });
          totalTripSpend += row.billMyr;
          categoryTotals[row.receiptCategory] = (categoryTotals[row.receiptCategory] || 0) + row.billMyr;
        });
      }

      const people = Object.keys(personTotals);
      const mySpend = Number(personTotals[user] || 0);
      const groupAverage = people.length ? (Object.values(personTotals).reduce((a, b) => a + b, 0) / people.length) : 0;
      const topSpender = people.length
        ? people.reduce((a, b) => (personTotals[a] >= personTotals[b] ? a : b))
        : null;

      const categoryBreakdown = Object.entries(categoryTotals)
        .map(([category, amount]) => ({ category, amount: +Number(amount || 0).toFixed(2) }))
        .filter((x) => x.amount > 0.01)
        .sort((a, b) => b.amount - a.amount);

      const perPersonSpend = Object.entries(personTotals)
        .map(([name, amount]) => ({ name, amount: +Number(amount || 0).toFixed(2) }))
        .sort((a, b) => b.amount - a.amount);

      let advice = '';
      let comparison = '';
      try {
        const prompt = [
          `Trip ID: ${travelGroupId}`,
          `Current user: ${user}`,
          `Trip total (MYR): ${totalTripSpend.toFixed(2)}`,
          `My spend (MYR): ${mySpend.toFixed(2)}`,
          `Group average spend (MYR): ${groupAverage.toFixed(2)}`,
          `Top spender: ${topSpender || 'N/A'}`,
          `Category split: ${categoryBreakdown.map((c) => `${c.category} RM ${c.amount.toFixed(2)}`).join(', ') || 'N/A'}`,
          `Per person: ${perPersonSpend.map((p) => `${p.name} RM ${p.amount.toFixed(2)}`).join(', ') || 'N/A'}`,
        ].join('\n');

        const raw = await invokeQwenText(
          'You are a practical personal finance assistant. Return concise JSON only with keys: advice, comparison. Keep tone friendly, non-judgmental, and specific. Mention 1-2 actionable savings tips.',
          prompt,
        );
        const parsed = parseJsonObject(raw);
        advice = stripHyphenText(parsed?.advice);
        comparison = stripHyphenText(parsed?.comparison);
      } catch {
        // fall through to deterministic fallback text
      }

      if (!advice) {
        const biggest = categoryBreakdown[0]?.category || 'other';
        advice = stripHyphenText(`Your biggest spend category is ${biggest}. Try setting a per day cap and prioritise shared value meals to keep trip cost balanced.`);
      }
      if (!comparison) {
        const delta = mySpend - groupAverage;
        comparison = stripHyphenText(delta > 0
          ? `You are spending about RM ${delta.toFixed(2)} above the group average.`
          : `You are spending about RM ${Math.abs(delta).toFixed(2)} below the group average.`);
      }

      return ok({
        travelGroupId,
        user,
        currency: 'MYR',
        totalTripSpend: +totalTripSpend.toFixed(2),
        categoryBreakdown,
        perPersonSpend,
        mySpend: +mySpend.toFixed(2),
        groupAverage: +groupAverage.toFixed(2),
        topSpender,
        advice,
        comparison,
      });
    }

    return bad(`route not found: ${method} ${path}`, 404);
  } catch (err) {
    console.error('handler error:', err);
    return bad(err.message || 'internal error', 500);
  }
};

// ---------- pure helpers ----------

function computeTotals(bill) {
  const subtotal = bill.items.reduce((s, i) => s + i.qty * i.unit, 0);
  const taxTotal = (bill.receiptMeta?.sst || 0) + (bill.receiptMeta?.serviceCharge || 0);
  const taxMult  = subtotal > 0 ? 1 + taxTotal / subtotal : 1;

  const sub = {};
  bill.participants.forEach((n) => { sub[n] = 0; });
  bill.items.forEach((it) => {
    const people = bill.claims?.[it.id] || [];
    if (!people.length) return;
    const share = (it.qty * it.unit) / people.length;
    people.forEach((n) => { if (sub[n] !== undefined) sub[n] += share; });
  });
  const totals = {};
  Object.keys(sub).forEach((n) => { totals[n] = +(sub[n] * taxMult).toFixed(2); });
  return totals;
}

function normaliseSpendCategory(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'other';
  if (['food', 'f&b', 'fnb', 'restaurant', 'meal', 'dining'].includes(s)) return 'food';
  if (['fashion', 'clothing', 'apparel'].includes(s)) return 'fashion';
  if (['amusement', 'entertainment', 'activity', 'leisure'].includes(s)) return 'amusement';
  if (['transport', 'travel', 'commute'].includes(s)) return 'transport';
  if (['shopping', 'retail', 'souvenir'].includes(s)) return 'shopping';
  if (['lodging', 'accommodation', 'stay', 'hotel'].includes(s)) return 'lodging';
  if (['cosmetics', 'beauty', 'personal care', 'skincare'].includes(s)) return 'cosmetics';
  return 'other';
}

async function classifyReceiptCategoryWithAI(bill) {
  const savedCategoryRaw = bill?.receiptMeta?.aiCategory || bill?.receiptMeta?.spendCategory || bill?.receiptMeta?.category;
  if (savedCategoryRaw) return normaliseSpendCategory(savedCategoryRaw);

  const cacheKey = getReceiptCategoryCacheKey(bill);
  const cached = getCachedReceiptCategory(cacheKey);
  if (cached) return cached;

  const restaurant = String(bill?.receiptMeta?.restaurant || '');
  const items = Array.isArray(bill?.items)
    ? bill.items.slice(0, 25).map((it) => ({
      name: String(it?.name || '').slice(0, 80),
      qty: Number(it?.qty) || 0,
      unit: Number(it?.unit) || 0,
    }))
    : [];

  let category = inferReceiptCategory({ restaurant, items });
  try {
    const raw = await invokeQwenText(
      'Classify one receipt into ONE spending category only. Allowed categories: food, fashion, amusement, transport, shopping, lodging, cosmetics, other. Return strict JSON: {"category":"<one category>","reason":"<short reason>"}',
      JSON.stringify({ restaurant, items }),
      { maxTokens: 180, temperature: 0 },
    );
    const parsed = parseJsonObject(raw);
    category = normaliseSpendCategory(parsed?.category);
  } catch (err) {
    console.warn('category classification fallback:', err?.message || err);
  }

  setCachedReceiptCategory(cacheKey, category);
  return category;
}

function inferReceiptCategory({ restaurant, items }) {
  const text = [
    restaurant,
    ...(items || []).map((it) => it.name),
  ].join(' ').toLowerCase();

  if (/\b(hotel|hostel|inn|resort|stay|airbnb|suite|lodging|accommodation)\b/.test(text)) return 'lodging';
  if (/\b(taxi|grab|train|rail|bus|metro|flight|airport|petrol|parking|transport)\b/.test(text)) return 'transport';
  if (/\b(ticket|cinema|movie|theme park|museum|game|arcade|karaoke|spa|massage|tour)\b/.test(text)) return 'amusement';
  if (/\b(sephora|cosmetic|beauty|skincare|makeup|lipstick|serum|sunscreen)\b/.test(text)) return 'cosmetics';
  if (/\b(shirt|shoe|bag|fashion|clothing|apparel|dress|pants|uniqlo|zara)\b/.test(text)) return 'fashion';
  if (/\b(mall|market|souvenir|gift|retail|store|shop)\b/.test(text)) return 'shopping';
  if (/\b(food|restaurant|cafe|coffee|tea|rice|nasi|kandar|chef|western|pizza|burger|noodle|chicken|fish|meal|kitchen|bar|bistro|sarn|san)\b/.test(text)) return 'food';
  return 'other';
}

function getReceiptCategoryCacheKey(bill) {
  const id = String(bill?.id || '');
  const restaurant = String(bill?.receiptMeta?.restaurant || '').toLowerCase().trim();
  const itemSig = Array.isArray(bill?.items)
    ? bill.items.slice(0, 12).map((it) => `${String(it?.name || '').toLowerCase().slice(0, 24)}:${Number(it?.qty) || 0}:${Number(it?.unit) || 0}`).join('|')
    : '';
  return `${id}::${restaurant}::${itemSig}`;
}

function getCachedReceiptCategory(cacheKey) {
  if (!cacheKey) return null;
  const hit = receiptCategoryCache.get(cacheKey);
  if (!hit) return null;
  if ((Date.now() - hit.ts) > RECEIPT_CATEGORY_CACHE_TTL_MS) {
    receiptCategoryCache.delete(cacheKey);
    return null;
  }
  return hit.category || null;
}

function setCachedReceiptCategory(cacheKey, category) {
  if (!cacheKey || !category) return;
  receiptCategoryCache.set(cacheKey, { category, ts: Date.now() });
}

function stripHyphenText(raw) {
  return String(raw || '')
    .replace(DASH_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderEmailHtml(billId, bill, claims, totals) {
  const rows = Object.entries(totals)
    .map(([n, v]) => `<tr><td style="padding:6px 12px">${n}</td><td style="padding:6px 12px;text-align:right;font-weight:600">RM ${v.toFixed(2)}</td></tr>`)
    .join('');
  const restaurant = bill.receiptMeta?.restaurant || 'Your meal';
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#0066cc;margin:0">SplitGo</h2>
      <p style="color:#666;font-size:14px">Bill <code>${billId}</code> · ${restaurant}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;border:1px solid #eee;border-radius:8px;overflow:hidden">
        <thead style="background:#f7f7f7"><tr><th style="text-align:left;padding:8px 12px">Person</th><th style="text-align:right;padding:8px 12px">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px">Bill closed and settled via SplitGo · powered by AWS</p>
    </div>`;
}
