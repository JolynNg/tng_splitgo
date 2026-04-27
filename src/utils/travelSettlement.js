/**
 * Pure helpers for trip-level settlement (mirrors Lambda computeTotals).
 */

export function computeBillTotals(bill) {
  // Server-provided source-of-truth: backend already converts receipt currency
  // to RM using historical FX by receipt date.
  if (bill?.totalsRM && typeof bill.totalsRM === 'object') {
    const out = {};
    Object.entries(bill.totalsRM).forEach(([name, amt]) => {
      out[name] = +(Number(amt) || 0).toFixed(2);
    });
    return out;
  }
  if (!bill?.items?.length) return {};
  const subtotal = bill.items.reduce((s, i) => s + i.qty * i.unit, 0);
  const taxTotal = (bill.receiptMeta?.sst || 0) + (bill.receiptMeta?.serviceCharge || 0);
  const taxMult = subtotal > 0 ? 1 + taxTotal / subtotal : 1;

  const sub = {};
  (bill.participants || []).forEach((n) => { sub[n] = 0; });
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

/** @returns {Record<string, number>} key `${from}\x1e${to}` → amount `from` owes `to` (per bill creator model) */
export function accumulateDirectedOwes(billsFull) {
  const owes = {};
  for (const bill of billsFull) {
    if (!bill || bill.status === 'cancelled') continue;
    const totals = computeBillTotals(bill);
    const creator = bill.creator;
    if (!creator) continue;
    for (const name of bill.participants || []) {
      if (name === creator) continue;
      const amt = totals[name] || 0;
      if (amt <= 0.001) continue;
      const k = `${name}\x1e${creator}`;
      owes[k] = +((owes[k] || 0) + amt).toFixed(2);
    }
  }
  return owes;
}

/** Net RM each person is up/down in the trip (positive = receives more than they pay out). */
export function netPositionByPerson(owes, allNames) {
  const net = {};
  (allNames || []).forEach((n) => { net[n] = 0; });
  Object.entries(owes).forEach(([k, v]) => {
    const [from, to] = k.split('\x1e');
    if (!from || !to) return;
    net[from] = +(net[from] - v).toFixed(2);
    net[to] = +(net[to] + v).toFixed(2);
  });
  return net;
}

/**
 * Human-readable lines for the footer: who you still owe (by counterparty).
 * @param {string} viewerName
 * @param {Record<string, number>} owes directed edges
 * @returns {{ oweLines: { to: string, amount: number }[], owedLines: { from: string, amount: number }[] }}
 */
export function settlementLinesFor(viewerName, owes) {
  const oweLines = [];
  const owedLines = [];
  Object.entries(owes).forEach(([k, v]) => {
    if (v < 0.005) return;
    const [from, to] = k.split('\x1e');
    if (from === viewerName) oweLines.push({ to, amount: v });
    if (to === viewerName) owedLines.push({ from, amount: v });
  });
  return { oweLines, owedLines };
}
