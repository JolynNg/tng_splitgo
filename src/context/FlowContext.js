import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import { RECEIPT_ITEMS } from '../data';
import { SG } from '../tokens';
import { useAuth } from './AuthContext';
import * as billService from '../api/billService';

const FlowContext = createContext(null);

const DEFAULT_META = {
  restaurant: 'Mamak Pelita',
  date: null,
  sst: 3.81,           // null means not on receipt
  serviceCharge: 6.35, // null means not on receipt
  currency: 'MYR',     // ISO-4217; auto-detected from receipt by Qwen-VL
};

// Bill session statuses
//  draft     – payer scanned receipt, hasn't created group yet
//  open      – group created, participants can claim items
//  closed    – payer locked the bill, going to settlement
//  cancelled – creator aborted the bill before settling
const BILL_STATUS = { DRAFT: 'draft', OPEN: 'open', CLOSED: 'closed', CANCELLED: 'cancelled' };

// Generate a short readable bill code for the share link e.g. "SG-K9X4M"
const genBillId = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let id = 'SG-';
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
};

export function FlowProvider({ children }) {
  // The signed-in user is the source of truth for "I" — replaces the old
  // hardcoded 'You' magic string. Backend identity is `me.name`.
  const { me, contacts, updateMyBalance } = useAuth();

  const [items, setItems] = useState(RECEIPT_ITEMS);
  const [receiptMeta, setReceiptMeta] = useState(DEFAULT_META);
  const [selected, setSelected] = useState([]);

  // S3 key + public URL returned by the upload-url Lambda after we PUT the receipt photo.
  // Kept on the bill record so we can re-fetch / preview the original later.
  const [receiptKey, setReceiptKey] = useState(null);
  const [receiptUrl, setReceiptUrl] = useState(null);

  // AI-derived per-item category (Mains / Drinks / Sides / Dessert) and translations
  // categories[itemId]   = 'mains' | 'drinks' | 'sides' | 'dessert' | 'other'
  // translations[lang][itemId] = translated name
  const [categories, setCategories]     = useState({});
  const [translations, setTranslations] = useState({});

  // claims[itemId] = array of participant names who claimed that item
  // Item cost is split equally among everyone who claimed it.
  const [claims, setClaims] = useState({});

  // Two-phase settlement, mirrored from server:
  //  ready[] = participants who finished picking and locked in their selection
  //  paid[]  = participants who marked themselves as having paid the creator
  const [ready, setReady] = useState([]);
  const [paid,  setPaid]  = useState([]);

  // Wallet ledger for this bill, mirrored from the server.
  // transactions[] = [{ from, to, amount, currency, at }]
  // Drives the creator's "Payments received" feed.
  const [transactions, setTransactions] = useState([]);

  // Bill session state
  const [billId, setBillId] = useState(null);
  const [billStatus, setBillStatus] = useState(BILL_STATUS.DRAFT);
  const [billCreatedAt, setBillCreatedAt] = useState(null);
  // Authoritative creator name for the current bill (= me.name on a fresh
  // bill, = serverBill.creator after loadBillFromServer). Drives the
  // "am I the payer?" check, replacing the old `currentUser === 'You'`.
  const [billCreator, setBillCreator] = useState(null);

  // Demo-only: which participant the device is currently "viewing as".
  // Defaults to me.name (the actual signed-in user); the user-switcher FAB
  // can flip it to other participants for testing the claim view.
  const [currentUser, setCurrentUser] = useState(me?.name || '');

  // Make sure currentUser tracks the signed-in user once auth resolves
  // (so the demo always boots with "viewing as me").
  useEffect(() => {
    if (me?.name) setCurrentUser(prev => prev || me.name);
  }, [me?.name]);

  // When non-null, takes precedence over `selected` for the participants list.
  // Set when a bill is hydrated from history (the server is the source of truth).
  const [loadedParticipants, setLoadedParticipants] = useState(null);

  const participants = useMemo(() => {
    if (!me) return [];
    const meEntry = { name: me.name, color: me.color || SG.primary, me: true };
    const lookup = (name) => {
      const found = contacts.find(c => c.name === name);
      return found
        ? { name: found.name, color: found.color || SG.primary, me: false, phone: found.phone }
        : { name, color: SG.primary, me: false };
    };
    if (loadedParticipants) {
      const others = loadedParticipants.filter(n => n !== me.name).map(lookup);
      return [meEntry, ...others];
    }
    return [meEntry, ...selected.filter(n => n !== me.name).map(lookup)];
  }, [selected, loadedParticipants, me, contacts]);

  // Canonical name list for the active bill (server order when hydrated).
  const billParticipantNames = useMemo(() => {
    if (loadedParticipants?.length) return [...loadedParticipants];
    if (!me?.name) return participants.map(p => p.name);
    return [me.name, ...selected.filter(n => n !== me.name)];
  }, [loadedParticipants, me?.name, selected, participants]);

  // Effective tax multiplier derived from what's actually on the receipt
  const taxMultiplier = useMemo(() => {
    const subtotal = items.reduce((s, i) => s + i.qty * i.unit, 0);
    if (subtotal === 0) return 1;
    const taxTotal = (receiptMeta.sst ?? 0) + (receiptMeta.serviceCharge ?? 0);
    return 1 + taxTotal / subtotal;
  }, [items, receiptMeta]);

  // Derived "assignments" view so legacy screens (Summary / Request) keep working
  const assignments = useMemo(() => {
    const out = {};
    items.forEach(it => {
      const people = claims[it.id] || [];
      out[it.id] = { shared: people.length > 1, people };
    });
    return out;
  }, [items, claims]);

  const perPersonTotals = useMemo(() => {
    const sub = {};
    billParticipantNames.forEach(n => { sub[n] = 0; });
    items.forEach(it => {
      const people = claims[it.id] || [];
      if (people.length === 0) return;
      const share = (it.qty * it.unit) / people.length;
      people.forEach(n => { if (sub[n] !== undefined) sub[n] += share; });
    });
    const totals = {};
    Object.keys(sub).forEach(n => { totals[n] = sub[n] * taxMultiplier; });
    return totals;
  }, [claims, billParticipantNames, items, taxMultiplier]);

  const totalAmount = Object.values(perPersonTotals).reduce((a, b) => a + b, 0);

  // Progress: how many items have been claimed at least once
  const claimProgress = useMemo(() => {
    if (items.length === 0) return { claimed: 0, total: 0, percent: 0 };
    const claimed = items.filter(it => (claims[it.id] || []).length > 0).length;
    return { claimed, total: items.length, percent: claimed / items.length };
  }, [items, claims]);

  // How many people on the bill have claimed at least one item (everyone counts)
  const participantProgress = useMemo(() => {
    const claimedNames = new Set();
    Object.values(claims).forEach(arr => arr.forEach(n => claimedNames.add(n)));
    const names = billParticipantNames;
    const done = names.filter(n => claimedNames.has(n)).length;
    const total = Math.max(names.length, 1);
    return { done, total };
  }, [claims, billParticipantNames]);

  // ---- Mutations ----

  const toggleClaim = useCallback((itemId, name) => {
    setClaims(prev => {
      const cur = prev[itemId] || [];
      const next = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name];
      const updated = { ...prev, [itemId]: next };
      // Fire-and-forget sync to AWS backend (no-op locally)
      if (billId) {
        const myClaimedIds = items
          .filter(it => (updated[it.id] || []).includes(name))
          .map(it => it.id);
        billService
          .submitClaim(billId, { participant: name, claimedItemIds: myClaimedIds })
          .catch(err => console.warn('[SplitGo] submitClaim:', err.message));
      }
      return updated;
    });
    // Editing claims invalidates a previous "I'm done" so the rest of the
    // table waits for them to re-confirm before the Pay button unlocks.
    setReady(prev => prev.filter(n => n !== name));
    setPaid(prev  => prev.filter(n => n !== name));
  }, [billId, items]);

  const setItemClaimers = useCallback((itemId, names) => {
    setClaims(prev => ({ ...prev, [itemId]: names }));
  }, []);

  const createBillGroup = useCallback(async () => {
    // Optimistic local id, replaced if AWS backend returns one
    let id = genBillId();
    setClaims({});
    setReady([]);
    setPaid([]);
    setTransactions([]);
    setBillCreatedAt(Date.now());
    setBillCreator(me?.name || null);
    try {
      const res = await billService.createBill({
        creator: me?.name,
        items,
        participants: participants.map(p => p.name),
        receiptMeta,
        receiptKey,
        // Don't persist `receiptUrl` — it's either a base64 data: URL (too big
        // for a DynamoDB item) or a 1h pre-signed S3 URL (expires). Lambda
        // re-signs from `receiptKey` on every read.
        receiptUrl: null,
      });
      if (res?.billId) id = res.billId;
    } catch (err) {
      console.warn('[SplitGo] createBill fell back to local mode:', err.message);
    }
    setBillId(id);
    setBillStatus(BILL_STATUS.OPEN);
    // Keep roster in sync immediately so the dashboard / close logic don't wait
    // for the first GET poll.
    setLoadedParticipants(participants.map(p => p.name));
    return id;
  }, [items, participants, receiptMeta, receiptKey, receiptUrl, me?.name]);

  // Merge the latest server snapshot of the bill into local state.
  // Used by polling on BillCreatedScreen / ClaimScreen so multiple devices stay in sync.
  const syncFromServer = useCallback((serverBill) => {
    if (!serverBill || serverBill.local) return;
    if (serverBill.claims) setClaims(serverBill.claims);
    if (Array.isArray(serverBill.participants)) setLoadedParticipants([...serverBill.participants]);
    if (Array.isArray(serverBill.ready)) setReady([...serverBill.ready]);
    if (Array.isArray(serverBill.paid))  setPaid([...serverBill.paid]);
    if (Array.isArray(serverBill.transactions)) setTransactions([...serverBill.transactions]);
    if (serverBill.status && serverBill.status !== billStatus) {
      setBillStatus(serverBill.status);
    }
  }, [billStatus]);

  // Hydrate ALL local state from a server bill record.
  // Used when the user re-enters a bill from the History list — we don't have
  // the in-memory state any more (they may have closed and re-opened the app),
  // so we re-build it from DynamoDB.
  const loadBillFromServer = useCallback((serverBill) => {
    if (!serverBill || serverBill.local) return;
    setBillId(serverBill.billId);
    const incoming = serverBill.status;
    setBillStatus(
      incoming === 'closed'    ? BILL_STATUS.CLOSED
      : incoming === 'cancelled' ? BILL_STATUS.CANCELLED
      : BILL_STATUS.OPEN
    );
    setBillCreatedAt(serverBill.createdAt || Date.now());
    setBillCreator(serverBill.creator || null);
    setItems(serverBill.items || []);
    setClaims(serverBill.claims || {});
    setReady(Array.isArray(serverBill.ready) ? [...serverBill.ready] : []);
    setPaid(Array.isArray(serverBill.paid)   ? [...serverBill.paid]  : []);
    setTransactions(Array.isArray(serverBill.transactions) ? [...serverBill.transactions] : []);
    setReceiptMeta({
      restaurant:    serverBill.receiptMeta?.restaurant ?? null,
      date:          serverBill.receiptMeta?.date ?? null,
      sst:           serverBill.receiptMeta?.sst ?? null,
      serviceCharge: serverBill.receiptMeta?.serviceCharge ?? null,
      currency:      serverBill.receiptMeta?.currency ?? 'MYR',
    });
    setReceiptKey(serverBill.receiptKey || null);
    setReceiptUrl(serverBill.receiptUrl || null);
    // The participants array on the server is the authoritative list for this
    // bill — override the local selection so even unknown demo names appear.
    setLoadedParticipants(serverBill.participants || []);
    setCategories({});
    setTranslations({});
    // Default the device's view to "me" — the user-switcher FAB can flip
    // it elsewhere afterwards. Falls back to creator if me hasn't loaded.
    setCurrentUser(me?.name || serverBill.creator || '');
  }, [me?.name]);

  const closeBill = useCallback(async () => {
    // Anything still unclaimed at close-time gets split equally among everyone
    // still on the bill (uses server-backed roster when present).
    setClaims(prev => {
      const next = { ...prev };
      const allNames = loadedParticipants?.length ? [...loadedParticipants] : participants.map(p => p.name);
      items.forEach(it => {
        if (!next[it.id] || next[it.id].length === 0) {
          next[it.id] = allNames;
        }
      });
      return next;
    });
    setBillStatus(BILL_STATUS.CLOSED);
    if (billId) {
      try { await billService.closeBill(billId); }
      catch (err) { console.warn('[SplitGo] closeBill (remote):', err.message); }
    }
  }, [items, participants, billId, loadedParticipants]);

  const leaveBill = useCallback(async (participantName) => {
    const name = (participantName || me?.name || '').trim();
    if (!billId || !name) return;
    const baseNames = loadedParticipants?.length ? [...loadedParticipants] : participants.map(p => p.name);
    try {
      const r = await billService.leaveBill(billId, { participant: name });
      if (r.local) {
        setLoadedParticipants(baseNames.filter(n => n !== name));
        setClaims(prev => {
          const next = { ...prev };
          Object.keys(next).forEach(k => {
            next[k] = (next[k] || []).filter(n => n !== name);
          });
          return next;
        });
        setReady(prev => prev.filter(n => n !== name));
        setPaid(prev  => prev.filter(n => n !== name));
      } else {
        setLoadedParticipants(r.participants || []);
        setClaims(r.claims || {});
        if (Array.isArray(r.ready)) setReady(r.ready);
        if (Array.isArray(r.paid))  setPaid(r.paid);
      }
    } catch (err) {
      console.warn('[SplitGo] leaveBill:', err.message);
      throw err;
    }
  }, [billId, me?.name, loadedParticipants, participants]);

  // Two-phase settlement helpers ------------------------------------------------

  const setMyReady = useCallback(async (participantName, isReady) => {
    const name = (participantName || me?.name || '').trim();
    if (!billId || !name) return;
    // Optimistic local update so the UI feels instant.
    setReady((prev) => {
      const without = prev.filter((n) => n !== name);
      return isReady ? [...without, name] : without;
    });
    if (!isReady) {
      setPaid((prev) => prev.filter((n) => n !== name));
    }
    try {
      const r = await billService.setReady(billId, { participant: name, ready: isReady });
      if (!r.local) {
        if (Array.isArray(r.ready)) setReady(r.ready);
        if (Array.isArray(r.paid))  setPaid(r.paid);
      }
    } catch (err) {
      console.warn('[SplitGo] setReady:', err.message);
      throw err;
    }
  }, [billId, me?.name]);

  // Returns { amount, payerBalance, creatorBalance, transactions } so the UI
  // can render a "RM X deducted from your wallet" success modal, and so the
  // signed-in user's local balance updates immediately on a successful pay.
  const setMyPaid = useCallback(async (participantName, isPaid) => {
    const name = (participantName || me?.name || '').trim();
    if (!billId || !name) return null;
    setPaid((prev) => {
      const without = prev.filter((n) => n !== name);
      return isPaid ? [...without, name] : without;
    });
    try {
      const r = await billService.setPaid(billId, { participant: name, paid: isPaid });
      if (!r.local) {
        if (Array.isArray(r.paid))         setPaid(r.paid);
        if (Array.isArray(r.transactions)) setTransactions(r.transactions);
        // Server auto-closes the bill when every non-creator participant
        // has paid; mirror that locally so the dashboard immediately flips
        // to the "all paid" state without waiting for the next poll.
        if (r.status === 'closed') {
          setBillStatus(BILL_STATUS.CLOSED);
          if (r.claims && typeof r.claims === 'object') setClaims(r.claims);
        }
        // Update the signed-in user's wallet balance locally so the home
        // dashboard shows the new number without a separate refresh.
        if (me?.name === name && typeof r.payerBalance === 'number') {
          updateMyBalance?.(r.payerBalance);
        } else if (me?.name === billCreator && typeof r.creatorBalance === 'number') {
          updateMyBalance?.(r.creatorBalance);
        }
      }
      return r;
    } catch (err) {
      console.warn('[SplitGo] setPaid:', err.message);
      throw err;
    }
  }, [billId, me?.name, billCreator, updateMyBalance]);

  const cancelBillRemote = useCallback(async () => {
    if (!billId || !me?.name) return;
    setBillStatus(BILL_STATUS.CANCELLED);
    try {
      await billService.cancelBill(billId, { actor: me.name });
    } catch (err) {
      console.warn('[SplitGo] cancelBill:', err.message);
      throw err;
    }
  }, [billId, me?.name]);

  const updateBillParticipants = useCallback(async ({ add = [], remove = [] }) => {
    if (!billId || !me?.name) return;
    const baseNames = loadedParticipants?.length ? [...loadedParticipants] : participants.map(p => p.name);
    const addNames = add.map(n => (n || '').trim()).filter(Boolean);
    const removeNames = remove.map(n => (n || '').trim()).filter(Boolean);
    try {
      const r = await billService.updateBillParticipants(billId, {
        actor: me.name,
        add: addNames,
        remove: removeNames,
      });
      if (r.local) {
        let next = [...baseNames];
        removeNames.forEach((n) => {
          if (n === billCreator) return;
          next = next.filter(x => x !== n);
        });
        addNames.forEach((n) => { if (!next.includes(n)) next.push(n); });
        setLoadedParticipants(next);
        setClaims(prev => {
          const out = { ...prev };
          removeNames.forEach((name) => {
            if (name === billCreator) return;
            Object.keys(out).forEach(k => {
              out[k] = (out[k] || []).filter(x => x !== name);
            });
          });
          return out;
        });
        setReady(prev => prev.filter(n => !removeNames.includes(n) || n === billCreator));
        setPaid(prev  => prev.filter(n => !removeNames.includes(n) || n === billCreator));
      } else {
        setLoadedParticipants(r.participants || []);
        setClaims(r.claims || {});
        if (Array.isArray(r.ready)) setReady(r.ready);
        if (Array.isArray(r.paid))  setPaid(r.paid);
      }
    } catch (err) {
      console.warn('[SplitGo] updateBillParticipants:', err.message);
      throw err;
    }
  }, [billId, me?.name, billCreator, loadedParticipants, participants]);

  const resetFlow = useCallback(() => {
    setBillId(null);
    setBillStatus(BILL_STATUS.DRAFT);
    setBillCreatedAt(null);
    setBillCreator(null);
    setClaims({});
    setReady([]);
    setPaid([]);
    setTransactions([]);
    setCurrentUser(me?.name || '');
    setItems(RECEIPT_ITEMS);
    setReceiptMeta(DEFAULT_META);
    setSelected([]);
    setReceiptKey(null);
    setReceiptUrl(null);
    setCategories({});
    setTranslations({});
    setLoadedParticipants(null);
  }, [me?.name]);

  const shareLink = billId ? `https://splitgo.app/b/${billId}` : null;

  return (
    <FlowContext.Provider value={{
      // receipt
      items, setItems,
      receiptMeta, setReceiptMeta,
      receiptKey, setReceiptKey,
      receiptUrl, setReceiptUrl,
      // AI enrichment
      categories, setCategories,
      translations, setTranslations,
      // group
      selected, setSelected,
      participants,
      // who I am on this device (mirrored from AuthContext for convenience)
      me,
      // bill session
      billId, billStatus, billCreatedAt, billCreator, shareLink,
      billParticipantNames,
      createBillGroup, closeBill, resetFlow, syncFromServer, loadBillFromServer,
      leaveBill, updateBillParticipants,
      // two-phase settlement + wallet ledger
      ready, paid, setMyReady, setMyPaid, cancelBillRemote,
      transactions,
      // claims
      claims, setClaims, toggleClaim, setItemClaimers,
      assignments, // derived legacy view
      // totals & progress
      perPersonTotals, totalAmount, taxMultiplier,
      claimProgress, participantProgress,
      // demo user switcher
      currentUser, setCurrentUser,
    }}>
      {children}
    </FlowContext.Provider>
  );
}

export function useFlow() {
  return useContext(FlowContext);
}

export { BILL_STATUS };
