/**
 * SplitGo backend — single Lambda that fronts every API Gateway route.
 *
 * Touches FIVE AWS services + ONE Alibaba Cloud service:
 *   - DynamoDB        → bill + claim state (system of record)
 *   - S3              → receipt photo storage (pre-signed PUT URLs)
 *   - SES             → emails final settlement breakdown
 *   - CloudWatch Logs → automatic via Lambda runtime
 *   - IAM             → execution role grants the above
 *   - Alibaba Qwen-Plus → server-side AI text generation (settlement summary)
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
 *   POST   /ai/summary                Qwen-Plus generates a friendly WhatsApp-ready settlement message
 *   GET    /contacts                  list every contact in the directory
 *   POST   /contacts                  add a new contact { name, phone }
 *   GET    /me?phone=PHONE            fetch single contact by phone (incl. balance)
 *
 * Wallet: every contact has a balance (defaults to RM 1000). When a
 * participant marks themselves "paid" we atomically debit their balance
 * and credit the bill creator's balance, recording a transaction on the
 * bill so the creator sees a live "payments received" feed.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const REGION         = process.env.AWS_REGION || 'ap-southeast-5';
const TABLE          = process.env.BILLS_TABLE || 'SplitGoBills';
const CONTACTS_TABLE = process.env.CONTACTS_TABLE || 'SplitGoContacts';
const RECEIPT_BUCKET = process.env.RECEIPT_BUCKET || 'splitgo-receipts';
const SES_SENDER     = process.env.SES_SENDER || '';
const DASHSCOPE_KEY  = process.env.DASHSCOPE_API_KEY || '';
const DASHSCOPE_URL  = process.env.DASHSCOPE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';

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

// Avatar palette assigned cyclically to contacts so each one gets a distinct
// colour without forcing the client to manage the colour map.
const CONTACT_PALETTE = ['#0070BA', '#7AC74F', '#F5A623', '#E63946', '#9B5DE5', '#00B4D8', '#FB8500', '#06D6A0'];

const STARTING_BALANCE = 1000; // every wallet starts with RM 1,000

const genContactId = () => {
  return 'CT-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
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

// ---------- main handler ----------

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path   = event.requestContext?.http?.path   || event.rawPath || event.path;

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
      const bills = sorted
        .map((b, i) => {
          const totals = computeTotals(b);
          const grand  = +Object.values(totals).reduce((s, v) => s + v, 0).toFixed(2);
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
            createdAt:    b.createdAt,
            closedAt:     b.closedAt || null,
            status:       b.status,
            restaurant:   b.receiptMeta?.restaurant || null,
            currency:     b.receiptMeta?.currency || 'MYR',
            participants: b.participants || [],
            itemCount:    itemsArr.length,
            claimedItems,
            participantCount: (b.participants || []).length,
            claimedParticipants,
            grandTotal:   grand,
            receiptKey:   b.receiptKey || null,
            receiptUrl:   signedUrls[i] || b.receiptUrl || null,
            ready:        b.ready || [],
            paid:         b.paid  || [],
          };
        });
      return ok({ user: name, creator: user ? undefined : name, bills });
    }

    // ---------- GET /bills/{billId} ----------
    const getMatch = path.match(/^\/bills\/([^/]+)$/);
    if (method === 'GET' && getMatch) {
      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId: getMatch[1] } }));
      if (!r.Item) return bad('not found', 404);
      await attachReceiptUrl(r.Item);
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

      const currency = r.Item.receiptMeta?.currency || 'MYR';
      const txns = [...(r.Item.transactions || [])];
      const existingTxnIdx = txns.findIndex((t) => t.from === participant);
      let amount = 0;
      let payerBalance   = withDefaults(payerContact).balance;
      let creatorBalance = withDefaults(creatorContact).balance;

      if (isPaid) {
        // Pay → compute their share of the bill *now*, so editing claims
        // before pressing pay yields the correct number.
        const totals = computeTotals(r.Item);
        amount = +(totals[participant] || 0).toFixed(2);
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
            currency,
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
          const totals = computeTotals({ ...r.Item, claims });
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

    // ---------- POST /ai/summary ----------
    if (method === 'POST' && path === '/ai/summary') {
      if (!DASHSCOPE_KEY) return bad('DASHSCOPE_API_KEY not configured', 503);
      const { billId } = body;
      if (!billId) return bad('missing billId');

      const r = await ddb.send(new GetCommand({ TableName: TABLE, Key: { billId } }));
      if (!r.Item) return bad('not found', 404);

      const totals  = computeTotals(r.Item);
      const lines   = Object.entries(totals).map(([n, v]) => `- ${n}: RM ${v.toFixed(2)}`).join('\n');
      const restaurant = r.Item.receiptMeta?.restaurant || 'our meal';

      const aiResp = await fetch(DASHSCOPE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DASHSCOPE_KEY}` },
        body: JSON.stringify({
          model: 'qwen-plus',
          messages: [
            { role: 'system', content: 'You write short, friendly WhatsApp messages in mixed English + Bahasa Malaysia (with a tiny bit of Manglish like "lah", "ya"). 60 words max. Plain text. Friendly tone.' },
            { role: 'user',   content: `Write a short WhatsApp message from "${r.Item.creator}" to friends, summarising the split for ${restaurant}.\n\nBreakdown:\n${lines}\n\nTotal: RM ${Object.values(totals).reduce((a,b)=>a+b,0).toFixed(2)}\nBill code: ${billId}\n\nKeep it casual but clear. Mention each person's amount. End with "Thanks!"` },
          ],
        }),
      });
      const aiJson = await aiResp.json();
      const text   = aiJson?.choices?.[0]?.message?.content || aiJson?.error?.message || 'Could not generate message.';
      return ok({ billId, message: text, model: 'qwen-plus' });
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
      <p style="color:#888;font-size:12px;margin-top:24px">Bill closed and settled via SplitGo · powered by AWS + Alibaba Cloud</p>
    </div>`;
}
