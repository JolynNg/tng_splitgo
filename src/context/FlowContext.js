import React, { createContext, useContext, useState, useMemo } from 'react';
import { PEOPLE, RECEIPT_ITEMS, DEFAULT_SELECTED, DEFAULT_ASSIGNMENTS } from '../data';
import { SG } from '../tokens';

const FlowContext = createContext(null);

const DEFAULT_META = {
  restaurant: 'Mamak Pelita',
  date: null,
  sst: 3.81,           // null means not on receipt
  serviceCharge: 6.35, // null means not on receipt
};

export function FlowProvider({ children }) {
  const [items, setItems] = useState(RECEIPT_ITEMS);
  const [receiptMeta, setReceiptMeta] = useState(DEFAULT_META);
  const [selected, setSelected] = useState(DEFAULT_SELECTED);
  const [assignments, setAssignments] = useState(DEFAULT_ASSIGNMENTS);

  const participants = useMemo(() => {
    const me = { name: 'You', color: SG.primary, me: true };
    return [me, ...PEOPLE.filter(p => !p.me && selected.includes(p.name))];
  }, [selected]);

  // Effective tax multiplier derived from what's actually on the receipt
  const taxMultiplier = useMemo(() => {
    const subtotal = items.reduce((s, i) => s + i.qty * i.unit, 0);
    if (subtotal === 0) return 1;
    const taxTotal = (receiptMeta.sst ?? 0) + (receiptMeta.serviceCharge ?? 0);
    return 1 + taxTotal / subtotal;
  }, [items, receiptMeta]);

  const perPersonTotals = useMemo(() => {
    const sub = {};
    participants.forEach(p => { sub[p.name] = 0; });
    items.forEach(it => {
      const a = assignments[it.id];
      if (!a || !a.people.length) return;
      const share = (it.qty * it.unit) / a.people.length;
      a.people.forEach(n => { if (sub[n] !== undefined) sub[n] += share; });
    });
    const totals = {};
    Object.keys(sub).forEach(n => { totals[n] = sub[n] * taxMultiplier; });
    return totals;
  }, [assignments, participants, items, taxMultiplier]);

  const totalAmount = Object.values(perPersonTotals).reduce((a, b) => a + b, 0);

  return (
    <FlowContext.Provider value={{
      items, setItems,
      receiptMeta, setReceiptMeta,
      selected, setSelected,
      assignments, setAssignments,
      participants, perPersonTotals, totalAmount,
      taxMultiplier,
    }}>
      {children}
    </FlowContext.Provider>
  );
}

export function useFlow() {
  return useContext(FlowContext);
}
